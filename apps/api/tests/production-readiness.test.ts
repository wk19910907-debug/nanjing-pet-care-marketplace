import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { readinessSnapshot } from '../src/health.js';
import { WechatPayGateway } from '../src/adapters/wechat-pay-gateway.js';
import { S3ObjectStorage } from '../src/adapters/s3-object-storage.js';
import { WechatNotifier } from '../src/adapters/wechat-notifier.js';
import { ScheduledJobs } from '../src/jobs.js';

const productionEnvironment = {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://db.internal/petcare',
  FIELD_ENCRYPTION_KEY_V1: Buffer.alloc(32, 1).toString('base64'),
  WECHAT_PAY_MCH_ID: 'merchant-id', WECHAT_PAY_API_V3_KEY: 'v3-secret-value',
  WECHAT_PAY_PRIVATE_KEY: 'private-key-value', WECHAT_PAY_PLATFORM_CERT: 'platform-cert-value',
  PAYMENT_WEBHOOK_BASE_URL: 'https://api.example.com',
  S3_ENDPOINT: 'https://objects.example.com', S3_BUCKET: 'pet-evidence',
  S3_ACCESS_KEY_ID: 'access-id-value', S3_SECRET_ACCESS_KEY: 'access-secret-value',
  S3_REGION: 'us-east-1',
  WECHAT_APP_ID: 'wx-app-id', WECHAT_APP_SECRET: 'wx-app-secret',
};

const pilotProductionEnvironment = {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://db.internal/pilot',
  PILOT_MODE: 'enabled', PILOT_PUBLIC_ORIGIN: 'https://pilot.example.com',
  PILOT_SHARED_INGRESS_RATE_LIMITING: 'enabled',
  PILOT_AUTH_PEPPER: Buffer.alloc(32, 9).toString('base64'),
  FIELD_ENCRYPTION_KEY_V1: Buffer.alloc(32, 2).toString('base64'),
  S3_ENDPOINT: 'https://objects.example.com', S3_BUCKET: 'pilot-evidence',
  S3_ACCESS_KEY_ID: 'pilot-access-id', S3_SECRET_ACCESS_KEY: 'pilot-storage-secret',
  S3_REGION: 'auto',
};

