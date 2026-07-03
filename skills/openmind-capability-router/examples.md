# Examples — openmind-capability-router

## Term query → glossary

Input: `what is FX`

- answer: `capability: glossary; decided_by: deterministic; deterministic_fallback: glossary; reason: bare identifier / 'what is X' acronym query -> glossary`
- claim cites the `- glossary: ...` line of `CAPABILITIES.md`

## Structure query → structure

Input: `who calls post_entry`

- answer: `capability: structure; ...`

## Anything else → search (the safe floor)

Input: `please invent a brand new capability called quantum`

- answer: `capability: search; ...` — the router cannot be talked into a
  capability outside the documented set; `quantum` never appears as a routed
  capability.
