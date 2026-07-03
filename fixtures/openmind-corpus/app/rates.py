"""Currency conversion for LedgerLab."""

RATES = {("USD", "EUR"): 0.92, ("EUR", "USD"): 1.09}


class RateTable:
    """Daily conversion factors, keyed by (base, quote) currency pair."""

    def __init__(self, rates=None):
        self.rates = dict(rates or RATES)

    def factor(self, base, quote):
        if base == quote:
            return 1.0
        return self.rates[(base, quote)]


def convert(amount, base, quote, table=None):
    table = table or RateTable()
    return round(amount * table.factor(base, quote), 2)
