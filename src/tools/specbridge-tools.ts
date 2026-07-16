import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot, resolveFromRoot } from "../core/paths.js";
import { ToolRegistry, type Tool, type ToolContext, type ToolResult } from "./tool-registry.js";

/**
 * SpecBridge skill tools.
 *
 * Every tool shells out to the REAL SpecBridge CLI (`--json`) against the
 * committed fixture workspace — read-only commands only, so an eval run can
 * never mutate specs, approvals, evidence, or extension state. Each tool also
 * returns `evidence` entries ({file, line, text}) computed by locating the
 * relevant anchor line in a real fixture file, so the model can ground its
 * claims in citations the harness re-reads from disk.
 *
 * Facts that only exist as CLI output (runner profiles, template catalog,
 * verification rules) are grounded through committed snapshots produced by
 * scripts/build-specbridge-fixture.mjs from the same CLI; the tools re-run
 * the CLI live and FAIL LOUDLY when a snapshot has drifted, so a citation is
 * never stale.
 */
const SPECBRIDGE_CLI =
  process.env.SPECBRIDGE_CLI ??
  resolve(repoRoot(), "..", "specbridge", "packages", "cli", "dist", "index.js");

export interface Evidence {
  file: string;
  line: number;
  text: string;
}

export interface SpecBridgeToolResult extends ToolResult {
  data: unknown;
  evidence: Evidence[];
}

