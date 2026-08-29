import { describe, expect, it } from 'vitest';
import {
  AdminOperationsCatalogSchema,
  DEFAULT_OPERATIONS_CATALOG,
  NANJING_DISTRICTS,
  OperationsCatalogUpdateSchema,
  PublicOperationsCatalogSchema,
} from './index.js';

describe('operations catalog contracts', () => {
  it('defines stable codes for the supported Nanjing districts', () => {
    expect(NANJING_DISTRICTS).toEqual([
      { code: 'JIANYE', name: '建邺区' },
      { code: 'GULOU', name: '鼓楼区' },
      { code: 'XUANWU', name: '玄武区' },
      { code: 'QINHUAI', name: '秦淮区' },
    ]);
  });

  it('accepts a public catalog with exactly the two launch services', () => {
    expect(PublicOperationsCatalogSchema.parse(DEFAULT_OPERATIONS_CATALOG)).toEqual(
      DEFAULT_OPERATIONS_CATALOG,
    );
  });

  it('rejects fractional, non-positive, and excessive prices', () => {
    for (const basePriceFen of [0, 10.5, 100_001]) {
      expect(() => PublicOperationsCatalogSchema.parse({
        ...DEFAULT_OPERATIONS_CATALOG,
        services: {
          ...DEFAULT_OPERATIONS_CATALOG.services,
          CAT_FEEDING: { enabled: true, basePriceFen },
        },
      })).toThrow();
    }
  });

  it('requires at least one unique supported district', () => {
    expect(() => PublicOperationsCatalogSchema.parse({
      ...DEFAULT_OPERATIONS_CATALOG,
      openDistricts: [],
    })).toThrow();
    expect(() => PublicOperationsCatalogSchema.parse({
      ...DEFAULT_OPERATIONS_CATALOG,
      openDistricts: ['JIANYE', 'JIANYE'],
    })).toThrow();
    expect(() => PublicOperationsCatalogSchema.parse({
      ...DEFAULT_OPERATIONS_CATALOG,
      openDistricts: ['PUDONG'],
    })).toThrow();
  });

  it('limits the public announcement and rejects unknown fields', () => {
    expect(() => PublicOperationsCatalogSchema.parse({
      ...DEFAULT_OPERATIONS_CATALOG,
      announcement: '公'.repeat(121),
    })).toThrow();
    expect(() => PublicOperationsCatalogSchema.parse({
      ...DEFAULT_OPERATIONS_CATALOG,
      internalNote: 'secret',
    })).toThrow();
  });

  it('adds version and update metadata only to the administrator shape', () => {
    const admin = AdminOperationsCatalogSchema.parse({
      ...DEFAULT_OPERATIONS_CATALOG,
      version: 3,
      updatedAt: '2026-08-29T08:00:00.000Z',
    });
    expect(admin.version).toBe(3);
    expect(() => PublicOperationsCatalogSchema.parse(admin)).toThrow();
  });

  it('requires a positive expected version for a complete update', () => {
    expect(OperationsCatalogUpdateSchema.parse({
      expectedVersion: 2,
      ...DEFAULT_OPERATIONS_CATALOG,
    }).expectedVersion).toBe(2);
    expect(() => OperationsCatalogUpdateSchema.parse({
      expectedVersion: 0,
      ...DEFAULT_OPERATIONS_CATALOG,
    })).toThrow();
  });
});
