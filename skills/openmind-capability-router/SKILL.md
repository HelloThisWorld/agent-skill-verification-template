---
name: openmind-capability-router
description: Route any query to exactly one documented Open Mind capability (glossary / structure / search) using the deterministic if-else floor — the mode where routing never depends on a model. The decision is grounded by citing the capability's documented registry line. Runs Open Mind's real Python implementation through the skill bridge.
---

# openmind-capability-router

This skill is the eval-harness face of Open Mind's `capability-router`
(https://github.com/HelloThisWorld/open-mind, `skills/capability-router/SKILL.md`).
Decisions come from Open Mind's actual router (`openmind/router.py::route`) in
`use_model=False` mode — the deterministic floor an offline, reproducible eval
can meaningfully gate on. In the app, a ready local model MAY refine the choice,
but its pick is validated against the same closed capability set; this eval
verifies the floor that behavior degrades to.

## Behavior under contract

- **Closed capability set** — every query maps to `glossary`, `structure`, or
  `search`; there is no path that yields anything else.
- **Full trace** — the answer carries `capability`, `decided_by`,
  `deterministic_fallback`, and `reason`, so routing is auditable.
- **Grounded decision** — the claim cites the registry line documenting the
  chosen capability; an invented capability would have no citable line and
  fail validation.

## Question form

Any query string; it is routed as-is.
