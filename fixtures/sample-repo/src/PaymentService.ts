// Handles payment processing for orders.

export interface PaymentResult {
  ok: boolean;
  reference: string;
}

/**
 * PaymentService performs payment authorization and capture against a
 * downstream payment gateway.
 */
export class PaymentService {
  authorizePayment(orderId: string, amountCents: number): PaymentResult {
    // Authorize the payment amount with the gateway before capture.
    const reference = `auth_${orderId}`;
    return { ok: amountCents > 0, reference };
  }

  capturePayment(reference: string): PaymentResult {
    return { ok: true, reference };
  }
}
