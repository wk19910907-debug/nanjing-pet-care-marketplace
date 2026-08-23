import type { ServiceType } from '@prisma/client';

export function validateChecklist(serviceType: ServiceType, value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CHECKLIST_INCOMPLETE');
  const checklist = value as Record<string, unknown>;
  if (serviceType === 'CAT_FEEDING') {
    const required = ['petCountConfirmed', 'foodRefilled', 'waterRefilled', 'litterCleaned'];
    if (required.some((key) => checklist[key] !== true)) throw new Error('CHECKLIST_INCOMPLETE');
    return;
  }
  if (checklist.leashSecured !== true
    || typeof checklist.walkDurationMinutes !== 'number'
    || !Number.isFinite(checklist.walkDurationMinutes)
    || checklist.walkDurationMinutes <= 0) {
    throw new Error('CHECKLIST_INCOMPLETE');
  }
}
