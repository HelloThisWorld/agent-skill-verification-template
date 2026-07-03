# Verification rules — openmind-capability-router

Every run is graded by the four shared validators:

1. **Schema** — output matches the `SkillOutput` shape exactly.
2. **Citation** — the claim cites an existing line of
   `fixtures/openmind-corpus/CAPABILITIES.md`, and the expected capability for
   the test query appears on that cited line.
3. **Unsupported claim** — forbidden markers assert two honesty properties:
   the router never reports an invented capability (e.g. `quantum`), and in
   this eval mode it never reports `decided_by: model`.
4. **Tool call** — `route_query` must be called before `capability_registry`.

The router always answers (unroutable queries fall back to `search`), so
negative cases here are fabrication tripwires rather than declines. The routing
floor is pure string logic — expected pass rate is 100% across repeated runs.
