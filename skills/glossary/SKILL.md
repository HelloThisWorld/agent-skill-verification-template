---
name: glossary
version: 1.0.0
description: Looks up "glossary <term>" on English Wikipedia and returns a source-grounded definition rendered as a web page. Every claim cites the exact snapshot line carrying the term; unknown terms return insufficient_evidence instead of a guess.
tools:
  - wikipedia_search
  - wikipedia_fetch
---

# Glossary (Wikipedia)

A Claude-style skill that answers **`glossary <term>`** requests by looking the
term up on English Wikipedia and returning a definition **rendered as a web
page**, where every factual claim is backed by a `file:line` citation into the
fetched article. It is built to be verified like a production component — see
[`skill-contract.json`](skill-contract.json) for the machine-readable contract
and [`verification-rules.md`](verification-rules.md) for how outputs are graded.

## When to use

Use this skill for requests such as `glossary Mexico` or `glossary Switzerland`.
The term after `glossary` is looked up; the skill produces a concise,
source-grounded definition and a self-contained HTML page for it.

## Tools

| Tool | Purpose |
| --- | --- |
| `wikipedia_search` | Search the offline Wikipedia snapshot cache. Returns `{title, file, line, text}` matches, best article first. |
| `wikipedia_fetch` | Read a snapshot and return its structured article data plus the citable "lede" line. |

Contract rule: `wikipedia_search` must be used **before** `wikipedia_fetch`.

## Offline-first design

Like the rest of this template, the default eval runs **fully offline and
deterministically**. `npm run glossary:build-cache` fetches each term once from
English Wikipedia (MediaWiki action API) and writes a citable snapshot to
`fixtures/wikipedia/<term>.html`. Each snapshot embeds a machine-readable
`glossary-data` JSON block and a `lede` line that contains the **exact query
term verbatim**, so citations stay valid even when Wikipedia's canonical title
or opening phrasing differs from the query. After the cache exists, no network
is required to run or verify the skill.

## Procedure

1. Parse the term from the `glossary <term>` request.
2. Use `wikipedia_search` to locate the best-matching snapshot.
3. Use `wikipedia_fetch` to read the snapshot and confirm the citable line.
4. Produce a structured answer whose claim cites that `file:line`.
5. If no snapshot matches the term, return `insufficient_evidence` with an empty
   `claims` array. **Never invent a definition or a citation.**

## Output contract

The skill returns JSON with:

- `status`: `answered` | `insufficient_evidence` | `refused`
- `answer`: a short natural-language definition
- `claims`: array of `{ text, citations: [{ file, line }] }`
- `toolCalls`: array of `{ tool, arguments }`
- `confidence` (optional): `low` | `medium` | `high`

The **web-page deliverable** (`reports/latest/glossary/<term>.html` plus an
`index.html`) is rendered from the same grounded snapshot by
[`src/skills/glossary/render.ts`](../../src/skills/glossary/render.ts). See
[`examples.md`](examples.md) for a concrete input/output pair.

## Design note: contract vs. model

This SKILL.md and the contract are **model-independent** — they describe what a
correct answer looks like. *How reliably* a given model satisfies the contract is
measured separately by the eval harness. The offline `glossary` adapter is a
reference implementation that satisfies the contract deterministically; the
`glossary-flaky` adapter perturbs it to demonstrate failure detection.
