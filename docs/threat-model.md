# Threat model — Agent Skill Verifier

Scope: the `agent-skill-verifier` CLI, its report artifacts, and the release
pipeline. The verifier processes **untrusted inputs** (skill directories,
evaluation cases, replay artifacts, configuration files) and produces
artifacts consumed by browsers and CI systems, so both directions are modeled.

## Assets

- The user's machine and CI environment (filesystem, environment variables).
- Provider credentials (`LLM_API_KEY` and similar).
- Report artifacts consumed downstream (HTML in browsers, JUnit in CI).
- The published release assets and their integrity.

## Threats and mitigations

| Threat | Mitigation |
|--------|------------|
| **Malicious skill content** (hostile names, descriptions, corpus text) | All contract/case content is schema-validated (zod) on load; content is treated as data, never executed; HTML reports escape `& < > "` and JUnit escapes `& < > " '` plus strips control characters, so hostile content cannot inject markup (regression-tested). |
| **Malicious evaluation files** (YAML/JSON) | Parsed with `yaml`'s safe defaults (no custom tags → no code execution) and `JSON.parse`; schema-validated; duplicate ids rejected; case content never interpolated into shell commands. |
| **Path traversal via case/citation paths** | Cited files are only ever *read* and compared; reads resolve inside the workspace root. Tools read only beneath the contract's `fixtureRoot`. |
| **Output directory escape** | `--output` (and config `output.directory`) must resolve inside the working directory; filesystem roots are rejected; replay file names are sanitized to `[A-Za-z0-9._-]` with collision suffixes; only known generated files are cleaned. |
| **Secret leakage** | Credentials are accepted **only** via environment variables, never CLI flags (which leak via shell history/process lists). Reports, manifests, and replay artifacts contain no environment values. The bundler emits no source maps; release-check rejects `.env*`, key files, and `node_modules` inside archives. |
| **Malformed provider output** | Adapter output is schema-validated per run; a crashing adapter marks the run errored/failed instead of crashing the verifier; timeouts abort with exit 5. |
| **HTML injection** | Single escaping chokepoint in the HTML builder; self-contained output (no external scripts/styles), verified by tests. |
| **XML injection** | JUnit builder escapes all user-controlled strings and strips XML-invalid control characters; well-formedness is tested against hostile fixtures. |
| **Release tag injection** | Tags must match `^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$` and equal `v<package version>` (`release-check --tag-only`), enforced in the workflow before any build is used. Tag names are only passed to `gh` as argv values, never interpolated into scripts. |
| **Malicious asset filename** | Asset names are generated from the validated package version; the release job accepts only the expected asset set (`--require-assets`) and fails on anything missing; manifest file paths must be plain file names (no separators, no `..`). |
| **Incomplete release publication** | Draft-first: the release is created as a draft, every asset is uploaded and then compared against the expected list, checksums are re-verified, and only then is the draft published. A failure leaves a draft, never a partial public release. Existing releases/assets are never overwritten (no `--clobber`, explicit existence check). |
| **Compromised release dependency** | Runtime deps are three audited pure-JS packages (commander, zod, yaml) installed from the lockfile (`npm ci`); build tools (esbuild, postject) are pinned exact; release jobs run `npm ci` from the same lockfile; the SEA binary embeds only the bundled first-party code and inlined deps. |
| **Archive traversal ("zip slip")** | Archives are *produced* from a controlled staging directory with flat, sanitized names; `release-check` re-extracts every archive and fails on any path containing separators or `..` in the manifest listing. |
| **Embedded build-machine paths** | No source maps; `release-check` scans archives for forbidden files; the bundle embeds the version via a compile-time define instead of reading local paths; smoke tests run the binary from a temp directory to prove no repo-path dependence. |
| **CI privilege escalation** | Ordinary CI: `permissions: contents: read`. Only the `release` job has `contents: write`, it runs only on pushed `v*` tags (never pull requests, never manual dispatch), and uses the ephemeral `github.token` — no PATs stored anywhere. |

## Non-goals / residual risk

- **Publisher identity**: checksums prove integrity, not identity. Binaries
  are not code-signed; users see OS trust prompts (documented).
- **Malicious `node` on PATH** (portable bundle) or a compromised GitHub
  account/runner are outside this model.
- The optional live `llm` adapter sends case content to the configured
  endpoint; users choose that endpoint and credentials deliberately.
