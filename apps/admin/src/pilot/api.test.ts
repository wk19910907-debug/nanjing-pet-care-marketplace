import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdempotencyKey, createPilotApi, PilotApiError } from './api.js';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('pilot API transport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['OWNER', 'PROVIDER', 'ADMIN'] as const)(
    'creates a local %s session through the direct-entry contract',
    async (role) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        expiresAt: '2026-09-03T10:00:00.000Z',
      }, 201));
      const api = createPilotApi(fetcher);

      await expect(api.createLocalSession(role)).resolves.toEqual({
        expiresAt: '2026-09-03T10:00:00.000Z',
      });
      expect(fetcher).toHaveBeenCalledWith('/api/v1/pilot/local-sessions', expect.objectContaining({
        method: 'POST', body: JSON.stringify({ role }), credentials: 'same-origin',
      }));
    },
  );

  it('rejects malformed local-session responses', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      expiresAt: 123,
    }, 201)));

    await expect(api.createLocalSession('ADMIN')).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it('validates safe owner confirmation and evidence-read responses', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ orderId: 'order-1', status: 'COMPLETED', confirmedAt: '2026-08-28T00:00:00.000Z' }))
      .mockResolvedValueOnce(jsonResponse({ url: '/api/v1/pilot/local-evidence?token=signed', expiresInSeconds: 300 }));
    const api = createPilotApi(fetcher);
    await expect(api.confirmOrder('order-1')).resolves.toEqual({
      orderId: 'order-1', status: 'COMPLETED', confirmedAt: '2026-08-28T00:00:00.000Z',
    });
    await expect(api.getEvidenceReadUrl('evidence-1')).resolves.toEqual({
      url: '/api/v1/pilot/local-evidence?token=signed', expiresInSeconds: 300,
    });
  });

  it('rejects owner confirmation responses containing settlement internals', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      orderId: 'order-1', status: 'COMPLETED', confirmedAt: '2026-08-28T00:00:00.000Z',
      providerId: 'must-not-cross', commissionFen: 100,
    })));
    await expect(api.confirmOrder('order-1')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('uses same-origin cookies without a body content type or browser storage', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      userId: 'admin-1',
      role: 'ADMIN',
      displayName: '试点运营',
      expiresAt: '2026-09-03T10:00:00.000Z',
    }));
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);

    await createPilotApi(fetcher).getSession();

    expect(fetcher).toHaveBeenCalledWith('/api/v1/pilot/session', expect.objectContaining({
      credentials: 'same-origin',
    }));
    expect(fetcher.mock.calls[0]![1]!.headers).not.toHaveProperty('Content-Type');
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('sends a fresh 8-100 character idempotency key with every write', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ expiresAt: '2026-09-03T10:00:00.000Z' }, 201))
      .mockResolvedValueOnce(jsonResponse({
        id: 'owner-1', role: 'OWNER', displayName: '建邺宠主',
      }));
    const api = createPilotApi(fetcher);

    await api.createSession('controlled-invite');
    await api.updateProfile('建邺宠主');

    const first = new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Idempotency-Key');
    const second = new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Idempotency-Key');
    expect(first).toMatch(/^.{8,100}$/);
    expect(second).toMatch(/^.{8,100}$/);
    expect(first).not.toBe(second);
    expect(createIdempotencyKey()).toMatch(/^.{8,100}$/);
  });

  it.each([
    [401, 'INVITE_INVALID', 'INVITE_INVALID', '邀请码无效或已失效'],
    [429, 'LOGIN_RATE_LIMITED', 'LOGIN_RATE_LIMITED', '尝试次数过多，请稍后再试'],
    [400, 'DISPLAY_NAME_INVALID', 'DISPLAY_NAME_INVALID', '昵称格式不符合要求'],
    [503, 'SOME_INTERNAL_DETAIL', 'SERVICE_UNAVAILABLE', '服务暂时不可用，请稍后重试'],
  ])('maps %s/%s to safe Chinese copy', async (status, responseCode, code, message) => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ code: responseCode }, status),
    ));

    await expect(api.getSession()).rejects.toMatchObject({
      name: 'PilotApiError', status, code, message,
    } satisfies Partial<PilotApiError>);
  });

  it('does not reveal malformed or non-JSON server errors', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(new Response(
      'database password leaked', { status: 503, headers: { 'Content-Type': 'text/plain' } },
    )));

    await expect(api.getSession()).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: '服务暂时不可用，请稍后重试',
    });
  });

  it('normalizes network failures and malformed successful JSON', async () => {
    const networkApi = createPilotApi(vi.fn<typeof fetch>().mockRejectedValue(
      new Error('Failed to fetch C:\\internal\\secret'),
    ));
    const malformedApi = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(new Response(
      'database row dump', { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(networkApi.getSession()).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
    await expect(malformedApi.getSession()).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it.each([
    ['session', (api: ReturnType<typeof createPilotApi>) => api.getSession(), {
      userId: 'owner-1', role: 'ROOT', displayName: null, expiresAt: '2026-09-01T00:00:00.000Z',
    }],
    ['login', (api: ReturnType<typeof createPilotApi>) => api.createSession('invite'), {
      expiresAt: 123,
    }],
    ['nickname', (api: ReturnType<typeof createPilotApi>) => api.updateProfile('昵称'), {
      id: 'owner-1', role: 'OWNER', displayName: null,
    }],
    ['invite creation', (api: ReturnType<typeof createPilotApi>) => api.createInvite('OWNER'), {
      id: 'invite-1', role: 'OWNER', code: 'raw-code', token: 'leaked-token',
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
    }],
    ['invite listing', (api: ReturnType<typeof createPilotApi>) => api.listInvites(), [{
      id: 'invite-1', role: 'OWNER', code: 'leaked-code', consumedAt: null,
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
    }]],
  ])('rejects invalid successful %s responses with a fixed safe error', async (_name, call, body) => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)));

    await expect(call(api)).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it('normalizes invitation metadata to the explicit allowlist', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{
      id: 'invite-1', role: 'PROVIDER', consumedAt: null,
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
      internalNote: 'must not cross the client boundary',
    }])));

    const records = await api.listInvites();

    expect(records).toEqual([{
      id: 'invite-1', role: 'PROVIDER', consumedAt: null,
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
    }]);
    expect(JSON.stringify(records)).not.toContain('internalNote');
  });

  it.each([
    ['session', '', (api: ReturnType<typeof createPilotApi>) => api.getSession()],
    ['session', '   ', (api: ReturnType<typeof createPilotApi>) => api.getSession()],
    ['session', ' 昵称', (api: ReturnType<typeof createPilotApi>) => api.getSession()],
    ['session', '昵称 ', (api: ReturnType<typeof createPilotApi>) => api.getSession()],
    ['session', '昵'.repeat(31), (api: ReturnType<typeof createPilotApi>) => api.getSession()],
    ['profile', '', (api: ReturnType<typeof createPilotApi>) => api.updateProfile('昵称')],
    ['profile', '   ', (api: ReturnType<typeof createPilotApi>) => api.updateProfile('昵称')],
    ['profile', ' 昵称', (api: ReturnType<typeof createPilotApi>) => api.updateProfile('昵称')],
    ['profile', '昵称 ', (api: ReturnType<typeof createPilotApi>) => api.updateProfile('昵称')],
    ['profile', '昵'.repeat(31), (api: ReturnType<typeof createPilotApi>) => api.updateProfile('昵称')],
  ])('rejects invalid %s displayName %j', async (kind, displayName, call) => {
    const body = kind === 'session'
      ? {
          userId: 'owner-1', role: 'OWNER', displayName,
          expiresAt: '2026-09-01T00:00:00.000Z',
        }
      : { id: 'owner-1', role: 'OWNER', displayName };
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)));

    await expect(call(api)).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it.each([
    'rawCode', 'RAW_CODE', 'raw-code', 'raw code',
    'invitationCode', 'invitation_code', 'invitation-code',
    'inviteCode', 'invite_code', 'invite-code',
    'codeHash', 'code_hash', 'code-hash',
    'sessionToken', 'session_token', 'access-token', 'TOKEN',
  ])('rejects credential-like invitation metadata key %s', async (credentialKey) => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{
      id: 'invite-1', role: 'OWNER', consumedAt: null,
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
      [credentialKey]: 'must-not-cross-client-boundary',
    }])));

    await expect(api.listInvites()).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it('rejects credential aliases in create responses while allowing the documented code field', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      id: 'invite-1', role: 'OWNER', code: 'one-time-code', raw_code: 'duplicate-secret',
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
    }, 201)));

    await expect(api.createInvite('OWNER')).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it('does not mistake safe invitation metadata fields for credentials', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{
      id: 'invite-1', role: 'OWNER', consumedAt: null,
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
    }])));

    await expect(api.listInvites()).resolves.toEqual([{
      id: 'invite-1', role: 'OWNER', consumedAt: null,
      expiresAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-08-28T00:00:00.000Z',
    }]);
  });

  it.each([
    'next Thursday',
    '2026-09-01',
    '2026/09/01 00:00:00',
    '2026-02-30T00:00:00.000Z',
    '2026-09-01T00:00:00',
    '2026-09-01 00:00:00Z',
  ])('rejects non-strict API timestamp %s', async (expiresAt) => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      userId: 'owner-1', role: 'OWNER', displayName: null, expiresAt,
    })));

    await expect(api.getSession()).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it('accepts a valid ISO-8601 timestamp with an explicit offset', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      userId: 'owner-1', role: 'OWNER', displayName: null,
      expiresAt: '2026-09-01T08:00:00+08:00',
    })));

    await expect(api.getSession()).resolves.toMatchObject({
      expiresAt: '2026-09-01T08:00:00+08:00',
    });
  });

  it('requires logout to return the documented empty 204 response', async () => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true })));

    await expect(api.deleteSession()).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });

  it('uses the caller idempotency key for replay-safe owner order submission', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      id: '44444444-4444-4444-8444-444444444444', status: 'PENDING_DISPATCH',
      totalFen: 3900, currency: 'CNY', paymentToken: null,
    }, 200));
    const api = createPilotApi(fetcher);
    const input = {
      serviceType: 'CAT_FEEDING' as const,
      petIds: ['11111111-1111-4111-8111-111111111111'],
      addressId: '33333333-3333-4333-8333-333333333333',
      startsAt: '2026-09-10T02:00:00.000Z', durationMinutes: 30, notes: '',
    };

    await expect(api.createOrder(input, 'owner-order-retry-key')).resolves.toMatchObject({
      status: 'PENDING_DISPATCH',
    });

    expect(fetcher).toHaveBeenCalledWith('/api/v1/orders', expect.objectContaining({
      method: 'POST', body: JSON.stringify(input),
      headers: expect.objectContaining({ 'Idempotency-Key': 'owner-order-retry-key' }),
    }));
  });

  it('normalizes owner resources, quote, and order read models to explicit allowlists', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{
        id: '11111111-1111-4111-8111-111111111111', name: '团子', species: 'CAT',
        sensitiveNotes: '怕生', ownerId: 'must-not-cross',
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        id: '33333333-3333-4333-8333-333333333333', city: '南京市',
        district: '建邺区', serviceZone: '建邺区', detail: 'exact-secret',
        accessInstructions: 'door-secret',
      }]))
      .mockResolvedValueOnce(jsonResponse({
        baseFen: 3200, extraPetFen: 0, durationFen: 700, distanceFen: 0,
        holidayFen: 0, totalFen: 3900, currency: 'CNY', internalRule: 'hidden',
      }))
      .mockResolvedValueOnce(jsonResponse([{
        id: '44444444-4444-4444-8444-444444444444', serviceType: 'CAT_FEEDING',
        status: 'PENDING_CONFIRMATION', startsAt: '2026-09-10T02:00:00.000Z',
        durationMinutes: 30, totalFen: 3900, currency: 'CNY', city: '南京市',
        district: '建邺区', serviceZone: '建邺区', notes: '轻声进门',
        exactAddress: 'must-not-cross', accessInstructions: 'must-not-cross', ownerId: 'other-owner',
        report: {
          notes: '状态正常', submittedAt: '2026-09-10T03:00:00.000Z',
          checklist: {
            petCountConfirmed: true, foodRefilled: true, waterRefilled: true, litterCleaned: true,
          }, evidence: ['must-not-cross'],
        },
      }]));
    const api = createPilotApi(fetcher);

    const [petRecords, addressRecords, quote, orderRecords] = await Promise.all([
      api.listPets(), api.listAddresses(), api.getQuote({
        serviceType: 'CAT_FEEDING', petIds: ['11111111-1111-4111-8111-111111111111'],
        addressId: '33333333-3333-4333-8333-333333333333',
        startsAt: '2026-09-10T02:00:00.000Z', durationMinutes: 30,
      }), api.listOrders(),
    ]);

    expect(petRecords).toEqual([{
      id: '11111111-1111-4111-8111-111111111111', name: '团子', species: 'CAT', sensitiveNotes: '怕生',
    }]);
    expect(addressRecords).toEqual([{
      id: '33333333-3333-4333-8333-333333333333', city: '南京市',
      district: '建邺区', serviceZone: '建邺区',
    }]);
    expect(quote).toEqual({
      baseFen: 3200, extraPetFen: 0, durationFen: 700,
      distanceFen: 0, holidayFen: 0, totalFen: 3900, currency: 'CNY',
    });
    expect(orderRecords[0]).toEqual({
      id: '44444444-4444-4444-8444-444444444444', serviceType: 'CAT_FEEDING',
      status: 'PENDING_CONFIRMATION', startsAt: '2026-09-10T02:00:00.000Z',
      durationMinutes: 30, totalFen: 3900, currency: 'CNY', city: '南京市',
      district: '建邺区', serviceZone: '建邺区', notes: '轻声进门',
      report: {
        notes: '状态正常', submittedAt: '2026-09-10T03:00:00.000Z',
        checklist: {
          petCountConfirmed: true, foodRefilled: true, waterRefilled: true, litterCleaned: true,
        },
      },
    });
    expect(JSON.stringify({ addressRecords, orderRecords })).not.toMatch(/exact-secret|door-secret|must-not-cross/);
  });

  it('rejects online-payment tokens and malformed owner order read models', async () => {
    const paymentApi = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      id: '44444444-4444-4444-8444-444444444444', status: 'PENDING_PAYMENT',
      totalFen: 3900, currency: 'CNY', paymentToken: 'qr-or-payment-token',
    }, 201)));
    const malformedApi = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{
      id: '44444444-4444-4444-8444-444444444444', serviceType: 'CAT_FEEDING',
      status: 'UNKNOWN_STATE', startsAt: '2026-09-10T02:00:00.000Z', durationMinutes: 30,
      totalFen: 3900, currency: 'CNY', city: '南京市', district: '建邺区', serviceZone: '建邺区',
    }])));

    await expect(paymentApi.createOrder({
      serviceType: 'CAT_FEEDING', petIds: ['11111111-1111-4111-8111-111111111111'],
      addressId: '33333333-3333-4333-8333-333333333333',
      startsAt: '2026-09-10T02:00:00.000Z', durationMinutes: 30, notes: '',
    }, 'owner-order-retry-key')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await expect(malformedApi.listOrders()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it.each([
    ['CAT_FEEDING', { fed: true }],
    ['CAT_FEEDING', { petCountConfirmed: true, foodRefilled: true, waterRefilled: true }],
    ['DOG_WALKING', { leashSecured: true, walkDurationMinutes: 0 }],
  ] as const)('rejects a %s report whose checklist does not match the service schema', async (serviceType, checklist) => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{
      id: '44444444-4444-4444-8444-444444444444', serviceType,
      status: 'PENDING_CONFIRMATION', startsAt: '2026-09-10T02:00:00.000Z',
      durationMinutes: 30, totalFen: 3900, currency: 'CNY', city: '南京市',
      district: '建邺区', serviceZone: '建邺区',
      report: { notes: '状态正常', submittedAt: '2026-09-10T03:00:00.000Z', checklist },
    }])));

    await expect(api.listOrders()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it.each([
    [{ city: '上海市' }, 'non-Nanjing city'],
    [{ district: '浦口区', serviceZone: '浦口区' }, 'unsupported district'],
    [{ district: '建邺区', serviceZone: '奥体服务圈' }, 'mismatched service zone'],
  ])('rejects an owner order with %s (%s)', async (addressOverride, _description) => {
    const api = createPilotApi(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{
      id: '44444444-4444-4444-8444-444444444444', serviceType: 'CAT_FEEDING',
      status: 'PENDING_PAYMENT', startsAt: '2026-09-10T02:00:00.000Z', durationMinutes: 30,
      totalFen: 3900, currency: 'CNY', city: '南京市', district: '建邺区', serviceZone: '建邺区',
      ...addressOverride,
    }])));

    await expect(api.listOrders()).rejects.toMatchObject({
      status: 503, code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试',
    });
  });
});
