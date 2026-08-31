import { describe, expect, it, vi } from 'vitest';
import { createPilotApi } from './api.js';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

describe('pilot task 8 API transport', () => {
  it('carries only the required checksum upload header without credentials', async () => {
    const uploadHeaders = { 'x-amz-checksum-sha256': btoa('a'.repeat(32)) };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ objectKey: 'orders/1/photo',
        uploadUrl: 'https://objects.example.com/photo?signed=1', expiresInSeconds: 60, uploadHeaders }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const api = createPilotApi(fetcher);
    const issued = await api.issueEvidenceUpload('order-1', { mimeType: 'image/png', sizeBytes: 4, sha256: 'a'.repeat(64) });
    expect(issued).toHaveProperty('uploadHeaders', uploadHeaders);
    await api.uploadEvidence(issued.uploadUrl, new Uint8Array([1, 2, 3, 4]), 'image/png', uploadHeaders);
    expect(fetcher).toHaveBeenLastCalledWith(issued.uploadUrl, expect.objectContaining({
      credentials: 'omit', headers: { 'Content-Type': 'image/png', ...uploadHeaders },
    }));
  });

  it.each([
    { Authorization: 'must-not-forward' },
    { 'x-amz-checksum-sha256': 'invalid' },
    { 'x-amz-checksum-sha256': btoa('a'.repeat(32)), Cookie: 'must-not-forward' },
    null,
  ])('rejects unsafe upload headers: %j', async (uploadHeaders) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      objectKey: 'orders/1/photo', uploadUrl: 'https://objects.example.com/photo?signed=1', expiresInSeconds: 60, uploadHeaders,
    }));
    await expect(createPilotApi(fetcher).issueEvidenceUpload('order-1', {
      mimeType: 'image/png', sizeBytes: 4, sha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses real same-origin admin routes and the caller fee idempotency key', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{
        id: '11111111-1111-4111-8111-111111111111', displayName: '秦淮小周',
        reviewStatus: 'PENDING', serviceTypes: ['CAT_FEEDING'], serviceZone: '秦淮区', radiusKm: 5,
        catExperienceMonths: 18, dogExperienceMonths: 0, createdAt: '2026-08-28T02:00:00.000Z',
        userId: 'must-not-cross', latitude: 32.039, longitude: 118.795,
      }]))
      .mockResolvedValueOnce(jsonResponse({ id: '11111111-1111-4111-8111-111111111111', reviewStatus: 'APPROVED' }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'fee-1', orderId: '22222222-2222-4222-8222-222222222222', provider: 'pilot-manual',
        status: 'SUCCEEDED', amountFen: 3900, currency: 'CNY', providerEventId: 'must-not-cross',
      }))
      .mockResolvedValueOnce(jsonResponse([]));
    const api = createPilotApi(fetcher);

    await expect(api.listProviderReviewQueue()).resolves.toEqual([{
      id: '11111111-1111-4111-8111-111111111111', displayName: '秦淮小周',
      reviewStatus: 'PENDING', serviceTypes: ['CAT_FEEDING'], serviceZone: '秦淮区', radiusKm: 5,
      catExperienceMonths: 18, dogExperienceMonths: 0, createdAt: '2026-08-28T02:00:00.000Z',
    }]);
    await api.reviewProvider('11111111-1111-4111-8111-111111111111', 'APPROVED');
    await api.confirmManualFee('22222222-2222-4222-8222-222222222222', 'manual-fee-retry-1');
    await api.startDispatch('22222222-2222-4222-8222-222222222222');

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/v1/pilot/providers/review-queue', expect.objectContaining({ credentials: 'same-origin' }));
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/v1/providers/11111111-1111-4111-8111-111111111111/review', expect.objectContaining({ method: 'POST', body: JSON.stringify({ status: 'APPROVED' }) }));
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/v1/pilot/orders/22222222-2222-4222-8222-222222222222/manual-fee-confirmation', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ 'Idempotency-Key': 'manual-fee-retry-1' }),
    }));
    expect(fetcher).toHaveBeenNthCalledWith(4, '/api/v1/dispatch/22222222-2222-4222-8222-222222222222/start', expect.objectContaining({ method: 'POST' }));
    expect(fetcher.mock.calls[2]![1]!.headers).not.toHaveProperty('Content-Type');
    expect(fetcher.mock.calls[3]![1]!.headers).not.toHaveProperty('Content-Type');
  });

  it('keeps lifecycle timestamps server-owned and uploads through an uncredentialed signed capability', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'report-1', orderId: 'order-1', checkedInAt: '2026-09-10T01:50:00.000Z' }, 201))
      .mockResolvedValueOnce(jsonResponse({ objectKey: 'orders/order-1/evidence-1', uploadUrl: 'https://objects.example.com/private/orders/order-1/evidence-1?X-Amz-Signature=signed', expiresInSeconds: 600 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'evidence-1' }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: 'report-1', orderId: 'order-1', submittedAt: '2026-09-10T02:30:00.000Z' }));
    const api = createPilotApi(fetcher);
    const media = { mimeType: 'image/png', sizeBytes: 4, sha256: 'a'.repeat(64) };

    await api.checkIn('order-1', { petStateConfirmed: true });
    const issued = await api.issueEvidenceUpload('order-1', media);
    await api.uploadEvidence(issued.uploadUrl, new Uint8Array([1, 2, 3, 4]), 'image/png');
    await api.attachEvidence('order-1', { ...media, objectKey: issued.objectKey, capturedAt: '2026-09-10T02:00:00.000Z' });
    await api.submitReport('order-1', {
      checklist: { petCountConfirmed: true, foodRefilled: true, waterRefilled: true, litterCleaned: true },
      afterState: { petStateConfirmed: true }, notes: '状态正常',
    });

    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ beforeState: { petStateConfirmed: true } });
    expect(fetcher).toHaveBeenNthCalledWith(3, issued.uploadUrl, {
      method: 'PUT', credentials: 'omit', headers: { 'Content-Type': 'image/png' }, body: expect.any(Uint8Array),
    });
    expect(JSON.parse(fetcher.mock.calls[4]![1]!.body as string)).toEqual({
      checklist: { petCountConfirmed: true, foodRefilled: true, waterRefilled: true, litterCleaned: true },
      afterState: { petStateConfirmed: true }, notes: '状态正常',
    });
  });

  it('fails closed on malformed provider-only orders and assigned addresses', async () => {
    const unsafeOrderApi = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{
      id: 'order-1', serviceType: 'CAT_FEEDING', startsAt: '2026-09-10T02:00:00.000Z', durationMinutes: 30,
      city: '南京市', district: '秦淮区', serviceZone: '秦淮区',
      invitation: { id: 'invite-1', status: 'PENDING', expiresAt: 'not-a-timestamp' },
    }])));
    const unsafeAddressApi = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      city: '南京市', district: '浦口区', serviceZone: '浦口区', detail: 'secret', token: 'must-not-cross',
    })));

    await expect(unsafeOrderApi.listProviderOrders()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await expect(unsafeAddressApi.getAssignedAddress('order-1')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it.each([
    '//evil.example/upload?token=exfiltrate',
    '/\\evil.example/upload?token=exfiltrate',
    'http://objects.example.com/upload?token=plaintext',
    'https://user:password@objects.example.com/upload?token=signed',
    'ftp://objects.example.com/upload?token=signed',
    '/%2f%2fevil.example/upload?token=exfiltrate',
    '/api/v1/pilot/local-evidence#token=exfiltrate',
    'https://objects.example.com/upload?token=signed#fragment',
  ])('rejects unsafe upload capability %s before any upload fetch', async (uploadUrl) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      objectKey: 'orders/order-1/evidence-1', uploadUrl, expiresInSeconds: 600,
    }));
    const api = createPilotApi(fetcher);
    await expect(api.issueEvidenceUpload('order-1', {
      mimeType: 'image/png', sizeBytes: 4, sha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('projects safe evidence IDs from the assigned provider read model', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{
      id: 'order-1', serviceType: 'DOG_WALKING', status: 'IN_SERVICE',
      startsAt: '2026-09-10T02:00:00.000Z', durationMinutes: 30,
      totalFen: 4900, currency: 'CNY', city: '南京市', district: '秦淮区', serviceZone: '秦淮区',
      ownerDisplayName: '秦淮豆包家',
      evidence: [{ id: 'evidence-1', objectKey: 'must-not-cross', reportId: 'must-not-cross' }],
    }]));
    const api = createPilotApi(fetcher);
    await expect(api.listProviderOrders()).resolves.toEqual([expect.objectContaining({
      id: 'order-1', evidence: [{ id: 'evidence-1' }],
    })]);
  });

  it.each([
    '/api/v1/pilot/local-evidence?token=signed',
    'https://objects.example.com/private/evidence?X-Amz-Signature=signed',
  ])('accepts the safe upload capability %s for an uncredentialed direct upload', async (uploadUrl) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const api = createPilotApi(fetcher);
    await api.uploadEvidence(uploadUrl, new Uint8Array([1, 2, 3, 4]), 'image/png');
    expect(fetcher).toHaveBeenCalledWith(uploadUrl, expect.objectContaining({ credentials: 'omit' }));
  });

  it('rejects a plaintext upload URL before a direct upload fetch', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const api = createPilotApi(fetcher);
    await expect(api.uploadEvidence(
      'http://objects.example.com/exfiltrate', new Uint8Array([1, 2, 3, 4]), 'image/png',
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