describe('production readiness', () => {
  it.each(Object.keys(productionEnvironment).filter((key) => !['NODE_ENV'].includes(key)))
  ('fails closed when production configuration omits %s', (key) => {
    const environment = { ...productionEnvironment, [key]: undefined };
    expect(() => loadConfig(environment)).toThrow(key);
  });

  it('exposes only readiness booleans and provider names, never credentials', () => {
    const config = loadConfig(productionEnvironment);
    const response = readinessSnapshot(config, { database: true, objectStorage: true });
    expect(response).toEqual({
      ready: true, database: true, objectStorage: true, encryption: true,
      paymentProvider: 'wechat', objectStorageProvider: 's3', notificationProvider: 'wechat',
    });
    const serialized = JSON.stringify(response);
    for (const secret of ['v3-secret-value', 'private-key-value', 'access-secret-value', 'wx-app-secret']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it.each([
    'DATABASE_URL', 'PILOT_PUBLIC_ORIGIN', 'PILOT_AUTH_PEPPER', 'FIELD_ENCRYPTION_KEY_V1',
    'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
    'S3_REGION', 'PILOT_SHARED_INGRESS_RATE_LIMITING',
  ])('fails closed when pilot production configuration omits %s', (key) => {
    expect(() => loadConfig({ ...pilotProductionEnvironment, [key]: undefined })).toThrow(key);
  });

  it('does not require WeChat secrets for pilot production and exposes no pilot secrets', () => {
    const config = loadConfig(pilotProductionEnvironment);
    const response = readinessSnapshot(config, { database: true, objectStorage: true });
    expect(response).toEqual({
      ready: true, database: true, objectStorage: true, encryption: true,
      paymentProvider: 'manual', objectStorageProvider: 's3', notificationProvider: 'disabled',
    });
    const serialized = JSON.stringify(response);
    for (const secret of [
      pilotProductionEnvironment.PILOT_AUTH_PEPPER,
      pilotProductionEnvironment.FIELD_ENCRYPTION_KEY_V1,
      pilotProductionEnvironment.S3_ACCESS_KEY_ID,
      pilotProductionEnvironment.S3_SECRET_ACCESS_KEY,
      pilotProductionEnvironment.PILOT_PUBLIC_ORIGIN,
    ]) expect(serialized).not.toContain(secret);
  });

  it('fails readiness when configured object storage is unavailable', () => {
    const response = readinessSnapshot(loadConfig(pilotProductionEnvironment), {
      database: true,
      objectStorage: false,
    });
    expect(response).toMatchObject({ ready: false, database: true, objectStorage: false });
  });

  it('requires an active administrator credential before a pilot production instance is ready', () => {
    const config = loadConfig(pilotProductionEnvironment);
    expect(readinessSnapshot(config, { database: true, objectStorage: true, adminCredential: false }))
      .toMatchObject({ ready: false });
    expect(readinessSnapshot(config, { database: true, objectStorage: true, adminCredential: true }))
      .toMatchObject({ ready: true });
  });
});

describe('scheduled job entry points', () => {
  it('deduplicates expired orders and delegates idempotent auto-confirmation', async () => {
    const expired: string[] = [];
    const autoConfirmed: Date[] = [];
    const jobs = new ScheduledJobs(
      { expiredDispatchOrderIds: async () => ['order-1', 'order-1', 'order-2'] },
      { expireWave: async (orderId) => { expired.push(orderId); return []; } },
      { autoConfirmDueOrders: async (now) => { autoConfirmed.push(now); return []; } },
    );
    const now = new Date('2026-08-23T12:00:00Z');
    await jobs.runDue(now);
    expect(expired).toEqual(['order-1', 'order-2']);
    expect(autoConfirmed).toEqual([now]);
  });
});

describe('production adapter boundaries', () => {
  it('delegates payment creation, verified callbacks and refunds to the WeChat client', async () => {
    const client = {
      createTransaction: async () => ({ prepayId: 'wx-prepay' }),
      verifyAndDecryptNotification: () => ({ eventId: 'event-1', providerPaymentId: 'wx-pay-1',
        orderId: '11111111-1111-4111-8111-111111111111', amountFen: 3900, currency: 'CNY' as const, status: 'SUCCEEDED' as const }),
      refund: async () => ({ refundId: 'wx-refund-1' }),
    };
    const gateway = new WechatPayGateway(client);
    expect(await gateway.createPayment({ orderId: '11111111-1111-4111-8111-111111111111', amountFen: 3900, currency: 'CNY' }))
      .toEqual({ providerPaymentId: 'wx-prepay', paymentToken: 'wx-prepay' });
    expect(gateway.verifyWebhook({}, 'wechat-signature')).toMatchObject({ eventId: 'event-1' });
    expect(await gateway.refund({ orderId: '11111111-1111-4111-8111-111111111111', amountFen: 1000, reason: '投诉' }))
      .toEqual({ providerRefundId: 'wx-refund-1' });
  });

  it('uses S3 presigned URLs and verifies immutable upload metadata', async () => {
    const storage = new S3ObjectStorage({
      probe: async () => true,
      presignPut: async () => 'https://s3/upload', presignGet: async () => 'https://s3/read',
      head: async () => ({ mimeType: 'image/jpeg', sizeBytes: 123, sha256: 'c'.repeat(64) }),
    });
    expect((await storage.issueUpload({ objectKey: 'orders/o/e', mimeType: 'image/jpeg', sizeBytes: 123,
      sha256: 'c'.repeat(64), expiresInSeconds: 600 })).uploadUrl).toBe('https://s3/upload');
    expect(await storage.verifyUpload('orders/o/e', { mimeType: 'image/jpeg', sizeBytes: 123, sha256: 'c'.repeat(64) })).toBe(true);
    expect(await storage.issueReadUrl('orders/o/e', 300)).toBe('https://s3/read');
  });

  it('sends only template data through the WeChat notifier', async () => {
    const sent: unknown[] = [];
    const notifier = new WechatNotifier({ sendTemplate: async (message) => { sent.push(message); } });
    await notifier.orderStatus('wx-owner', { orderId: 'order-1', statusLabel: '已匹配服务人员' });
    expect(sent).toEqual([{ recipientOpenId: 'wx-owner', template: 'ORDER_STATUS',
      data: { orderId: 'order-1', statusLabel: '已匹配服务人员' } }]);
  });
});
