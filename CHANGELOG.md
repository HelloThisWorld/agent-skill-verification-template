# Changelog

All notable changes to Agent Skill Verifier are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows semantic versioning.

## 0.1.0 — 2026-07-17

First downloadable release: the repository's verification harness is now a
real cross-platform CLI product, **agent-skill-verifier**.

### Added

- **`verify` command** — runs every evaluation case N times against a model
  adapter, applies the four structural validators (schema, citations,
  unsupported claims, tool calls), enforces the quality gate
  (threshold + per-case floors + optional flaky-rate ceiling), and writes the
  full report bundle. Non-interactive by design; safe for CI.
- **`validate` command** — static checks for skill contracts, evaluation
  cases (duplicate ids, expected statuses, citation files), adapter names,
  numeric ranges, and output-path safety. Executes no runs.
- **`replay` command** — schema-validated inspection of stored replay
  artifacts (input, output, tool trace, validation verdict). No model call;
  artifacts are never modified.
- **`report` command** — converts the canonical `summary.json` into
  terminal, JSON, JUnit XML, or self-contained HTML without rerunning.
- **Canonical result schema 1.0.0** (`summary.json`) — versioned,
  machine-readable, schema-validated before writing; unsupported metrics are
  `null`, never fabricated.
- **Report bundle** — `summary.json`, `junit.xml`, `report.html` (fully
  self-contained), `events.jsonl`, `metrics.json`, and one replay artifact
  per run under `replays/`.
- **Stable exit codes** — 0 passed · 1 gate failed · 2 invalid input ·
  3 adapter unavailable · 4 runtime failure · 5 timeout/cancelled ·
  6 report/artifact failure.
- **Project configuration** — `skill-verification.yaml|yml|json` with
  documented precedence (CLI flags → config file → defaults). Evaluation
  cases may be YAML or JSON.
- **Standalone executables** for Windows x64, Linux x64, macOS x64, and
  macOS arm64 built with the official Node.js Single Executable Application
  mechanism (pinned Node 22.13.1), plus a portable Node bundle. No Node
  installation or `node_modules` required for the standalone binaries.
- **Release engineering** — per-archive `release-manifest.json` with
  per-file SHA-256, `SHA256SUMS.txt`/`SHA256SUMS.json`, archive content
  validation, packaged-binary smoke tests, and a draft-first tag-driven
  release workflow that verifies every expected asset before publishing.
- **CI** — lint, typecheck, 116 offline tests, build, and packaged-CLI smoke
  test on every push/PR with `contents: read` permissions.

### Changed

- Path resolution is workspace-rooted (the CLI pins it to the current working
  directory), making the harness usable outside this repository.
- The repository README now documents the CLI product; the original
  template/tutorial documentation moved to `docs/reference-implementation.md`
  unchanged in substance.

### Security

- Output confined to the working directory; sanitized replay file names;
  HTML/XML escaping for hostile skill content; secrets only via environment
  variables; release workflow uses least-privilege tokens and never
  overwrites releases or assets. See `docs/threat-model.md`.

### Known limitations

- Binaries are **not code-signed**; OS trust prompts are expected on first
  run. Checksums verify integrity, not publisher identity.
- `replay` inspects recorded artifacts; deterministic model re-execution is
  not claimed.
- Live-adapter (`llm`) verification is non-deterministic by nature; mock
  latency/token/cost metrics are labeled estimates.
