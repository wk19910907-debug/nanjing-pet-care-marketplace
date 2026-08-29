import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { presentCatalog, presentCatalogFailure } from '../presenters/catalog-presenter.js';
import { createOrderAttempt, petsForService } from '../presenters/order-create-presenter.js';

describe('mini program catalog presenter', () => {
  it('shows only enabled services with live prices, announcement, and open districts', () => {
    expect(presentCatalog({
      services: {
        CAT_FEEDING: { enabled: true, basePriceFen: 3450 },
        DOG_WALKING: { enabled: false, basePriceFen: 3900 },
      },
      openDistricts: ['JIANYE', 'QINHUAI'],
      announcement: '周末订单请提前预约',
    })).toEqual({
      status: 'ready',
      announcement: '周末订单请提前预约',
      serviceCards: [{ type: 'CAT_FEEDING', title: '上门喂猫', summary: '喂食换水、清理猫砂、状态反馈', price: '¥34.50 起' }],
      districts: [{ code: 'JIANYE', name: '建邺区' }, { code: 'QINHUAI', name: '秦淮区' }],
      bookingAvailable: true,
    });
  });

  it('provides a retry-safe unavailable state', () => {
    expect(presentCatalogFailure()).toEqual({
      status: 'error', announcement: '', serviceCards: [], districts: [], bookingAvailable: false,
      errorMessage: '服务信息加载失败，请重试',
    });
  });

  it('uses submit-order wording and contains no payment claim', () => {
    const template = readFileSync(new URL('../pages/owner/order-create/index.wxml', import.meta.url), 'utf8');
    expect(template).toContain('提交订单');
    expect(template).not.toContain('确认并支付');
  });

  it('offers only pets matching the selected service', () => {
    const pets = [{ id: 'cat-1', name: '团子', species: 'CAT' as const }, { id: 'dog-1', name: '旺财', species: 'DOG' as const }];
    expect(petsForService(pets, 'CAT_FEEDING')).toEqual([pets[0]]);
    expect(petsForService(pets, 'DOG_WALKING')).toEqual([pets[1]]);
  });

  it('freezes one payload and idempotency key for lost-response retries', () => {
    const input = { serviceType: 'CAT_FEEDING' as const, petIds: ['pet-1'], addressId: 'address-1',
      startsAt: '2026-09-01T10:00:00+08:00', durationMinutes: 30, notes: '' };
    const attempt = createOrderAttempt(input, () => 'stable-key');
    input.petIds.push('pet-2');
    expect(attempt).toEqual({ input: { ...input, petIds: ['pet-1'] }, idempotencyKey: 'stable-key' });
  });
});
