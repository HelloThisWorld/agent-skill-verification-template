/**
 * InvoiceService creates customer invoices. createInvoice is implemented here.
 */
export interface Invoice {
  id: string;
  orderId: string;
  amountCents: number;
  issuedAt: string;
}

export class InvoiceService {
  private readonly issued: Invoice[] = [];

  createInvoice(orderId: string, amountCents: number): Invoice {
    const invoice: Invoice = {
      id: `inv-${this.issued.length + 1}`,
      orderId,
      amountCents,
      issuedAt: new Date().toISOString(),
    };
    this.issued.push(invoice);
    return invoice;
  }

  listInvoices(): readonly Invoice[] {
    return this.issued;
  }
}
