export type CreatePaymentRequest = {
  orderId: string;
  amountFen: number;
  currency: 'CNY';
};

export type CreatedPayment = {
  providerPaymentId: string;
  paymentToken: string | null;
};

export type VerifiedPaymentEvent = {
  eventId: string;
  providerPaymentId: string;
  orderId: string;
  amountFen: number;
  currency: 'CNY';
  status: 'SUCCEEDED';
};

export interface PaymentGateway {
  readonly providerName: string;
  createPayment(request: CreatePaymentRequest): Promise<CreatedPayment>;
  verifyWebhook(payload: unknown, signature: string | undefined): VerifiedPaymentEvent;
  refund(request: { orderId: string; amountFen: number; reason: string }): Promise<{
    providerRefundId: string;
  }>;
}
