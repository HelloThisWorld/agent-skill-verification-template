# Verification rules — openmind-glossary

Every run is graded by the four shared validators:

1. **Schema** — output matches the `SkillOutput` shape exactly.
2. **Citation** — the cited `file:line` exists in `fixtures/openmind-corpus/`,
   the line supports the claim (shared keyword), the queried term appears on a
   cited line, and the expected source file (e.g. `GLOSSARY.md`) is cited.
3. **Unsupported claim** — unknown terms must come back `insufficient_evidence`
   with zero claims (never an invented definition); answered claims must all
   carry citations; forbidden hallucination markers must be absent.
4. **Tool call** — `glossary_lookup` is always called; `term_usage` only after
   it, matching the contract's `toolOrder`.

Because Open Mind's lookup is deterministic, the expected pass rate across
repeated runs is 100%; any variance is a defect. The `openmind-flaky` adapter
deliberately perturbs outputs to prove these validators fail bad runs.
