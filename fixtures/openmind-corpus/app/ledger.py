"""The append-only ledger of balanced postings."""

from rates import convert

_ENTRIES = []


def post_entry(debit_account, credit_account, amount, currency="USD"):
    normalized = convert(amount, currency, "USD")
    entry = {"debit": debit_account, "credit": credit_account,
             "amount": normalized, "currency": "USD"}
    _ENTRIES.append(entry)
    return entry


def balance_of(account):
    debits = sum(e["amount"] for e in _ENTRIES if e["debit"] == account)
    credits = sum(e["amount"] for e in _ENTRIES if e["credit"] == account)
    return round(credits - debits, 2)
