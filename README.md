# Agent Skill Verifier

> A model-independent quality gate for AI agent skills.

Verify agent skills through repeatable eval runs, replayable artifacts,
structured reports, and CI-friendly exit codes.

[![ci](https://github.com/HelloThisWorld/agent-skill-verification-template/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/HelloThisWorld/agent-skill-verification-template/actions/workflows/ci.yml)
[![skill-eval](https://github.com/HelloThisWorld/agent-skill-verification-template/actions/workflows/skill-eval.yml/badge.svg?branch=main)](https://github.com/HelloThisWorld/agent-skill-verification-template/actions/workflows/skill-eval.yml)
![license](https://img.shields.io/badge/license-MIT-green)

```bash
agent-skill-verifier verify \
  --skill ./skills/calendar \
  --cases ./evals/calendar.yaml \
  --runs 10 \
  --threshold 0.90
```

One command runs every evaluation case N times against a model adapter,
validates each run structurally (schema, source-grounded citations,
unsupported claims, tool usage), and fails the build when the pass rate drops
below your threshold. The default adapters are fully offline — no API keys, no
network, no flaky external dependencies in CI.

This repository is both the **CLI product** and a complete
**reference implementation**: the [reference guide](docs/reference-implementation.md)
walks through building an observable, replayable, verification-gated skill
from scratch.

---

## What it verifies

Every run of a skill is checked by four validators:

| Validator | Checks |
|-----------|--------|
| `schema` | the output is structurally valid (status, answer, claims, tool calls) |
| `citation` | every claim cites a real file and line, and cited lines actually support the claim |
| `unsupported_claim` | no forbidden or ungrounded claims (hallucination guard) |
| `tool_call` | required tools were used, in the contract-declared order |

A **quality gate** passes only when the overall pass rate clears your
threshold *and* every case clears its own floor (`minPassRate`), with an
optional flaky-case-rate ceiling.

## Download

Grab the [latest release](https://github.com/HelloThisWorld/agent-skill-verification-template/releases/latest):

| Platform | Asset |
|----------|-------|
| Windows x64 | `agent-skill-verifier-v<version>-windows-x64.zip` |
| Linux x64 | `agent-skill-verifier-v<version>-linux-x64.tar.gz` |
| macOS x64 (Intel) | `agent-skill-verifier-v<version>-macos-x64.tar.gz` |
| macOS arm64 (Apple silicon) | `agent-skill-verifier-v<version>-macos-arm64.tar.gz` |
| Any platform with Node.js ≥ 18.18 | `agent-skill-verifier-v<version>-node.zip` (portable) |

Every release ships `SHA256SUMS.txt`. Checksums detect corrupted or tampered
downloads; they do not prove publisher identity. **Binaries are not
code-signed**, so Windows SmartScreen / macOS Gatekeeper may warn on first run.

### Windows

```powershell
Expand-Archive agent-skill-verifier-v0.1.0-windows-x64.zip -DestinationPath agent-skill-verifier
cd agent-skill-verifier
Get-FileHash ..\agent-skill-verifier-v0.1.0-windows-x64.zip -Algorithm SHA256   # compare with SHA256SUMS.txt
.\agent-skill-verifier.exe --version
```

### Linux

```bash
curl -fsSLO https://github.com/HelloThisWorld/agent-skill-verification-template/releases/download/v0.1.0/agent-skill-verifier-v0.1.0-linux-x64.tar.gz
curl -fsSLO https://github.com/HelloThisWorld/agent-skill-verification-template/releases/download/v0.1.0/SHA256SUMS.txt
sha256sum -c --ignore-missing SHA256SUMS.txt
tar -xzf agent-skill-verifier-v0.1.0-linux-x64.tar.gz
./agent-skill-verifier --version
```

### macOS

```bash
curl -fsSLO https://github.com/HelloThisWorld/agent-skill-verification-template/releases/download/v0.1.0/agent-skill-verifier-v0.1.0-macos-x64.tar.gz   # or -macos-arm64
curl -fsSLO https://github.com/HelloThisWorld/agent-skill-verification-template/releases/download/v0.1.0/SHA256SUMS.txt
shasum -a 256 -c --ignore-missing SHA256SUMS.txt
tar -xzf agent-skill-verifier-v0.1.0-macos-x64.tar.gz
./agent-skill-verifier --version
```

The binaries are ad-hoc signed at best; on first run macOS may require
*System Settings → Privacy & Security → Open Anyway*.

### Portable (any platform with Node.js ≥ 18.18)

```bash
unzip agent-skill-verifier-v0.1.0-node.zip -d agent-skill-verifier
node agent-skill-verifier/agent-skill-verifier.cjs --version
# or use the bundled launchers: agent-skill-verifier.cmd (Windows) / agent-skill-verifier (POSIX)
```

## CLI commands

```text
agent-skill-verifier verify     run the eval suite and write the report bundle
agent-skill-verifier validate   statically check a skill + cases (no runs executed)
agent-skill-verifier replay     inspect a stored replay artifact (no model call)
agent-skill-verifier report     convert summary.json to terminal/json/junit/html
agent-skill-verifier --help     usage
agent-skill-verifier --version  version
```

### verify

```bash
agent-skill-verifier verify \
  --skill ./fixtures/valid-skill \
  --cases ./fixtures/evals.yaml \
  --runs 10 \
  --threshold 0.90 \
  --output ./.agent-skill-verification
```

Key options: `--adapter <name>` (default `mock`), `--seed <n>` for
deterministic mock runs, `--timeout-ms <ms>` overall budget, `--json` for
machine-readable output (never contains ANSI codes), `--quiet` / `--verbose`,
`--no-fail-on-threshold` to always exit 0 on completed runs,
`--non-interactive` (accepted for CI clarity — the CLI never prompts).

All paths are resolved relative to the current working directory. The output
directory must stay inside it.

### validate

```bash
agent-skill-verifier validate --skill ./fixtures/valid-skill --cases ./fixtures/evals.yaml
```

Checks the skill contract, evaluation-case schema, duplicate case ids,
expected citation files, adapter name, threshold/runs ranges, and output-path
safety — without executing a single evaluation run.

### replay

```bash
agent-skill-verifier replay .agent-skill-verification/replays/case-001-run-01.json
```

Replay is **stored-artifact inspection**: the artifact already contains the
exact input, output, tool trace, and validation verdict of the recorded run,
so failures can be understood without invoking any model. The artifact is
schema-validated and never modified. (Deterministic model *re-execution* is
not claimed.)

### report

```bash
agent-skill-verifier report \
  --input .agent-skill-verification/summary.json \
  --format html \
  --output report.html
```

Converts the canonical result into `terminal`, `json`, `junit`, or `html`
without rerunning anything.

## Configuration

Place a `skill-verification.yaml` (or `.yml` / `.json`) in your project root,
or point at one with `--config`:

```yaml
schemaVersion: "1.0.0"

skill:
  path: ./fixtures/valid-skill

evaluation:
  cases: ./fixtures/evals.yaml
  runs: 10
  threshold: 0.90
  seed: 12345

adapter:
  name: mock

output:
  directory: .agent-skill-verification
  formats: [json, junit, html, replay]

qualityGate:
  failOnThreshold: true
  maximumFlakyRate: 0.05
```

Precedence: **CLI flags → configuration file → built-in defaults**.
A copy of this example lives at [examples/skill-verification.yaml](examples/skill-verification.yaml).

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | verification passed (or informational command succeeded) |
| 1 | verification completed but the quality gate failed |
| 2 | invalid CLI input, configuration, skill, or evaluation cases |
| 3 | adapter, provider, or model unavailable |
| 4 | verification runtime failure |
| 5 | timeout or cancellation |
| 6 | report or artifact failure |

JSON mode (`--json`) always prints the normalized result document, pass or
fail, so CI can consume it regardless of the exit code.

## Report formats

`verify` writes a deterministic bundle (timestamps and measured latency aside):

```text
.agent-skill-verification/
├── summary.json     canonical verification result (schemaVersion 1.0.0)
├── report.html      self-contained HTML report (no external assets)
├── junit.xml        JUnit XML for CI test-report ingestion
├── events.jsonl     structured event log
├── metrics.json     aggregate metrics document
└── replays/         one replay artifact per run: <case>-run-<NN>.json
```

`summary.json` is the single source of truth; every other format can be
regenerated from it with `agent-skill-verifier report`. Metrics the verifier
cannot measure are `null` — never fabricated. With the offline mock adapters,
latency/token/cost figures are clearly labeled as estimated demo values.

## CI example (GitHub Actions)

Pin an exact version in CI — do not download `latest` in a reproducible
pipeline:

```yaml
jobs:
  verify-skill:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    env:
      ASV_VERSION: 0.1.0
      ASV_SHA256: "<sha256 of agent-skill-verifier-v0.1.0-linux-x64.tar.gz from SHA256SUMS.txt>"
    steps:
      - uses: actions/checkout@v4

      - name: Download a pinned agent-skill-verifier release
        run: |
          curl -fsSLO "https://github.com/HelloThisWorld/agent-skill-verification-template/releases/download/v${ASV_VERSION}/agent-skill-verifier-v${ASV_VERSION}-linux-x64.tar.gz"
          echo "${ASV_SHA256}  agent-skill-verifier-v${ASV_VERSION}-linux-x64.tar.gz" | sha256sum -c -
          tar -xzf "agent-skill-verifier-v${ASV_VERSION}-linux-x64.tar.gz"

      - name: Validate the skill (no runs)
        run: ./agent-skill-verifier validate --skill ./skills/my-skill --cases ./evals/my-skill.yaml

      - name: Verify the skill (offline mock adapter)
        run: |
          ./agent-skill-verifier verify \
            --skill ./skills/my-skill \
            --cases ./evals/my-skill.yaml \
            --runs 10 \
            --threshold 0.90 \
            --output verification

      - name: Upload verification reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: skill-verification-report
          path: verification
```

For provider-backed verification, pass credentials through GitHub secrets as
environment variables (e.g. `LLM_BASE_URL`, `LLM_API_KEY`) — never as CLI
arguments and never committed.

## Adapters

| Adapter | Type | Use |
|---------|------|-----|
| `mock` | offline, deterministic | default; source-grounded answers from your fixture corpus |
| `mock-flaky` | offline, deterministic | demonstrates failure detection, flaky-case reporting, replay artifacts |
| `glossary`, `glossary-flaky`, `openmind`, `openmind-flaky` | offline | reference-implementation demo skills |
| `llm` | live, OpenAI-compatible | real-model verification; configure via `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_JSON_MODE`, `LLM_MAX_ROUNDS`, `LLM_TIMEOUT_MS` |
| `openai-stub`, `anthropic-stub`, `ollama-stub` | stubs | integration points for your own adapters |

Secrets are read from environment variables only; they are never accepted as
CLI values, never written into reports, and never embedded in binaries.

## Security

- Output paths are confined to the working directory; replay file names are
  sanitized; HTML and XML output is escaped (hostile skill/case content cannot
  inject markup).
- Ordinary CI runs with `contents: read`; only the release job holds
  `contents: write`. Releases are draft-first, never overwrite an existing
  release or asset, and publish only after every expected asset is verified.
- See the [threat model](docs/threat-model.md) for the full analysis.

## Reproducibility limitations

- The `mock` adapters are fully deterministic under a fixed `--seed`; live
  model adapters are inherently non-deterministic — expect pass-rate variance
  and use thresholds rather than exact-match expectations.
- `replay` inspects recorded runs; it does not re-execute a model.
- Mock latency/token/cost metrics are labeled estimates, not measurements.

## Development

```bash
npm ci
npm run lint && npm run typecheck && npm test   # 116 tests, fully offline
npm run cli -- verify --skill fixtures/valid-skill --cases fixtures/evals.yaml --runs 3
npm run build:cli        # dist/cli/agent-skill-verifier.cjs (bundled)
npm run build:standalone # dist/sea/agent-skill-verifier[.exe] via Node SEA
npm run package:release  # dist/release/*.zip|tar.gz for this platform
npm run release:check && npm run release:smoke
```

The reference implementation (skills, contracts, validators, observability,
tutorial) is documented in [docs/reference-implementation.md](docs/reference-implementation.md).

## Release process

Releases are built by [.github/workflows/release.yml](.github/workflows/release.yml)
on native GitHub runners with a pinned Node version, using the official
Node.js Single Executable Application mechanism. Draft-first publication:
assets and checksums are verified before the release goes live. See
[docs/release-process.md](docs/release-process.md) — including how to run the
manual build-only dry run before tagging.

## License

[MIT](LICENSE)
