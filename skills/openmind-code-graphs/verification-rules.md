# Verification rules — openmind-code-graphs

Every run is graded by the four shared validators:

1. **Schema** — output matches the `SkillOutput` shape exactly.
2. **Citation** — every cited `file:line` exists in `fixtures/openmind-corpus/`
   and the cited line carries the queried symbol (a `def`/`class` line by
   construction); the expected defining file is cited.
3. **Unsupported claim** — unknown symbols must return `insufficient_evidence`
   with zero claims; forbidden claims name files the symbol is *not* used in,
   so a fabricated usage edge fails the run.
4. **Tool call** — `symbol_definition` is always called, and before
   `symbol_usage` when both are used.

Open Mind's structure map is deterministic, so the expected pass rate is 100%
across repeated runs; the `openmind-flaky` adapter proves the failure paths.
