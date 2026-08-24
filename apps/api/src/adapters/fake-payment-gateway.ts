import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type {
  CreatePaymentRequest,
  PaymentGateway,
  VerifiedPaymentEvent,
} from '../payments/payment-gateway.js';

const EventSchema = z.object({
  eventId: z.uuid(),
  providerPaymentId: z.string().min(1),
  orderId: z.uuid(),
  amountFen: z.int().positive(),
  currency: z.literal('CNY'),
  status: z.literal('SUCCEEDED'),
});

export class FakePaymentGateway implements PaymentGateway {
  public readonly providerName = 'fake';

  public constructor(private readonly webhookSecret: string) {
    if (!webhookSecret) throw new Error('fake payment webhook secret is required');
  }

  public async createPayment(request: CreatePaymentRequest) {
    const providerPaymentId = `fake-pay-${request.orderId}`;
    return { providerPaymentId, paymentToken: providerPaymentId };
  }

  public successEvent(orderId: string, amountFen: number): VerifiedPaymentEvent {
    return {
      eventId: randomUUID(),
      providerPaymentId: `fake-pay-${orderId}`,
      orderId,
      amountFen,
      currency: 'CNY',
      status: 'SUCCEEDED',
    };
  }

  public sign(payload: unknown): string {
    return createHmac('sha256', this.webhookSecret).update(JSON.stringify(payload)).digest('hex');
  }

  public verifyWebhook(payload: unknown, signature: string | undefined): VerifiedPaymentEvent {
    if (!signature) throw new Error('PAYMENT_VERIFICATION_FAILED');
    const expected = Buffer.from(this.sign(payload), 'hex');
    const actual = Buffer.from(signature, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error('PAYMENT_VERIFICATION_FAILED');
    }
    return EventSchema.parse(payload);
  }

  public async refund(request: { orderId: string; amountFen: number; reason: string }) {
    return { providerRefundId: `fake-refund-${request.orderId}-${request.amountFen}` };
  }
}
