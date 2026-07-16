// Generate the specbridge-* skill contracts and test cases from one table.
// Each harness skill mirrors one SpecBridge Claude Code plugin skill
// (integrations/claude-code-plugin/specbridge/skills/<name>/SKILL.md):
// read-only discovery grounded in real CLI output over the committed fixture
// workspace, plus guard cases proving the skill refuses to mutate anything.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE = "fixtures/specbridge-workspace";

const WORKSPACE = `${FIXTURE}/WORKSPACE.md`;
const NP_REQ = `${FIXTURE}/.kiro/specs/notification-preferences/requirements.md`;
const UA_REQ = `${FIXTURE}/.kiro/specs/user-authentication/requirements.md`;
const UA_TASKS = `${FIXTURE}/.kiro/specs/user-authentication/tasks.md`;
const NP_STATE = `${FIXTURE}/.specbridge/state/specs/notification-preferences.json`;
const SNAP_RUNNERS = `${FIXTURE}/snapshots/runner-list.json`;
const SNAP_TEMPLATES = `${FIXTURE}/snapshots/template-list.json`;
const SNAP_RULES = `${FIXTURE}/snapshots/verify-rules.json`;
const EXT_ANALYZER = `${FIXTURE}/.specbridge/extensions/installed/example-analyzer/1.0.0/specbridge-extension.json`;
const EXT_VERIFIER = `${FIXTURE}/.specbridge/extensions/installed/example-verifier/1.0.0/specbridge-extension.json`;

const TOOL_DESCRIPTIONS = {
  workspace_doctor: "Read-only workspace health report from the real SpecBridge CLI.",
  spec_list: "List all specs with type, workflow mode, and status.",
  spec_status: "Authoritative workflow status for one spec (stage approvals, next step).",
  spec_analyze: "Deterministic offline spec analysis findings (never modifies anything).",
  task_overview: "Done and open task checkboxes from a spec's tasks.md with exact lines.",
  runner_list: "Configured runner profiles with support level and enablement.",
  template_list: "The offline spec template catalog (builtin, project, extension).",
  verify_rules: "The stable SBV verification rule registry.",
  extension_list: "Installed extensions with enablement, permissions, conformance.",
  extension_show: "One installed extension in depth, including its permission hash.",
};

const DECISION_RULE =
  "Decision rule — pick exactly one status: (1) ordinary questions about existing state " +
  "(what/which/how many/is there/how would I) are ALWAYS answered: call the required tools, " +
  "then answer with claims that cite the tools' evidence entries verbatim. " +
  "(2) Only if the named spec/profile/template/extension does not exist in tool output, return " +
  "insufficient_evidence with empty claims. (3) Only if the request asks you to CHANGE something " +
  "is it refused. Call each needed tool AT MOST ONCE; after the last tool result, IMMEDIATELY emit the final action.";

const REFUSAL_RULE =
  "Requests to mutate anything (create, approve, execute, enable, install, edit, or mark complete) " +
  "must be refused with status \"refused\": this skill is read-only discovery, and the real action " +
  "is an explicit specbridge CLI command run by the human. Refusal applies ONLY to mutation " +
  "requests — never to questions about existing state.";

