import { describe, expect, it } from 'vitest';
import { createApiClient } from '../services/api.js';
import { addressDraft, petDraft, bookingStartsAt, parseAddress, parsePet } from '../services/booking-details.js';

describe('minimal booking details', () => {
  it('derives species from the service and trims a minimal pet draft', () => {
    expect(petDraft('CAT_FEEDING', ' 团子 ', '', 'pet-key')).toEqual({
      name: '团子', species: 'CAT', sensitiveNotes: '', clientRequestId: 'pet-key',
    });
    expect(petDraft('DOG_WALKING', '小白', '怕车', 'dog-key').species).toBe('DOG');
    expect(() => petDraft('CAT_FEEDING', ' ', '', 'key')).toThrow();
    expect(() => petDraft('DOG_WALKING', 'x'.repeat(51), '', 'key')).toThrow();
  });
  it('sends the existing district centroid without asking the owner for coordinates', () => {
    expect(addressDraft('建邺区', ' 某小区1栋101 ', 'addr-key')).toEqual({
      city: '南京市', district: '建邺区', serviceZone: '建邺区',
      latitude: 32.003, longitude: 118.732, detail: '某小区1栋101', accessInstructions: '', clientRequestId: 'addr-key',
    });
    expect(() => addressDraft('未知区', '地址', 'key')).toThrow();
    expect(() => addressDraft('鼓楼区', ' ', 'key')).toThrow();
  });
  it('combines date and time explicitly in China time regardless of host timezone', () => {
    expect(bookingStartsAt('2099-09-01', '10:30', 0)).toBe('2099-09-01T10:30:00+08:00');
  });
  it.each([['2099-02-29', '10:00'], ['2099-04-31', '10:00'], ['2099-09-01', '24:00'],
    ['2099-9-1', '10:00'], ['', ''], ['2000-01-01', '10:00']])
  ('rejects invalid or past visit time %s %s', (date, time) => {
    expect(() => bookingStartsAt(date, time, Date.parse('2026-08-31T00:00:00Z'))).toThrow();
  });
  it('projects only the fields needed to select a pet or distinguish an address', () => {
    expect(parsePet({ id: 'pet-1', name: '团子', species: 'CAT', ownerId: 'hidden', sensitiveNotes: 'hidden' }))
      .toEqual({ id: 'pet-1', name: '团子', species: 'CAT' });
    expect(parseAddress({ id: 'a-1', city: '南京市', district: '建邺区', serviceZone: '建邺区',
      detail: '小区1栋101', accessInstructions: 'hidden' })).toEqual({
      id: 'a-1', city: '南京市', district: '建邺区', serviceZone: '建邺区', detail: '小区1栋101', label: '建邺区 · 小区1栋101',
    });
    expect(() => parsePet({ id: '', name: '', species: 'CAT' })).toThrow();
    expect(() => parseAddress({ id: 'a-1', district: '建邺区' })).toThrow();
  });
  it('posts authenticated creation payloads and validates server-selected records', async () => {
    const calls: any[] = [];
    const api = createApiClient({ baseUrl: 'https://api.example.test', token: () => 'opaque-token', transport: async (request) => {
      calls.push(request);
      const input = request.data as Record<string, unknown>;
      return { statusCode: 201, data: request.url.endsWith('/pets') ? { id: 'p1', ...input }
        : { id: 'a1', city: input.city, district: input.district, serviceZone: input.serviceZone, detail: input.detail } };
    } });
    expect((await api.createPet(petDraft('CAT_FEEDING', '团子', '', 'pk'))).id).toBe('p1');
    expect((await api.createAddress(addressDraft('建邺区', '小区1栋', 'ak'))).detail).toBe('小区1栋');
    expect(calls.map(({ url }) => url)).toEqual(['https://api.example.test/api/v1/pets', 'https://api.example.test/api/v1/addresses']);
    expect(calls.every(({ headers }) => headers.Authorization === 'Bearer opaque-token')).toBe(true);
  });
  it('does not treat malformed successful responses as saved records', async () => {
    const api = createApiClient({ baseUrl: 'https://api.example.test', token: () => 't',
      transport: async () => ({ statusCode: 201, data: {} }) });
    await expect(api.createPet(petDraft('CAT_FEEDING', '团子', '', 'key'))).rejects.toThrow('INVALID_PROFILE_RESPONSE');
    await expect(api.createAddress(addressDraft('建邺区', '门牌', 'key'))).rejects.toThrow('INVALID_PROFILE_RESPONSE');
  });
  it('accepts only the canonical server quote shape', async () => {
    const quote = { baseFen: 3200, durationFen: 700, distanceFen: 500, extraPetFen: 0,
      holidayFen: 0, totalFen: 4400, currency: 'CNY' };
    const api = createApiClient({ baseUrl: 'https://api.example.test', token: () => 't',
      transport: async () => ({ statusCode: 200, data: quote }) });
    expect(await api.quote({})).toEqual(quote);
    const malformed = createApiClient({ baseUrl: 'https://api.example.test', token: () => 't',
      transport: async () => ({ statusCode: 200, data: { totalFen: 3200 } }) });
    await expect(malformed.quote({})).rejects.toThrow();
  });
});
