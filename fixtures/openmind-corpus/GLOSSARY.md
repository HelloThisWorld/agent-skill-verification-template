# Glossary

Authoritative terminology for the LedgerLab fixture project. This file is the
highest-priority definition source: entries here win over README or doc-comment
definitions for the same term.

| Term | Definition |
| --- | --- |
| Ledger | The append-only book of balanced postings kept for every tenant. |
| Posting | One balanced debit/credit pair recorded against exactly two accounts. |
| RateTable | The daily currency conversion factors loaded from the treasury feed. |
| AuditTrail | The immutable event log written after every mutation. |

FX: Foreign exchange — the currency conversion applied when an entry crosses currencies.

SLA: The response-time commitment printed on every tenant invoice.
