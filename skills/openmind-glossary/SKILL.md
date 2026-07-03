---
name: openmind-glossary
description: Resolve a term against Open Mind's deterministic, source-traceable glossary — verbatim definitions with file:line provenance, exact-token lookup, honest "not found" for unknown terms. Runs Open Mind's real Python implementation through the skill bridge.
---

# openmind-glossary

This skill is the eval-harness face of Open Mind's `glossary` capability
(https://github.com/HelloThisWorld/open-mind, `skills/glossary/SKILL.md`). The
answers are produced by Open Mind's actual extraction + lookup code
(`openmind/glossary.py`, `openmind/structure.py::term_usage`), reached through
`openmind/skill_bridge.py`; nothing in this repo reimplements them.

## Behavior under contract

- **Verbatim, never generated** — the definition is the exact original text
  lifted from the corpus's authoritative source (dedicated glossary file,
  definition table/line, README acronym expansion, doc-comment).
- **Provenance mandatory** — every entry carries `source_file:line_number`; the
  claim cites that exact line, and the validators re-read it on every run.
- **Exact-token lookup** — no similarity, no paraphrase. Unknown terms return
  `insufficient_evidence` with zero claims.
- **Grounded usage profile** — when the term is also a code symbol, a second
  claim cites its real definition site from the deterministic structure map.

## Question forms

`define <term>` · `glossary <term>` · `what is <term>`
