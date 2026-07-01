---
name: codebase-understanding
version: 1.0.0
description: Answers questions about a codebase using source-grounded evidence. Every factual claim must cite a specific file and line; ambiguous or unsupported questions return insufficient_evidence instead of a guess.
tools:
  - repo_search
  - read_file
---

# Codebase Understanding

A Claude-style skill that answers natural-language questions about a codebase and
**backs every claim with `file:line` evidence**. It is designed to be verified
like a production component — see [`skill-contract.json`](skill-contract.json) for
the machine-readable contract and [`verification-rules.md`](verification-rules.md)
for how outputs are graded.

## When to use

Use this skill to answer questions such as "Which component publishes
`UserCreatedEvent`?" or "Which file handles payment authorization?" against a known
repository (here, the fixture repo under `fixtures/sample-repo`).

## Tools

| Tool | Purpose |
| --- | --- |
| `repo_search` | Case-insensitive substring search. Returns `{file, line, text}` matches. |
| `read_file` | Read a file by repo-relative path to confirm evidence. |

Contract rule: `repo_search` must be used **before** `read_file`.

## Procedure

1. Identify the key symbols/keywords in the question.
2. Use `repo_search` to locate candidate evidence.
3. Use `read_file` to confirm the strongest candidate.
4. Produce a structured answer where every claim cites a real `file:line`.
5. If the evidence is missing or ambiguous, return `insufficient_evidence` with an
   empty `claims` array. **Never invent an answer or a citation.**

## Output contract

The skill must return JSON with:

- `status`: `answered` | `insufficient_evidence` | `refused`
- `answer`: a short natural-language answer
- `claims`: array of `{ text, citations: [{ file, line }] }`
- `toolCalls`: array of `{ tool, arguments }`
- `confidence` (optional): `low` | `medium` | `high`

See [`examples.md`](examples.md) for concrete input/output pairs.

## Design note: contract vs. model

This SKILL.md and the contract are **model-independent** — they describe what a
correct answer looks like. *How reliably* a given model satisfies the contract
(pass rate, latency, cost, failure modes) is measured separately by the eval
harness and will differ per model. The offline `mock` adapter is a reference
implementation that satisfies the contract deterministically.
