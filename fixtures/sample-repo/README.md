# Sample Repo (Fixture)

This is a **synthetic fixture codebase** used by the eval harness. It is intentionally
tiny and contains no real user data or secrets. The `codebase-understanding` skill answers
questions about this code, and the citation validator checks that answers point to real
`file:line` evidence inside this folder.

## Components

- `src/UserService.ts` — creates and loads users; delegates event publishing.
- `src/UserEventPublisher.ts` — publishes user lifecycle domain events (e.g. `UserCreatedEvent`).
- `src/PaymentService.ts` — performs payment authorization and capture.
- `src/NotificationService.ts` — sends user-facing notifications, including the welcome notification.

Because this repo is a fixture, the code favors clarity over completeness. It is never
executed by the harness — the tools only read it as text to locate evidence.
