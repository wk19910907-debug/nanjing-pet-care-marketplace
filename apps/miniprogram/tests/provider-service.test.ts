import { describe, expect, it, vi } from 'vitest';
import { createProviderService } from '../services/provider-service.js';
import type { ServiceOrder } from '../services/fulfillment-models.js';
import type { SelectedEvidence } from '../services/evidence.js';

function setup(status = 'IN_SERVICE', serviceType: ServiceOrder['serviceType'] = 'CAT_FEEDING') {
  const order: ServiceOrder = { id: 'order-1', status, serviceType, durationMinutes: 30, evidence: [] };
  const api = {
    getServiceOrder: vi.fn(async () => structuredClone(order)),
    checkIn: vi.fn(async () => { order.status = 'IN_SERVICE'; }),
    issueUpload: vi.fn(async () => ({ objectKey: 'orders/order-1/photo', uploadUrl: '/local-upload', expiresInSeconds: 60 })),
    uploadEvidence: vi.fn(async () => {}),
    attachEvidence: vi.fn(async () => { order.evidence = [{ id: 'photo-1' }]; return { id: 'photo-1' }; }),
    submitReport: vi.fn(async () => { order.status = 'PENDING_CONFIRMATION'; }),
  };
  const choose = vi.fn<() => Promise<SelectedEvidence | null>>(async () => ({ bytes: new ArrayBuffer(8), media: { mimeType: 'image/png', sizeBytes: 8, sha256: 'ab'.repeat(32) } }));
  const change = vi.fn();
  const flow = createProviderService({ api, chooseEvidence: choose, orderId: order.id, onChange: change });
  return { flow, api, order, choose, change };
}
describe('provider service state machine', () => {
  it('never counts evidence when uploading or backend verification fails', async () => {
    const { flow, api } = setup();
    await flow.load();
    api.uploadEvidence.mockRejectedValueOnce(new Error('offline'));
    await flow.upload();
    expect(api.attachEvidence).not.toHaveBeenCalled();
    expect(flow.getState().evidenceCount).toBe(0);
    expect(flow.getState().error).not.toBe('');
  });
  it('retries an ambiguous attachment with the same object instead of uploading again', async () => {
    const { flow, api, choose } = setup();
    await flow.load();
    api.attachEvidence.mockRejectedValueOnce(new Error('response lost'));
    await flow.upload();
    expect(flow.getState().evidenceCount).toBe(0);
    await flow.upload();
    expect(choose).toHaveBeenCalledTimes(1);
    expect(api.issueUpload).toHaveBeenCalledTimes(1);
    expect(api.uploadEvidence).toHaveBeenCalledTimes(1);
    expect(api.attachEvidence.mock.calls[0]).toEqual(api.attachEvidence.mock.calls[1]);
    expect(flow.getState().evidenceCount).toBe(1);
  });
  it('does nothing when media selection is canceled', async () => {
    const { flow, choose, api } = setup();
    choose.mockResolvedValueOnce(null);
    await flow.load(); await flow.upload();
    expect(api.issueUpload).not.toHaveBeenCalled();
    expect(flow.getState().error).toBe('');
  });
  it('blocks duplicate taps while selection is pending', async () => {
    const { flow, choose, api } = setup();
    let finish!: (value: null) => void;
    choose.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await flow.load();
    const first = flow.upload(); await flow.upload();
    expect(choose).toHaveBeenCalledTimes(1);
    finish(null); await first;
    expect(api.issueUpload).not.toHaveBeenCalled();
  });
  it('requires before-state confirmation and lets the server own check-in time', async () => {
    const { flow, api } = setup('PENDING_SERVICE');
    await flow.load(); await flow.checkIn();
    expect(api.checkIn).not.toHaveBeenCalled();
    flow.setBeforeConfirmed(true); await flow.checkIn();
    expect(api.checkIn).toHaveBeenCalledWith('order-1', { beforeState: { petStateConfirmed: true } });
    expect(flow.getState().order?.status).toBe('IN_SERVICE');
  });
  it('restores backend evidence and requires the actual service checklist plus after-state confirmation', async () => {
    const { flow, api, order } = setup('IN_SERVICE', 'DOG_WALKING');
    order.evidence = [{ id: 'existing-photo' }];
    await flow.load();
    expect(flow.getState().evidenceCount).toBe(1);
    flow.setChecklist('leashSecured', true);
    flow.setWalkMinutes('30');
    await flow.submit(); expect(api.submitReport).not.toHaveBeenCalled();
    flow.setAfterConfirmed(true); await flow.submit();
    expect(api.submitReport).toHaveBeenCalledWith('order-1', {
      checklist: { leashSecured: true, walkDurationMinutes: 30 }, afterState: { petStateConfirmed: true }, notes: '',
    });
    expect(flow.getState().canSubmit).toBe(false);
    await flow.upload(); expect(api.issueUpload).not.toHaveBeenCalled();
  });
  it.each(['NaN', 'Infinity', '-1', '0', '1.5', '99999'])('rejects invalid walk duration %s', async (minutes) => {
    const { flow, order } = setup('IN_SERVICE', 'DOG_WALKING');
    order.evidence = [{ id: 'photo' }]; await flow.load();
    flow.setChecklist('leashSecured', true); flow.setAfterConfirmed(true); flow.setWalkMinutes(minutes);
    expect(flow.getState().canSubmit).toBe(false);
  });
  it('blocks actions if loading fails and stops publishing after disposal', async () => {
    const { flow, api, change } = setup();
    api.getServiceOrder.mockRejectedValueOnce(new Error('forbidden'));
    await flow.load(); await flow.upload(); expect(api.issueUpload).not.toHaveBeenCalled();
    flow.dispose(); const count = change.mock.calls.length;
    await flow.load(); expect(change).toHaveBeenCalledTimes(count);
  });
});
