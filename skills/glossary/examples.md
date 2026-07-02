# Examples

Concrete input/output pairs for the `glossary` skill. The `glossary` reference
adapter produces outputs of exactly this shape, deterministically, from the
offline snapshots in `fixtures/wikipedia/`.

## Answered — `glossary Mexico`

Input:

```json
{ "question": "glossary Mexico" }
```

Output (abridged):

```json
{
  "status": "answered",
  "answer": "Mexico — Country in North America. Mexico, officially the United Mexican States, is a country in North America.",
  "claims": [
    {
      "text": "Mexico (Wikipedia article: Mexico) — Country in North America.",
      "citations": [{ "file": "fixtures/wikipedia/Mexico.html", "line": 9 }]
    }
  ],
  "toolCalls": [
    { "tool": "wikipedia_search", "arguments": { "query": "Mexico" } },
    { "tool": "wikipedia_fetch", "arguments": { "path": "fixtures/wikipedia/Mexico.html" } }
  ],
  "confidence": "high"
}
```

The cited line 9 is the snapshot's `lede`, which contains the exact query term
`Mexico`, so the citation validator's *required-symbol* and *support* checks
both pass. The web-page deliverable for this term is written to
`reports/latest/glossary/Mexico.html`.

## Insufficient evidence — `glossary Wakanda`

Input:

```json
{ "question": "glossary Wakanda" }
```

Output:

```json
{
  "status": "insufficient_evidence",
  "answer": "No Wikipedia snapshot found for \"Wakanda\"; cannot provide a source-grounded definition.",
  "claims": [],
  "toolCalls": [{ "tool": "wikipedia_search", "arguments": { "query": "Wakanda" } }],
  "confidence": "low"
}
```

No snapshot exists for the term, so the skill declines rather than inventing a
definition — exactly the behavior the negative cases assert.
