import type { CreatePaymentRequest, PaymentGateway, VerifiedPaymentEvent } from '../payments/payment-gateway.js';

export interface WechatPayClient {
  createTransaction(request: CreatePaymentRequest): Promise<{ prepayId: string }>;
  verifyAndDecryptNotification(payload: unknown, signature: string): VerifiedPaymentEvent;
  refund(request: { orderId: string; amountFen: number; reason: string }): Promise<{ refundId: string }>;
}

export class WechatPayGateway implements PaymentGateway {
  public readonly providerName = 'wechat';
  public constructor(private readonly client: WechatPayClient) {}
  public async createPayment(request: CreatePaymentRequest) {
    const transaction = await this.client.createTransaction(request);
    return { providerPaymentId: transaction.prepayId, paymentToken: transaction.prepayId };
  }
  public verifyWebhook(payload: unknown, signature: string | undefined) {
    if (!signature) throw new Error('PAYMENT_VERIFICATION_FAILED');
    return this.client.verifyAndDecryptNotification(payload, signature);
  }
  public async refund(request: { orderId: string; amountFen: number; reason: string }) {
    const refund = await this.client.refund(request);
    return { providerRefundId: refund.refundId };
  }
}
