import { describe, expect, it, vi } from 'vitest';
import type { AdminOperationsCatalog, OperationsCatalogUpdate } from '@pet/contracts';
import {
  OperationsCatalogService,
  type OperationsCatalogRepository,
} from '../src/catalog/operations-catalog-service.js';

const saved: AdminOperationsCatalog = {
  version: 1,
  updatedAt: '2026-08-29T08:00:00.000Z',
  services: {
    CAT_FEEDING: { enabled: true, basePriceFen: 3_200 },
    DOG_WALKING: { enabled: true, basePriceFen: 3_700 },
  },
  openDistricts: ['JIANYE', 'GULOU'],
  announcement: '',
};

function setup(result: AdminOperationsCatalog | null = { ...saved, version: 2 }) {
  const repository: OperationsCatalogRepository = {
    get: vi.fn().mockResolvedValue(saved),
    compareAndSwap: vi.fn().mockResolvedValue(result),
  };
  return { service: new OperationsCatalogService(repository), repository };
}

describe('OperationsCatalogService', () => {
  it('returns a redacted public catalog', async () => {
    const { service } = setup();
    await expect(service.getPublic()).resolves.toEqual({
      services: saved.services,
      openDistricts: saved.openDistricts,
      announcement: '',
    });
  });

  it('allows only administrators to read internal catalog metadata', async () => {
    const { service } = setup();
    await expect(service.getAdmin({ userId: 'admin-id', role: 'ADMIN' })).resolves.toEqual(saved);
    await expect(service.getAdmin({ userId: 'owner-id', role: 'OWNER' })).rejects.toThrow('FORBIDDEN');
  });

  it('validates a complete update and passes the administrator for auditing', async () => {
    const { service, repository } = setup();
    const input: OperationsCatalogUpdate = {
      expectedVersion: 1,
      services: {
        CAT_FEEDING: { enabled: true, basePriceFen: 3_500 },
        DOG_WALKING: { enabled: false, basePriceFen: 3_900 },
      },
      openDistricts: ['JIANYE'],
      announcement: '雨天遛狗请提前沟通',
    };

    await service.update({ userId: 'admin-id', role: 'ADMIN' }, input);

    expect(repository.compareAndSwap).toHaveBeenCalledWith(input, 'admin-id');
  });

  it('rejects malformed updates before touching persistence', async () => {
    const { service, repository } = setup();
    await expect(service.update({ userId: 'admin-id', role: 'ADMIN' }, {
      expectedVersion: 1,
      ...saved,
      openDistricts: [],
    })).rejects.toThrow();
    expect(repository.compareAndSwap).not.toHaveBeenCalled();
  });

  it('rejects non-administrator updates', async () => {
    const { service, repository } = setup();
    await expect(service.update({ userId: 'owner-id', role: 'OWNER' }, {
      expectedVersion: 1,
      services: saved.services,
      openDistricts: saved.openDistricts,
      announcement: saved.announcement,
    })).rejects.toThrow('FORBIDDEN');
    expect(repository.compareAndSwap).not.toHaveBeenCalled();
  });

  it('reports a concurrent update instead of overwriting it', async () => {
    const { service } = setup(null);
    await expect(service.update({ userId: 'admin-id', role: 'ADMIN' }, {
      expectedVersion: 1,
      services: saved.services,
      openDistricts: saved.openDistricts,
      announcement: saved.announcement,
    })).rejects.toThrow('OPERATIONS_CATALOG_CONFLICT');
  });
});