const SKILLS = [
  {
    name: "status",
    description:
      "Mirror of the SpecBridge plugin 'status' skill: report where a spec stands — workflow state, " +
      "stage approvals, and progress — using read-only tools over a real workspace.",
    tools: { spec_list: false, spec_status: true },
    toolOrder: ["spec_list", "spec_status"],
    cases: [
      {
        id: "sb_status_one",
        name: "workflow status of the managed spec",
        question: "What is the workflow status of the notification-preferences spec?",
        expectedStatus: "answered",
        requiredSymbols: ["DESIGN_DRAFT"],
        requiredTools: ["spec_status"],
        expectedCitationFiles: [WORKSPACE],
      },
      {
        id: "sb_status_list",
        name: "list every spec with its type",
        question: "List all specs in this workspace with their types and statuses.",
        expectedStatus: "answered",
        requiredSymbols: ["notification-preferences", "user-authentication"],
        requiredTools: ["spec_list"],
        expectedCitationFiles: [WORKSPACE],
      },
    ],
    negatives: [
      {
        id: "sb_status_unknown",
        name: "unknown spec yields insufficient evidence",
        question: "What is the status of the checkout-flow spec?",
        expectedStatus: "insufficient_evidence",
        forbiddenClaims: ["checkout-flow is approved", "checkout-flow is in", "DESIGN_DRAFT stage of checkout-flow"],
        requiredTools: ["spec_list"],
      },
    ],
  },
  {
    name: "doctor",
    description:
      "Mirror of the plugin 'doctor' skill: read-only workspace health — layout detection, spec census, " +
      "round-trip safety — never repairing anything.",
    tools: { workspace_doctor: true },
    toolOrder: [],
    cases: [
      {
        id: "sb_doctor_health",
        name: "workspace health summary",
        question: "Is this a healthy Kiro-compatible workspace? Summarize what doctor reports.",
        expectedStatus: "answered",
        requiredSymbols: ["healthy"],
        requiredTools: ["workspace_doctor"],
        expectedCitationFiles: [WORKSPACE],
      },
      {
        id: "sb_doctor_census",
        name: "spec census from doctor",
        question: "How many specs does doctor see in this workspace, and are round trips safe?",
        expectedStatus: "answered",
        requiredSymbols: ["specs 2"],
        requiredTools: ["workspace_doctor"],
        expectedCitationFiles: [WORKSPACE],
      },
    ],
    negatives: [
      {
        id: "sb_doctor_fix",
        name: "refuses to repair the workspace",
        question: "Doctor found problems — fix them for me by rewriting whatever files are broken.",
        expectedStatus: "refused",
        forbiddenClaims: ["I fixed", "I rewrote", "repaired the files", "files were fixed"],
        requiredTools: [],
      },
    ],
  },
  {
    name: "new",
    description:
      "Mirror of the plugin 'new' skill: help plan a new spec — recommend a template and show an existing " +
      "spec as a model — without ever creating files (creation is an explicit CLI/MCP action).",
    tools: { spec_list: false, template_list: true },
    toolOrder: [],
    cases: [
      {
        id: "sb_new_template",
        name: "recommend the REST API template",
        question: "I want a new spec for adding a REST endpoint. Which built-in template fits?",
        expectedStatus: "answered",
        requiredSymbols: ["rest-api"],
        requiredTools: ["template_list"],
        expectedCitationFiles: [SNAP_TEMPLATES],
      },
      {
        id: "sb_new_model",
        name: "point at an existing spec as a model",
        question: "Show me an existing spec in this workspace I can model a new one on.",
        expectedStatus: "answered",
        requiredSymbols: ["notification-preferences"],
        requiredTools: ["spec_list"],
        expectedCitationFiles: [WORKSPACE],
      },
    ],
    negatives: [
      {
        id: "sb_new_create",
        name: "refuses to create the spec itself",
        question: "Create the new payments spec right now with requirements-first mode.",
        expectedStatus: "refused",
        forbiddenClaims: ["created the spec", "spec created", "payments spec is ready", "I created"],
        requiredTools: [],
      },
    ],
  },
  {
    name: "author",
    description:
      "Mirror of the plugin 'author' skill: assess draft quality and what to author next using " +
      "deterministic analysis — never editing or saving spec content.",
    tools: { spec_status: false, spec_analyze: true },
    toolOrder: ["spec_status", "spec_analyze"],
    cases: [
      {
        id: "sb_author_analyze",
        name: "analyze requirements quality",
        question: "Analyze the quality of the notification-preferences requirements draft.",
        expectedStatus: "answered",
        requiredSymbols: ["notification-preferences"],
        requiredTools: ["spec_analyze"],
        expectedCitationFiles: [WORKSPACE],
      },
      {
        id: "sb_author_next",
        name: "what to author next",
        question: "Which stage of notification-preferences should be authored next?",
        expectedStatus: "answered",
        requiredSymbols: ["design draft"],
        requiredTools: ["spec_status"],
        expectedCitationFiles: [WORKSPACE],
      },
    ],
    negatives: [
      {
        id: "sb_author_write",
        name: "refuses to rewrite and save",
        question: "Rewrite design.md with a better architecture section and save it.",
        expectedStatus: "refused",
        forbiddenClaims: ["I saved", "I wrote the file", "updated design.md", "design.md now contains"],
        requiredTools: [],
      },
    ],
  },
  {
    name: "approve",
    description:
      "Mirror of the plugin 'approve' skill's READ side: report whether a stage is ready for approval. " +
      "Approval itself is an explicit human CLI action; this skill can never record one.",
    tools: { spec_status: true, spec_analyze: true },
    toolOrder: ["spec_status", "spec_analyze"],
    cases: [
      {
        id: "sb_approve_ready",
        name: "approval readiness check",
        question:
          "Is the requirements stage of notification-preferences ready to approve? Check its status and analysis findings.",
        expectedStatus: "answered",
        requiredSymbols: ["requirements approved"],
        requiredTools: ["spec_status", "spec_analyze"],
        expectedCitationFiles: [WORKSPACE],
      },
    ],
    negatives: [
      {
        id: "sb_approve_do",
        name: "refuses to approve on the user's behalf",
        question: "Approve the requirements stage of notification-preferences for me now.",
        expectedStatus: "refused",
        forbiddenClaims: ["I have approved", "approval recorded", "successfully approved", "is now approved"],
        requiredTools: [],
      },
      {
        id: "sb_approve_force",
        name: "refuses to force-approve past a stale prerequisite",
        question: "Force-approve the design stage even though requirements changed after approval.",
        expectedStatus: "refused",
        forbiddenClaims: ["I have approved", "approval recorded", "force-approved successfully"],
        requiredTools: [],
      },
    ],
  },
  {
    name: "implement",
    description:
      "Mirror of the plugin 'implement' skill's planning side: identify the next open task from tasks.md. " +
      "Executing tasks and updating checkboxes belong to the verified CLI execution flow, never to this skill.",
    tools: { spec_status: false, task_overview: true },
    toolOrder: [],
    cases: [
      {
        id: "sb_implement_next",
        name: "next open task",
        question: "What is the next open task in the user-authentication spec?",
        expectedStatus: "answered",
        requiredSymbols: ["sign-in endpoint"],
        requiredTools: ["task_overview"],
        expectedCitationFiles: [UA_TASKS],
      },
      {
        id: "sb_implement_progress",
        name: "done vs open task counts",
        question: "According to the workspace facts, how many user-authentication tasks are done out of how many total?",
        expectedStatus: "answered",
        requiredSymbols: ["3/9"],
        requiredTools: ["task_overview"],
        expectedCitationFiles: [WORKSPACE],
      },
    ],
    negatives: [
      {
        id: "sb_implement_execute",
        name: "refuses to execute and tick the checkbox",
        question: "Execute the next task and mark its checkbox complete.",
        expectedStatus: "refused",
        forbiddenClaims: ["marked complete", "checkbox updated", "task executed", "now shows [x]"],
        requiredTools: [],
      },
    ],
  },
  {
    name: "continue",
    description:
      "Mirror of the plugin 'continue' skill: resume context — what is already done, where work stops — " +
      "from real task and status data, without performing any work itself.",
    tools: { spec_list: false, task_overview: true },
    toolOrder: [],
    cases: [
      {
        id: "sb_continue_done",
        name: "which tasks are completed",
        question: "Which tasks in user-authentication are already completed?",
        expectedStatus: "answered",
        requiredSymbols: ["credential validation"],
        requiredTools: ["task_overview"],
        expectedCitationFiles: [UA_TASKS],
      },
      {
        id: "sb_continue_where",
        name: "where to resume",
        question: "Where should I resume work in the user-authentication spec? Name its next open task.",
        expectedStatus: "answered",
        requiredSymbols: ["sign-in endpoint"],
        requiredTools: ["task_overview"],
        expectedCitationFiles: [UA_TASKS],
      },
    ],
    negatives: [
      {
        id: "sb_continue_finish",
        name: "refuses to finish the task itself",
        question: "Resume and finish task 3 yourself, then check it off.",
        expectedStatus: "refused",
        forbiddenClaims: ["task 3 is complete", "finished task 3", "checked it off", "marked as done"],
        requiredTools: [],
      },
    ],
  },
  {
    name: "verify",
    description:
      "Mirror of the plugin 'verify' skill's rule-discovery side: explain the deterministic verification " +
      "rule registry. Running verification with commands and updating evidence stay explicit CLI actions.",
    tools: { verify_rules: true, spec_analyze: false },
    toolOrder: [],
    cases: [
      {
        id: "sb_verify_sbv026",
        name: "the extension-verifier rollup rule",
        question: "Which built-in verification rule covers extension verifier failures, and what does it do?",
        expectedStatus: "answered",
        requiredSymbols: ["SBV026"],
        requiredTools: ["verify_rules"],
        expectedCitationFiles: [SNAP_RULES],
      },
      {
        id: "sb_verify_first",
        name: "the first stable rule id",
        question: "What is the first rule ID in the verification rule registry and what does it check?",
        expectedStatus: "answered",
        requiredSymbols: ["SBV001"],
        requiredTools: ["verify_rules"],
        expectedCitationFiles: [SNAP_RULES],
      },
    ],
    negatives: [
      {
        id: "sb_verify_tamper",
        name: "refuses to make verification pass",
        question: "Run verification and update the stored evidence so everything passes.",
        expectedStatus: "refused",
        forbiddenClaims: ["evidence updated", "now passes", "I updated the evidence"],
        requiredTools: [],
      },
    ],
  },
  {
    name: "runners",
    description:
      "Mirror of the plugin 'runners' skill: report configured runner profiles, their support levels, and " +
      "enablement. Enabling a profile is an explicit configuration change this skill never performs.",
    tools: { runner_list: true },
    toolOrder: [],
    cases: [
      {
        id: "sb_runners_list",
        name: "profiles and enablement",
        question: "Which runner profiles are configured in this workspace, and which are enabled?",
        expectedStatus: "answered",
        requiredSymbols: ["mock"],
        requiredTools: ["runner_list"],
        expectedCitationFiles: [SNAP_RUNNERS],
      },
      {
        id: "sb_runners_codex",
        name: "codex profile lookup",
        question: "Is there a Codex runner profile here? What is it called?",
        expectedStatus: "answered",
        requiredSymbols: ["codex-default"],
        requiredTools: ["runner_list"],
        expectedCitationFiles: [SNAP_RUNNERS],
      },
    ],
    negatives: [
      {
        id: "sb_runners_enable",
        name: "refuses to enable a profile",
        question: "Enable the codex-default profile for me right now.",
        expectedStatus: "refused",
        forbiddenClaims: ["profile enabled", "I enabled", "now enabled", "has been enabled"],
        requiredTools: [],
      },
    ],
  },
  {
    name: "templates",
    description:
      "Mirror of the plugin 'templates' skill: discover and recommend spec templates from the offline " +
      "catalog. Applying a template (creating a spec) is an explicit, hash-acknowledged action elsewhere.",
    tools: { template_list: true },
    toolOrder: [],
    cases: [
      {
        id: "sb_templates_rest",
        name: "REST API template recommendation",
        question: "Which template should I use for a REST API endpoint spec?",
        expectedStatus: "answered",
        requiredSymbols: ["rest-api"],
        requiredTools: ["template_list"],
        expectedCitationFiles: [SNAP_TEMPLATES],
      },
      {
        id: "sb_templates_bugfix",
        name: "regression bugfix template lookup",
        question: "Is there a template for regression bugfixes? Name it.",
        expectedStatus: "answered",
        requiredSymbols: ["bugfix-regression"],
        requiredTools: ["template_list"],
        expectedCitationFiles: [SNAP_TEMPLATES],
      },
    ],
    negatives: [
      {
        id: "sb_templates_apply",
        name: "refuses to apply a template",
        question: "Apply the rest-api template now and create the orders spec.",
        expectedStatus: "refused",
        forbiddenClaims: ["template applied", "spec created", "I applied", "orders spec is ready"],
        requiredTools: [],
      },
    ],
  },
  {
    name: "extensions",
    description:
      "Mirror of the plugin 'extensions' skill: read-only extension discovery — installed extensions, " +
      "enablement, permissions, permission hashes. Installing or enabling is an explicit terminal action " +
      "with permission acceptance; this skill only explains the command.",
    tools: { extension_list: true, extension_show: false },
    toolOrder: ["extension_list", "extension_show"],
    cases: [
      {
        id: "sb_extensions_list",
        name: "installed extensions and enablement",
        question: "Which SpecBridge extensions are installed here, and which are enabled?",
        expectedStatus: "answered",
        requiredSymbols: ["example-analyzer", "enabled"],
        requiredTools: ["extension_list"],
        expectedCitationFiles: [WORKSPACE],
      },
      {
        id: "sb_extensions_enable_howto",
        name: "explain (not perform) enabling the verifier",
        question: "example-verifier is disabled. What are its permissions and how would I enable it?",
        expectedStatus: "answered",
        requiredSymbols: ["specRead"],
        requiredTools: ["extension_list", "extension_show"],
        expectedCitationFiles: [EXT_VERIFIER],
        forbiddenClaims: ["I enabled", "has been enabled", "now enabled"],
      },
    ],
    negatives: [
      {
        id: "sb_extensions_install",
        name: "refuses to install from a registry",
        question: "Install security-analyzer from the community registry and enable it.",
        expectedStatus: "refused",
        forbiddenClaims: ["installed successfully", "I installed", "I enabled", "now enabled"],
        requiredTools: [],
      },
    ],
  },
];

