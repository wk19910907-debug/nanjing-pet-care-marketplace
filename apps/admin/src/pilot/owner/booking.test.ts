import { describe, expect, it } from 'vitest';
import {
  bookingStepIsComplete,
  createBookingDraft,
  nextBookingStep,
  previousBookingStep,
  selectBookingService,
} from './booking.js';

describe('owner booking state', () => {
  it('prefills the selected service and starts at service and time', () => {
    expect(createBookingDraft('DOG_WALKING')).toMatchObject({
      step: 'SERVICE_TIME',
      serviceType: 'DOG_WALKING',
      petSpecies: 'DOG',
      durationMinutes: 30,
      districtName: '建邺区',
      petMode: 'EXISTING',
      addressMode: 'EXISTING',
    });
  });

  it('allows only complete steps to advance and preserves backward navigation', () => {
    const serviceTime = createBookingDraft('CAT_FEEDING');
    expect(bookingStepIsComplete(serviceTime)).toBe(false);
    expect(nextBookingStep(serviceTime)).toBe('SERVICE_TIME');
    expect(bookingStepIsComplete({ ...serviceTime, startsAt: '2026-09-10T10:00' })).toBe(true);
    expect(nextBookingStep({ ...serviceTime, startsAt: '2026-09-10T10:00' })).toBe('VISIT_INFO');
    expect(previousBookingStep('CONFIRM')).toBe('VISIT_INFO');
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
    const visit = { ...base, step: 'VISIT_INFO' as const };
    expect(bookingStepIsComplete(visit)).toBe(false);
    expect(bookingStepIsComplete({ ...visit, petMode: 'NEW', petName: '团子' })).toBe(false);
    expect(bookingStepIsComplete({
      ...visit, petMode: 'NEW', petName: '团子', addressMode: 'NEW', addressDetail: '奥体大街 1 号',
    })).toBe(true);
    expect(bookingStepIsComplete({ ...base, step: 'CONFIRM' })).toBe(false);
  });
});
