import type { PilotChecklist, ServiceType } from './models.js';

export const CHECKLIST_DEFINITIONS = {
  CAT_FEEDING: ['petCountConfirmed', 'foodRefilled', 'waterRefilled', 'litterCleaned'],
  DOG_WALKING: ['leashSecured', 'walkDurationMinutes'],
} as const;

export function completedChecklist(
  serviceType: ServiceType,
  current: PilotChecklist,
): PilotChecklist | null {
  if (serviceType === 'CAT_FEEDING') {
    return CHECKLIST_DEFINITIONS.CAT_FEEDING.every((key) => current[key] === true)
      ? Object.fromEntries(CHECKLIST_DEFINITIONS.CAT_FEEDING.map((key) => [key, true]))
      : null;
  }
  const duration = current.walkDurationMinutes;
  return current.leashSecured === true
    && typeof duration === 'number'
    && Number.isFinite(duration)
    && duration > 0
    ? { leashSecured: true, walkDurationMinutes: duration }
    : null;
}
