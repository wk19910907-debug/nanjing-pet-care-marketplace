import { describe, expect, it } from 'vitest';
import { CHECKLIST_DEFINITIONS, completedChecklist } from './checklists.js';

describe('pilot service checklists', () => {
  it('requires every cat item to be exactly true', () => {
    expect(CHECKLIST_DEFINITIONS.CAT_FEEDING).toEqual([
      'petCountConfirmed', 'foodRefilled', 'waterRefilled', 'litterCleaned',
    ]);
    expect(completedChecklist('CAT_FEEDING', {
      petCountConfirmed: true, foodRefilled: true, waterRefilled: true,
    })).toBeNull();
    expect(completedChecklist('CAT_FEEDING', {
      petCountConfirmed: true, foodRefilled: true, waterRefilled: true, litterCleaned: true,
    })).toEqual({
      petCountConfirmed: true, foodRefilled: true, waterRefilled: true, litterCleaned: true,
    });
  });

  it('keeps dog duration numeric, finite, and positive', () => {
    expect(completedChecklist('DOG_WALKING', { leashSecured: true, walkDurationMinutes: true })).toBeNull();
    expect(completedChecklist('DOG_WALKING', { leashSecured: true, walkDurationMinutes: 0 })).toBeNull();
    expect(completedChecklist('DOG_WALKING', { leashSecured: true, walkDurationMinutes: 35 }))
      .toEqual({ leashSecured: true, walkDurationMinutes: 35 });
  });
});
