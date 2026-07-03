"""Immutable audit trail for every ledger mutation."""

_EVENTS = []


def audit_event(kind, payload):
    _EVENTS.append({"kind": kind, "payload": payload})
    return len(_EVENTS)


def audit_trail():
    return list(_EVENTS)
