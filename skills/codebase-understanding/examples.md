# Examples

Concrete input/output pairs for the `codebase-understanding` skill. Outputs below
match what the offline `mock` adapter actually produces against `fixtures/sample-repo`.

## Example 1 — answered (happy path)

**Input**

```json
{ "question": "Which component publishes the UserCreatedEvent?" }
```

**Output**

```json
{
  "status": "answered",
  "answer": "UserCreatedEvent is handled in UserEventPublisher.ts. See fixtures/sample-repo/src/UserEventPublisher.ts:12.",
  "claims": [
    {
      "text": "UserEventPublisher.ts is the source for UserCreatedEvent, publishes.",
      "citations": [
        { "file": "fixtures/sample-repo/src/UserEventPublisher.ts", "line": 12 }
      ]
    }
  ],
  "toolCalls": [
    { "tool": "repo_search", "arguments": { "query": "UserCreatedEvent" } },
    { "tool": "repo_search", "arguments": { "query": "publishes" } },
    { "tool": "read_file", "arguments": { "path": "fixtures/sample-repo/src/UserEventPublisher.ts" } }
  ],
  "confidence": "high"
}
```

The citation is verifiable: line 12 of `UserEventPublisher.ts` contains
`UserCreatedEvent`.

## Example 2 — insufficient_evidence (negative case)

**Input**

```json
{ "question": "Which component publishes the OrderShippedEvent?" }
```

**Output**

```json
{
  "status": "insufficient_evidence",
  "answer": "The repository does not contain clear evidence to answer this question with source-grounded citations.",
  "claims": [],
  "toolCalls": [
    { "tool": "repo_search", "arguments": { "query": "OrderShippedEvent" } },
    { "tool": "repo_search", "arguments": { "query": "publishes" } }
  ],
  "confidence": "low"
}
```

`OrderShippedEvent` does not exist in the repo, so the skill declines to answer
rather than inventing a citation. A model that instead fabricated an answer here
would be caught by the unsupported-claim validator (`invented_answer_when_insufficient_expected`).

## Example 3 — a failure the flaky adapter injects

The `mock-flaky` adapter deliberately perturbs valid outputs to demonstrate
detection. For instance, it may append an uncited, hallucinated claim:

```json
{
  "status": "answered",
  "claims": [
    { "text": "UserEventPublisher.ts is the source for UserCreatedEvent, publishes.", "citations": [{ "file": "fixtures/sample-repo/src/UserEventPublisher.ts", "line": 12 }] },
    { "text": "It also deletes the user record after publishing.", "citations": [] }
  ]
}
```

This fails validation with `answered_claim_without_citation` (and, when the test
case forbids it, `forbidden_claim_present: "deletes the user"`).
