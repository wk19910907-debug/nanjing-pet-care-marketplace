import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../services/api.js';
import { OrderStatusSchema } from '@pet/contracts';
const media = { mimeType: 'image/png', sizeBytes: 8, sha256: 'ab'.repeat(32) };
const uploadHeaders = { 'x-amz-checksum-sha256': 'q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s=' };
const capability = { objectKey: 'orders/1/photo', uploadUrl: 'https://objects.example.com/photo?signed=1', expiresInSeconds: 60, uploadHeaders };
function setup(data: unknown = capability) {
  const transport = vi.fn().mockResolvedValue({ statusCode: 200, data });
  return { transport, api: createApiClient({ baseUrl: 'http://127.0.0.1:51800', token: () => 'private-token', transport }) };
}
describe('mini fulfillment API', () => {
  it.each(OrderStatusSchema.options)('accepts actual backend order status %s', async (status) => {
    const { api } = setup({ id: 'order-1', serviceType: 'CAT_FEEDING', status, durationMinutes: 30, evidence: [] });
    await expect(api.getServiceOrder('order-1')).resolves.toMatchObject({ status });
  });
  it('preserves signed checksum headers and sends binary PUT without authorization', async () => {
    const { api, transport } = setup();
    const issued = await api.issueUpload('order-1', media);
    expect(issued).toEqual(capability);
    const bytes = new ArrayBuffer(8);
    await api.uploadEvidence(issued, bytes, media.mimeType);
    expect(transport).toHaveBeenLastCalledWith({ method: 'PUT', url: capability.uploadUrl,
      data: bytes, headers: { 'Content-Type': 'image/png', ...uploadHeaders } });
  });
  it.each(['http://evil.example/a', '//evil.example/a', 'https://user:pass@objects.example/a', '/%2f%2fevil.example/a', 'https://objects.example/a#fragment'])(
    'rejects unsafe upload URL %s before transport', async (uploadUrl) => {
      const { api, transport } = setup();
      await expect(api.uploadEvidence({ ...capability, uploadUrl }, new ArrayBuffer(8), media.mimeType)).rejects.toThrow();
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it('rejects unexpected header names rather than forwarding credentials', async () => {
    const { api } = setup({ ...capability, uploadHeaders: { ...uploadHeaders, Cookie: 'private' } });
    await expect(api.issueUpload('1', media)).rejects.toThrow();
  });
  it('uses server-owned check-in and report timestamps', async () => {
    const { api, transport } = setup({ id: 'report' });
    await api.checkIn('order-1', { beforeState: { petStateConfirmed: true } });
    await api.submitReport('order-1', { checklist: {}, afterState: { petStateConfirmed: true }, notes: '' });
    expect(transport.mock.calls[0]![0].url).toBe('http://127.0.0.1:51800/api/v1/pilot/orders/order-1/check-in');
    expect(transport.mock.calls[1]![0].url).toBe('http://127.0.0.1:51800/api/v1/pilot/orders/order-1/report');
  });
  it('loads only the backend service state and evidence IDs', async () => {
    const { api } = setup({ id: 'order-1', serviceType: 'DOG_WALKING', status: 'IN_SERVICE',
      durationMinutes: 30, evidence: [{ id: 'photo-1', objectKey: 'not-for-view' }] });
    await expect(api.getServiceOrder('order-1')).resolves.toEqual({ id: 'order-1', serviceType: 'DOG_WALKING',
      status: 'IN_SERVICE', durationMinutes: 30, evidence: [{ id: 'photo-1' }] });
  });
});