function cliJson(ctx: ToolContext, ...args: string[]): unknown {
  if (!existsSync(SPECBRIDGE_CLI)) {
    throw new Error(`SpecBridge CLI not found at ${SPECBRIDGE_CLI}; run pnpm build in SpecBridge or set SPECBRIDGE_CLI.`);
  }
  const stdout = execFileSync(process.execPath, [SPECBRIDGE_CLI, ...args, "--json"], {
    cwd: resolveFromRoot(ctx.fixtureRoot),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return (JSON.parse(stdout) as { data: unknown }).data;
}

/** First 1-based line of a fixture file containing `needle`. */
function citeLine(ctx: ToolContext, relPath: string, needle: string): Evidence {
  const file = `${ctx.fixtureRoot}/${relPath}`;
  const lines = readFileSync(resolveFromRoot(file), "utf8").split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(needle));
  if (index < 0) {
    throw new Error(`evidence anchor "${needle}" not found in ${file}`);
  }
  return { file, line: index + 1, text: (lines[index] ?? "").trim() };
}

function assertSnapshotFresh(ctx: ToolContext, name: string, live: unknown): void {
  const snapshotPath = resolveFromRoot(`${ctx.fixtureRoot}/snapshots/${name}.json`);
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  if (JSON.stringify(snapshot) !== JSON.stringify(live)) {
    throw new Error(
      `snapshot ${name}.json no longer matches live CLI output — re-run scripts/build-specbridge-fixture.mjs`,
    );
  }
}

function compact(data: unknown, max = 3500): string {
  const text = JSON.stringify(data);
  return text.length > max ? `${text.slice(0, max)}…(truncated)` : text;
}

export const specbridgeDoctorTool: Tool<Record<string, never>, SpecBridgeToolResult> = {
  name: "workspace_doctor",
  description: "Read-only SpecBridge workspace health report (doctor --json): layout, specs, round-trip safety.",
  parameters: {},
  execute(_args, ctx) {
    const data = cliJson(ctx, "doctor") as { healthy: boolean };
    const workspaceLine = citeLine(ctx, "WORKSPACE.md", "workspace: healthy");
    if (!workspaceLine.text.includes(`healthy ${data.healthy}`)) {
      throw new Error("WORKSPACE.md workspace line drifted — re-run scripts/build-specbridge-fixture.mjs");
    }
    const evidence = [
      workspaceLine,
      citeLine(ctx, "WORKSPACE.md", "- spec notification-preferences"),
      citeLine(ctx, "WORKSPACE.md", "- spec user-authentication"),
    ];
    return { summary: `doctor: ${compact(data, 400)}`, data, evidence };
  },
};

export const specbridgeSpecListTool: Tool<Record<string, never>, SpecBridgeToolResult> = {
  name: "spec_list",
  description: "List all specs with type, workflow mode, and status.",
  parameters: {},
  execute(_args, ctx) {
    const data = cliJson(ctx, "spec", "list") as { specs: Array<{ name: string }> };
    const evidence = data.specs.map((spec) => citeLine(ctx, "WORKSPACE.md", `- spec ${spec.name}`));
    return { summary: `specs: ${compact(data, 600)}`, data, evidence };
  },
};

export const specbridgeSpecStatusTool: Tool<{ spec: string }, SpecBridgeToolResult> = {
  name: "spec_status",
  description: "Authoritative workflow status for one spec: stage approvals, staleness, next step.",
  parameters: { spec: "spec name exactly as shown by spec_list" },
  execute(args, ctx) {
    const data = cliJson(ctx, "spec", "status", args.spec) as { status: string; effectiveStatus?: string };
    const factLine = citeLine(ctx, "WORKSPACE.md", `- spec ${args.spec}`);
    const currentStatus = data.effectiveStatus ?? data.status;
    if (!factLine.text.includes(`status ${currentStatus}`)) {
      throw new Error(`WORKSPACE.md line for ${args.spec} drifted — re-run scripts/build-specbridge-fixture.mjs`);
    }
    const evidence: Evidence[] = [factLine];
    const statePath = `.specbridge/state/specs/${args.spec}.json`;
    if (existsSync(resolveFromRoot(`${ctx.fixtureRoot}/${statePath}`))) {
      evidence.push(citeLine(ctx, statePath, args.spec));
    }
    return { summary: `status(${args.spec}): ${compact(data, 600)}`, data, evidence };
  },
};

export const specbridgeSpecAnalyzeTool: Tool<{ spec: string }, SpecBridgeToolResult> = {
  name: "spec_analyze",
  description: "Deterministic offline spec analysis: structural findings per stage (never modifies anything).",
  parameters: { spec: "spec name exactly as shown by spec_list" },
  execute(args, ctx) {
    const data = cliJson(ctx, "spec", "analyze", args.spec) as { errorCount: number };
    return {
      summary: `analysis(${args.spec}): ${compact(data, 600)}`,
      data,
      evidence: [citeLine(ctx, `.kiro/specs/${args.spec}/requirements.md`, "#")],
    };
  },
};

export const specbridgeTaskOverviewTool: Tool<{ spec: string }, SpecBridgeToolResult> = {
  name: "task_overview",
  description: "Read a spec's tasks.md: done and open checkboxes with their exact lines.",
  parameters: { spec: "spec name exactly as shown by spec_list" },
  execute(args, ctx) {
    const relPath = `.kiro/specs/${args.spec}/tasks.md`;
    const absolute = resolveFromRoot(`${ctx.fixtureRoot}/${relPath}`);
    if (!existsSync(absolute)) {
      return { summary: `no tasks.md for ${args.spec}`, data: { exists: false }, evidence: [] };
    }
    const lines = readFileSync(absolute, "utf8").split(/\r?\n/);
    const tasks = lines
      .map((text, index) => ({ text: text.trim(), line: index + 1 }))
      .filter((entry) => /^- \[[ xX]\]/.test(entry.text));
    const open = tasks.filter((task) => task.text.startsWith("- [ ]"));
    const done = tasks.filter((task) => !task.text.startsWith("- [ ]"));
    const evidence = [...done.slice(0, 2), ...open.slice(0, 2)].map((task) => ({
      file: `${ctx.fixtureRoot}/${relPath}`,
      line: task.line,
      text: task.text,
    }));
    evidence.push(citeLine(ctx, "WORKSPACE.md", `- spec ${args.spec}`));
    return {
      summary: `tasks(${args.spec}): ${done.length} done, ${open.length} open`,
      data: { exists: true, done: done.length, open: open.length, tasks: tasks.slice(0, 20) },
      evidence,
    };
  },
};

export const specbridgeRunnerListTool: Tool<Record<string, never>, SpecBridgeToolResult> = {
  name: "runner_list",
  description: "List configured runner profiles with support level and enablement (never contacts a model).",
  parameters: {},
  execute(_args, ctx) {
    const raw = cliJson(ctx, "runner", "list") as {
      profiles: Array<{ profile: string; implementation: string; enabled: boolean }>;
    };
    assertSnapshotFresh(ctx, "runner-list", raw);
    // Object keyed by profile name: complete and never array-truncated in
    // the adapter's prompt compaction.
    const profiles: Record<string, string> = {};
    for (const entry of raw.profiles) {
      profiles[entry.profile] = `${entry.implementation}, ${entry.enabled ? "enabled" : "disabled"}`;
    }
    const data = { profileCount: raw.profiles.length, profiles };
    return {
      summary: `runner profiles: ${Object.keys(profiles).join(", ")}`,
      data,
      evidence: [
        citeLine(ctx, "snapshots/runner-list.json", '"mock"'),
        citeLine(ctx, "snapshots/runner-list.json", '"codex-default"'),
      ],
    };
  },
};

export const specbridgeTemplateListTool: Tool<Record<string, never>, SpecBridgeToolResult> = {
  name: "template_list",
  description: "List built-in, project, and extension spec templates from the offline catalog.",
  parameters: {},
  execute(_args, ctx) {
    const raw = cliJson(ctx, "template", "list") as {
      templates: Array<{ id: string; ref: string; kind: string; description?: string }>;
    };
    assertSnapshotFresh(ctx, "template-list", raw);
    const data = {
      templates: raw.templates.map((template) => ({
        id: template.id,
        ref: template.ref,
        kind: template.kind,
      })),
    };
    return {
      summary: `templates: ${data.templates.map((template) => template.id).join(", ")}`,
      data,
      evidence: [
        citeLine(ctx, "snapshots/template-list.json", '"id": "rest-api"'),
        citeLine(ctx, "snapshots/template-list.json", '"id": "bugfix-regression"'),
      ],
    };
  },
};

export const specbridgeVerifyRulesTool: Tool<Record<string, never>, SpecBridgeToolResult> = {
  name: "verify_rules",
  description: "The stable SBV verification rule registry (deterministic drift/quality rules).",
  parameters: {},
  execute(_args, ctx) {
    const raw = cliJson(ctx, "verify", "rules") as {
      rules: Array<{ id: string; title: string }>;
    };
    assertSnapshotFresh(ctx, "verify-rules", raw);
    // Object keyed by rule id: all 26 rules survive prompt compaction intact.
    const rules: Record<string, string> = {};
    for (const rule of raw.rules) {
      rules[rule.id] = rule.title;
    }
    const data = { ruleCount: raw.rules.length, rules };
    return {
      summary: `rules: ${Object.keys(rules).join(", ")}`,
      data,
      evidence: [
        citeLine(ctx, "snapshots/verify-rules.json", '"SBV026"'),
        citeLine(ctx, "snapshots/verify-rules.json", "Extension verifier reported failure"),
        citeLine(ctx, "snapshots/verify-rules.json", '"SBV001"'),
        citeLine(ctx, "snapshots/verify-rules.json", "Required spec file missing"),
      ],
    };
  },
};

export const specbridgeExtensionListTool: Tool<Record<string, never>, SpecBridgeToolResult> = {
  name: "extension_list",
  description: "List installed SpecBridge extensions with enablement, permissions, and conformance status.",
  parameters: {},
  execute(_args, ctx) {
    const data = cliJson(ctx, "extension", "list");
    return {
      summary: `extensions: ${compact(data, 900)}`,
      data,
      evidence: [
        citeLine(ctx, "WORKSPACE.md", "- extension example-analyzer"),
        citeLine(ctx, "WORKSPACE.md", "- extension example-verifier"),
        citeLine(
          ctx,
          ".specbridge/extensions/installed/example-analyzer/1.0.0/specbridge-extension.json",
          '"id": "example-analyzer"',
        ),
      ],
    };
  },
};

export const specbridgeExtensionShowTool: Tool<{ extension: string }, SpecBridgeToolResult> = {
  name: "extension_show",
  description:
    "One installed extension in depth: permissions, permission hash, enablement, and the exact CLI enable command.",
  parameters: { extension: "extension ID exactly as shown by extension_list" },
  execute(args, ctx) {
    const data = cliJson(ctx, "extension", "show", args.extension);
    const manifestPath = `.specbridge/extensions/installed/${args.extension}/1.0.0/specbridge-extension.json`;
    const evidence = [
      citeLine(ctx, manifestPath, `"id": "${args.extension}"`),
      citeLine(ctx, "WORKSPACE.md", `- extension ${args.extension}`),
      // One evidence line per permission so permission-level claims are citable.
      citeLine(ctx, manifestPath, '"specRead"'),
      citeLine(ctx, manifestPath, '"repositoryRead"'),
      citeLine(ctx, manifestPath, '"repositoryWrite"'),
      citeLine(ctx, manifestPath, '"network"'),
      citeLine(ctx, manifestPath, '"childProcess"'),
      citeLine(ctx, manifestPath, '"environmentVariables"'),
    ];
    return {
      summary: `extension(${args.extension}): ${compact(data, 1500)}`,
      data,
      evidence,
    };
  },
};

const SPECBRIDGE_TOOLS: Tool[] = [
  specbridgeDoctorTool as Tool,
  specbridgeSpecListTool as Tool,
  specbridgeSpecStatusTool as Tool,
  specbridgeSpecAnalyzeTool as Tool,
  specbridgeTaskOverviewTool as Tool,
  specbridgeRunnerListTool as Tool,
  specbridgeTemplateListTool as Tool,
  specbridgeVerifyRulesTool as Tool,
  specbridgeExtensionListTool as Tool,
  specbridgeExtensionShowTool as Tool,
];

/**
 * All specbridge-* skills share one read-only toolset; each skill's contract
 * declares which tools are required for its cases.
 */
export function createSpecBridgeToolRegistry(fixtureRoot: string): ToolRegistry {
  const registry = new ToolRegistry({ fixtureRoot });
  for (const tool of SPECBRIDGE_TOOLS) {
    registry.register(tool);
  }
  return registry;
}
