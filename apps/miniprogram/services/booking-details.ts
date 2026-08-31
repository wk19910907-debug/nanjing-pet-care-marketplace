import type { ServiceType } from '@pet/contracts';

export type PetRecord = { id: string; name: string; species: 'CAT' | 'DOG' };
export type AddressRecord = { id: string; city: string; district: string; serviceZone: string; detail: string; label: string };
export type PetDraft = { name: string; species: 'CAT' | 'DOG'; sensitiveNotes: string; clientRequestId: string };
export type AddressDraft = { city: '南京市'; district: string; serviceZone: string; latitude: number; longitude: number;
  detail: string; accessInstructions: string; clientRequestId: string };
const DISTRICT_CENTROIDS: Record<string, readonly [number, number]> = {
  建邺区: [32.003, 118.732], 鼓楼区: [32.066, 118.769], 玄武区: [32.048, 118.798], 秦淮区: [32.039, 118.795],
};
export function petDraft(service: ServiceType, name: string, notes: string, key: string): PetDraft {
  if (!name.trim() || name.trim().length > 50 || notes.length > 1000) throw new Error('PET_NAME_INVALID');
  if (service !== 'CAT_FEEDING' && service !== 'DOG_WALKING') throw new Error('SERVICE_NOT_AVAILABLE');
  return { name: name.trim(), species: service === 'CAT_FEEDING' ? 'CAT' : 'DOG', sensitiveNotes: notes, clientRequestId: key };
}
export function addressDraft(district: string, detail: string, key: string): AddressDraft {
  const point = DISTRICT_CENTROIDS[district];
  if (!point) throw new Error('AREA_NOT_AVAILABLE');
  if (!detail.trim() || detail.trim().length > 300) throw new Error('ADDRESS_DETAIL_INVALID');
  return { city: '南京市', district, serviceZone: district, latitude: point[0], longitude: point[1],
    detail: detail.trim(), accessInstructions: '', clientRequestId: key };
}
export function bookingStartsAt(date: string, time: string, now = Date.now()): string {
  const value = `${date}T${time}:00+08:00`;
  const instant = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
    || !Number.isFinite(instant) || instant <= now
    || new Date(instant + 8 * 60 * 60_000).toISOString().slice(0, 16) !== `${date}T${time}`) {
    throw new Error('VISIT_TIME_INVALID');
  }
  return value;
}
export function chinaToday(now = Date.now()): string {
  return new Date(now + 8 * 60 * 60_000).toISOString().slice(0, 10);
}
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_PROFILE_RESPONSE');
  return input as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('INVALID_PROFILE_RESPONSE');
  return value;
}
export function parsePet(input: unknown): PetRecord {
  const data = record(input);
  if (data.species !== 'CAT' && data.species !== 'DOG') throw new Error('INVALID_PROFILE_RESPONSE');
  return { id: text(data.id, 100), name: text(data.name, 50), species: data.species };
}
export function parseAddress(input: unknown): AddressRecord {
  const data = record(input);
  const district = text(data.district, 30);
  const detail = text(data.detail, 300);
  return { id: text(data.id, 100), city: text(data.city, 30), district, serviceZone: text(data.serviceZone, 50),
    detail, label: `${district} · ${detail}` };
}
export function bookingErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    PET_NAME_INVALID: '请填写1–50字宠物名字，注意事项不超过1000字。',
    ADDRESS_DETAIL_INVALID: '请填写小区、楼栋和门牌，不超过300字。',
    VISIT_TIME_INVALID: '请选择有效且尚未到来的上门日期和时间。',
    DETAILS_REQUIRED: '请先保存或选择宠物、上门地址，再选择时间。',
    AREA_NOT_AVAILABLE: '该区域暂未开放，请重新选择。', SERVICE_NOT_AVAILABLE: '该服务暂未开放。',
    PROFILE_REQUEST_CONFLICT: '这次保存与已有资料不一致，请重新进入预约查看已保存资料。',
    INVALID_PROFILE_RESPONSE: '保存结果尚未确认，请重试确认；请确保后台已更新。',
    VALIDATION_ERROR: '资料未通过校验，请检查后再保存。',
    UNAUTHENTICATED: '登录已失效，请重新进入预约。', FORBIDDEN: '当前账号暂不能执行此操作。',
  };
  return messages[code] ?? '结果尚未确认，请检查网络后重试。重试不会重复创建本次资料或订单。';
}
