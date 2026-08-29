import { describe, expect, it, vi } from 'vitest';
import type { AdminOperationsCatalog } from '@pet/contracts';
import { createApp } from '../src/app.js';
import { OperationsCatalogService } from '../src/catalog/operations-catalog-service.js';
import type { AppConfig } from '../src/config.js';

const catalog: AdminOperationsCatalog = {
  version: 1,
  updatedAt: '2026-08-29T08:00:00.000Z',
  services: {
    CAT_FEEDING: { enabled: true, basePriceFen: 3_200 },
    DOG_WALKING: { enabled: true, basePriceFen: 3_700 },
  },
  openDistricts: ['JIANYE', 'GULOU'],
  announcement: '今日正常接单',
};

const config: AppConfig = {
  nodeEnv: 'test',
  databaseUrl: 'postgresql://test:test@127.0.0.1/test',
  pilot: {
    enabled: true,
    host: '127.0.0.1',
    port: 3000,
    authPepper: Buffer.alloc(32, 1),
    sessionDays: 7,
    inviteHours: 24,
    secureCookies: false,
  },
};

function setup(compareResult: AdminOperationsCatalog | null = { ...catalog, version: 2 }) {
  const repository = {
    get: vi.fn().mockResolvedValue(catalog),
    compareAndSwap: vi.fn().mockResolvedValue(compareResult),
  };
  const sessions = {
    authenticate: vi.fn(async (authorization: string | undefined) => {
      if (authorization === 'Bearer admin') {
        return { userId: 'admin-id', role: 'ADMIN' as const, displayName: '管理员' };
      }
      if (authorization === 'Bearer owner') {
        return { userId: 'owner-id', role: 'OWNER' as const, displayName: '宠主' };
      }
      throw new Error('UNAUTHENTICATED');
    }),
  };
  const app = createApp({
    auth: sessions,
    pets: {} as never,
    addresses: {} as never,
    pilot: { config, sessions: sessions as never },
    operationsCatalog: {
      service: new OperationsCatalogService(repository),
      sessions,
    },
  });
  return { app, repository };
}

describe('operations catalog routes', () => {
  it('publishes only the public catalog fields without authentication', async () => {
    const { app } = setup();
    const response = await app.inject({ method: 'GET', url: '/api/v1/catalog' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      services: catalog.services,
      openDistricts: catalog.openDistricts,
      announcement: catalog.announcement,
    });
  });

  it('returns versioned metadata to an administrator', async () => {
    const { app } = setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/pilot/admin/catalog',
      headers: { authorization: 'Bearer admin' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(catalog);
  });

  it('rejects an owner from administrator catalog routes', async () => {
    const { app } = setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/pilot/admin/catalog',
      headers: { authorization: 'Bearer owner' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'FORBIDDEN' });
  });

  it('updates with the expected version and returns the next version', async () => {
    const { app, repository } = setup();
    const payload = {
      expectedVersion: 1,
      services: catalog.services,
      openDistricts: ['JIANYE'],
      announcement: '雨天请提前沟通',
    };
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/pilot/admin/catalog',
      headers: { authorization: 'Bearer admin' },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().version).toBe(2);
    expect(repository.compareAndSwap).toHaveBeenCalledWith(payload, 'admin-id');
  });

  it('returns validation and optimistic concurrency errors safely', async () => {
    const invalid = setup();
    const invalidResponse = await invalid.app.inject({
      method: 'PUT',
      url: '/api/v1/pilot/admin/catalog',
      headers: { authorization: 'Bearer admin' },
      payload: { expectedVersion: 1 },
    });
    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json().code).toBe('VALIDATION_ERROR');

    const stale = setup(null);
    const staleResponse = await stale.app.inject({
      method: 'PUT',
      url: '/api/v1/pilot/admin/catalog',
      headers: { authorization: 'Bearer admin' },
      payload: {
        expectedVersion: 1,
        services: catalog.services,
        openDistricts: catalog.openDistricts,
        announcement: '',
      },
    });
    expect(staleResponse.statusCode).toBe(409);
    expect(staleResponse.json()).toEqual({ code: 'OPERATIONS_CATALOG_CONFLICT' });
  });
});
