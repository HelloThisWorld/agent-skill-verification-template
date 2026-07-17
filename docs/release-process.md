# Release process

Agent Skill Verifier ships as standalone executables (Windows x64, Linux x64,
macOS x64, macOS arm64), a portable Node bundle, and `SHA256SUMS.txt` — all
built and published by the tag-driven [release workflow](../.github/workflows/release.yml).

## Pinned toolchain

- **Node 22.13.1** for all CI and release builds (`NODE_VERSION` in the
  workflows). The standalone binaries follow the official
  [Node.js Single Executable Application](https://nodejs.org/docs/latest-v22.x/api/single-executable-applications.html)
  procedure of exactly this version: esbuild bundles the CLI to one CommonJS
  file, `node --experimental-sea-config` produces the preparation blob, and
  `postject` (pinned `1.0.0-alpha.6`) injects it into a copy of the Node
  binary. On macOS the copy is ad-hoc re-signed (`codesign -s -`).
- **esbuild** pinned exact (`0.25.5`) for the bundle; version injected at
  build time via a compile-time define; no source maps in release artifacts.
- Each platform binary is built on its native GitHub-hosted runner
  (`windows-latest`, `ubuntu-latest`, `macos-15-intel`, `macos-14`).

## Versioning

The single source of truth is `package.json`'s `version`. The release tag is
`v<version>` and must match — the workflow's first step fails otherwise
(`release-check --tag-only`). The CLI, the release manifests, the archive
filenames, and the Release title all derive from the same value. Existing
tags and releases are never overwritten; to release again, bump the patch
version.

## Dry run (required before tagging)

Trigger the **release** workflow manually (`workflow_dispatch`, "Run
workflow" in the Actions tab, or `gh workflow run release.yml`). A dispatch
run executes the full verify + all platform builds + smoke tests and uploads
the archives as *workflow artifacts* — but the publication job is skipped, so
no tag, no Release, and no `contents: write` is ever used. Inspect the
artifacts before proceeding.

## Publishing

```bash
git tag -a v0.1.0 -m "Agent Skill Verifier v0.1.0"
git push origin v0.1.0
```

The workflow then:

1. **verify** — tag/version consistency, lint, typecheck, tests, portable
   bundle smoke test.
2. **build-platform / build-portable** — native builds; each archive gets a
   `release-manifest.json` (per-file SHA-256, commit, pinned Node version),
   is content-validated (`release-check --require-commit-match`), and
   smoke-tested from a directory outside the checkout.
3. **release** (tag pushes only; the only job with `contents: write`) —
   downloads all artifacts, requires the exact expected asset set, re-verifies
   manifests and checksums, generates release notes, **creates a draft**,
   uploads all assets without clobbering, confirms the uploaded asset list
   matches, and only then publishes the draft as the latest release.

A failure at any point leaves at most an unpublished draft — never a partial
public release.

## Local equivalents

```bash
npm run build:cli          # bundle -> dist/cli/agent-skill-verifier.cjs
npm run build:standalone   # SEA binary for this platform -> dist/sea/
npm run package:release    # this platform's archive + portable -> dist/release/
npm run release:checksums  # SHA256SUMS.txt / SHA256SUMS.json
npm run release:check      # validate archives, manifests, forbidden files
npm run release:smoke      # run the packaged CLI from a temp dir (16 checks)
```

## Signing status

Binaries are **not code-signed** (no Authenticode, no Apple notarization).
Checksums authenticate content integrity only. This is documented in the
release notes and README so users know to expect OS trust prompts.