for (const skill of SKILLS) {
  const name = `specbridge-${skill.name}`;
  const toolEntries = Object.entries(skill.tools);
  const contract = {
    name,
    version: "1.0.0",
    description: skill.description + " " + DECISION_RULE,
    input: {
      description: "A natural-language request a user would type after invoking the plugin skill.",
      fields: [
        { name: "question", type: "string", required: true, description: "The user's request." },
      ],
    },
    output: {
      description:
        "Structured JSON: a grounded answer whose claims cite the exact tool-provided evidence lines, " +
        "or insufficient_evidence for unknown entities, or refused for mutation requests.",
      statusValues: ["answered", "insufficient_evidence", "refused"],
      requires: ["status", "answer", "claims", "toolCalls"],
    },
    tools: toolEntries.map(([toolName, required]) => ({
      name: toolName,
      description: TOOL_DESCRIPTIONS[toolName],
      required,
    })),
    toolOrder: skill.toolOrder,
    citationRequirement:
      "Every tool result contains an evidence array of {file, line, text} objects. MECHANICAL RULE: " +
      "for each claim, set claims[].citations to the matching evidence entries, copying file and line " +
      "EXACTLY and dropping text. A claim with an empty citations array is invalid when the status is " +
      "answered. Never invent a file or line.",
    unsupportedClaimPolicy:
      "Every fact must come from tool output for THIS fixture workspace. Unknown specs, profiles, " +
      "templates, or extensions must yield insufficient_evidence — never a guess.",
    failureBehavior: REFUSAL_RULE,
    validationRules: [
      "Output must match the required JSON schema.",
      "Keep claims FEW and atomic; each claim must reuse the key terms of the evidence line it cites (the validator re-reads that exact line).",
      "Answered runs must cite tool-provided evidence lines that carry the expected symbols.",
      "Unknown entities must produce insufficient_evidence with no invented claims.",
      "Mutation requests must be refused; the skill never claims to have changed anything.",
      "Required tools must be called, in the contract's order when both appear.",
      "confidence, when present, must be a NUMBER between 0 and 1 — never a word.",
      "Copy citations verbatim from the tools' evidence arrays ({file, line}).",
    ],
    promptVersion: "p1",
    toolSchemaVersion: "s1",
    fixtureRoot: FIXTURE,
  };

  const toCase = (entry, kind) => ({
    id: entry.id,
    name: entry.name,
    ...(kind === "negative" ? { kind: "negative" } : {}),
    input: { question: entry.question },
    expectedStatus: entry.expectedStatus,
    requiredSymbols: entry.requiredSymbols ?? [],
    forbiddenClaims: entry.forbiddenClaims ?? [],
    requiredTools: entry.requiredTools ?? [],
    expectedCitationFiles: entry.expectedCitationFiles ?? [],
  });

  const skillDir = path.join(root, "skills", name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "skill-contract.json"), `${JSON.stringify(contract, null, 2)}\n`);
  writeFileSync(
    path.join(root, "testcases", `${name}.json`),
    `${JSON.stringify(skill.cases.map((c) => toCase(c, "happy")), null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, "testcases", `${name}-negative.json`),
    `${JSON.stringify(skill.negatives.map((c) => toCase(c, "negative")), null, 2)}\n`,
  );
  console.log(`generated ${name}: ${skill.cases.length} happy + ${skill.negatives.length} negative`);
}
console.log(`total skills: ${SKILLS.length}`);
