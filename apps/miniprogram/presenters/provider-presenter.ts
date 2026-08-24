import type { ServiceType } from '@pet/contracts';

export function invitationCountdown(expiresAt: string, now: Date) {
  const remaining = new Date(expiresAt).getTime() - now.getTime();
  return { seconds: Math.max(0, Math.ceil(remaining / 1000)), expired: remaining <= 0 };
}

export function reportReadiness(
  serviceType: ServiceType,
  checklist: Record<string, unknown>,
  evidenceCount: number,
) {
  const missing: string[] = [];
  if (serviceType === 'CAT_FEEDING') {
    for (const [key, label] of [
      ['petCountConfirmed', '确认宠物数量'], ['foodRefilled', '补充食物'],
      ['waterRefilled', '补充饮水'], ['litterCleaned', '清理猫砂'],
    ] as const) if (checklist[key] !== true) missing.push(label);
  } else {
    if (checklist.leashSecured !== true) missing.push('确认牵引绳');
    if (typeof checklist.walkDurationMinutes !== 'number' || checklist.walkDurationMinutes <= 0) {
      missing.push('填写遛狗时长');
    }
  }
  if (evidenceCount < 1) missing.push('至少上传一项服务证据');
  return { ready: missing.length === 0, missing };
}

export function presentUploadFailure(_error: unknown) {
  return { title: '上传失败', message: '请检查网络后重试，原文件已保留。', canRetry: true };
}
