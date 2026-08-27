import type {
  CreatePaymentRequest,
  PaymentGateway,
} from '../payments/payment-gateway.js';

export class PilotManualPaymentGateway implements PaymentGateway {
  public readonly providerName = 'pilot-manual';

  public async createPayment(request: CreatePaymentRequest) {
    return {
      providerPaymentId: `pilot-manual-${request.orderId}`,
      paymentToken: null,
    };
  }

  public verifyWebhook(payload: unknown, signature: string | undefined): never {
    void payload;
    void signature;
    throw new Error('PAYMENT_VERIFICATION_FAILED');
  }

  public async refund(request: { orderId: string; amountFen: number; reason: string }): Promise<never> {
    void request;
    throw new Error('MANUAL_REFUND_REQUIRED');
  }
}
