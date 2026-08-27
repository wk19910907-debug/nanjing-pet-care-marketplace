import type { ServiceType } from '@prisma/client';

export function validateChecklist(serviceType: ServiceType, value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CHECKLIST_INCOMPLETE');
  const checklist = value as Record<string, unknown>;
  const keys = Object.keys(checklist);
  if (keys.length > 30) throw new Error('CHECKLIST_INCOMPLETE');
  const expected = serviceType === 'CAT_FEEDING'
    ? ['petCountConfirmed', 'foodRefilled', 'waterRefilled', 'litterCleaned']
    : ['leashSecured', 'walkDurationMinutes'];
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new Error('CHECKLIST_INCOMPLETE');
  }
  if (serviceType === 'CAT_FEEDING') {
    if (expected.some((key) => checklist[key] !== true)) throw new Error('CHECKLIST_INCOMPLETE');
  } else if (checklist.leashSecured !== true
    || typeof checklist.walkDurationMinutes !== 'number'
    || !Number.isFinite(checklist.walkDurationMinutes)
    || checklist.walkDurationMinutes <= 0) throw new Error('CHECKLIST_INCOMPLETE');
}
