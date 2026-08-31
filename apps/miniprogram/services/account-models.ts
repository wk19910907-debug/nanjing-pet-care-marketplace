import { ActorRoleSchema, type ActorRole } from '@pet/contracts';

export type AccountSession = { userId: string; role: ActorRole; displayName: string | null; expiresAt: string };
export function parseAccountSession(input: unknown): AccountSession {
  if (!input || typeof input !== 'object') throw new Error('INVALID_SESSION_RESPONSE');
  const value = input as Record<string, unknown>;
  const role = ActorRoleSchema.safeParse(value.role);
  if (typeof value.userId !== 'string' || !value.userId || !role.success
    || !(value.displayName === null || (typeof value.displayName === 'string' && value.displayName.trim().length > 0 && value.displayName.length <= 30))
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error('INVALID_SESSION_RESPONSE');
  return { userId: value.userId, role: role.data, displayName: value.displayName, expiresAt: value.expiresAt };
}

export function accountErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'DISPLAY_NAME_INVALID') return '请填写1–30字昵称，不要包含手机号、邮箱或微信号。';
  if (code === 'ACCOUNT_ROLE_MISMATCH') return '当前账号身份不匹配，请使用对应身份的账号。服务人员需由平台审核。';
  if (code === 'ACCOUNT_BUSY') return '正在确认另一个身份，请稍后重试。';
  if (code === 'PROFILE_NOT_CONFIRMED') return '昵称保存结果尚未确认，请重新加载后再试。';
  if (code === 'UNAUTHENTICATED') return '登录已失效，请重新加载后重试。';
  return '暂时无法确认账号，请检查连接后重试。';
}
