import { describe, expect, it } from 'vitest';
import {
  bookingStepIsComplete,
  createBookingDraft,
  nextBookingStep,
  previousBookingStep,
  selectBookingService,
} from './booking.js';

describe('owner booking state', () => {
  it('prefills the selected service and starts at service selection', () => {
    expect(createBookingDraft('DOG_WALKING')).toMatchObject({
      step: 'SERVICE',
      serviceType: 'DOG_WALKING',
      petSpecies: 'DOG',
      durationMinutes: 30,
      districtName: '建邺区',
      petMode: 'EXISTING',
      addressMode: 'EXISTING',
    });
  });

  it('allows only complete steps to advance and preserves backward navigation', () => {
    const service = createBookingDraft('CAT_FEEDING');
    expect(bookingStepIsComplete(service)).toBe(true);
    expect(nextBookingStep(service)).toBe('SCHEDULE');

    const schedule = { ...service, step: 'SCHEDULE' as const };
    expect(bookingStepIsComplete(schedule)).toBe(false);
    expect(nextBookingStep(schedule)).toBe('SCHEDULE');
    expect(bookingStepIsComplete({ ...schedule, startsAt: '2026-09-10T10:00' })).toBe(true);
    expect(previousBookingStep('PET')).toBe('SCHEDULE');
  });

  it('switches required species and clears an incompatible selected pet', () => {
    const catDraft = {
      ...createBookingDraft('CAT_FEEDING'),
      petId: 'cat-id',
      petName: '团子',
      petNotes: '怕生',
    };

    expect(selectBookingService(catDraft, 'DOG_WALKING')).toMatchObject({
      serviceType: 'DOG_WALKING',
      petSpecies: 'DOG',
      petId: '',
      petName: '',
      petNotes: '',
    });
  });

  it('requires either an existing resource or valid new-resource input', () => {
    const base = createBookingDraft();
    expect(bookingStepIsComplete({ ...base, step: 'PET' })).toBe(false);
    expect(bookingStepIsComplete({ ...base, step: 'PET', petMode: 'NEW', petName: '团子' })).toBe(true);
    expect(bookingStepIsComplete({ ...base, step: 'ADDRESS' })).toBe(false);
    expect(bookingStepIsComplete({ ...base, step: 'ADDRESS', addressMode: 'NEW', addressDetail: '奥体大街 1 号' })).toBe(true);
    expect(bookingStepIsComplete({ ...base, step: 'QUOTE' })).toBe(false);
  });
});
