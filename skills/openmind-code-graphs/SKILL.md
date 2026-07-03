---
name: openmind-code-graphs
description: Answer code-structure questions (definition sites, usage sites) from Open Mind's deterministic structure map — real defs, imports and call sites recovered from the corpus code, never invented nodes or edges. Runs Open Mind's real Python implementation through the skill bridge.
---

# openmind-code-graphs

This skill is the eval-harness face of Open Mind's `code-graphs` capability
(https://github.com/HelloThisWorld/open-mind, `skills/code-graphs/SKILL.md`).
Answers come from Open Mind's actual structure analysis
(`openmind/structure.py`: `build_structure`, `get_definition`, `term_usage`),
reached through `openmind/skill_bridge.py`.

## Behavior under contract

- **Recovered, never generated** — definition sites and usage edges come from
  line-oriented static analysis of the corpus's real code.
- **Source locations everywhere** — a definition claim cites the actual
  `file:line` of the `def`/`class` statement, re-verified on every run.
- **Honest absence** — a symbol not defined in the corpus returns
  `insufficient_evidence` with zero claims; usage lists only files that truly
  reference the symbol.

## Question forms

`where is <symbol> defined` · `who uses <symbol>`
