"""LedgerLab entry point."""

from audit import audit_event
from ledger import balance_of, post_entry


def run_demo():
    post_entry("cash", "revenue", 125.0, currency="EUR")
    audit_event("posting", {"account": "cash"})
    return balance_of("revenue")


if __name__ == "__main__":
    print(run_demo())
