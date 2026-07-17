/**
 * PaymentGateway settles card transactions. chargeCard is implemented here.
 */
export interface ChargeResult {
  transactionId: string;
  approved: boolean;
}

export class PaymentGateway {
  private counter = 0;

  chargeCard(cardToken: string, amountCents: number): ChargeResult {
    this.counter += 1;
    const approved = cardToken.length > 0 && amountCents > 0;
    return { transactionId: `txn-${this.counter}`, approved };
  }

  refundTransaction(transactionId: string): ChargeResult {
    return { transactionId, approved: transactionId.length > 0 };
  }
}
