import { describe, expect, it } from 'vitest';
import {
  ActorRoleSchema,
  CreateOrderInputSchema,
  OrderStatusSchema,
  ServiceTypeSchema,
} from './index.js';

const validOrder = {
  serviceType: 'CAT_FEEDING',
  petIds: ['3ec31bb1-26f7-4f17-bb48-6bd54ba34023'],
  addressId: '8cd3fe23-1938-4de7-bdd6-2aec9e33cc2f',
  startsAt: '2026-09-01T10:00:00+08:00',
  notes: '猫粮在厨房上层柜子里',
};

describe('shared order contracts', () => {
  it.each(['CAT_FEEDING', 'DOG_WALKING'])('accepts supported service %s', (serviceType) => {
    expect(ServiceTypeSchema.parse(serviceType)).toBe(serviceType);
  });

  it('rejects unsupported services', () => {
    expect(() => CreateOrderInputSchema.parse({...validOrder, serviceType: 'BOARDING'})).toThrow();
  });

  it('requires one to five valid pet ids', () => {
    expect(() => CreateOrderInputSchema.parse({...validOrder, petIds: []})).toThrow();
    expect(() => CreateOrderInputSchema.parse({...validOrder, petIds: ['not-a-uuid']})).toThrow();
    expect(() => CreateOrderInputSchema.parse({...validOrder, petIds: Array(6).fill(validOrder.petIds[0])})).toThrow();
  });

  it('requires a UUID address and timezone-aware ISO start time', () => {
    expect(() => CreateOrderInputSchema.parse({...validOrder, addressId: ''})).toThrow();
    expect(() => CreateOrderInputSchema.parse({...validOrder, startsAt: '2026-09-01T10:00:00'})).toThrow();
  });

  it('limits notes to 500 characters', () => {
    expect(() => CreateOrderInputSchema.parse({...validOrder, notes: 'x'.repeat(501)})).toThrow();
  });

  it('exports the complete order status and actor role vocabularies', () => {
    expect(OrderStatusSchema.options).toHaveLength(12);
    expect(ActorRoleSchema.options).toEqual([
      'OWNER', 'PROVIDER', 'REVIEWER', 'DISPATCHER', 'SUPPORT', 'ADMIN',
    ]);
  });
});
