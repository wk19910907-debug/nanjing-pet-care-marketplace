import type { OwnerPet, ServiceType } from '../models.js';

export type BookingStep = 'SERVICE_TIME' | 'VISIT_INFO' | 'CONFIRM';

export type BookingDraft = {
  step: BookingStep;
  serviceType: ServiceType;
  startsAt: string;
  durationMinutes: number;
  petMode: 'EXISTING' | 'NEW';
  petId: string;
  petName: string;
  petSpecies: OwnerPet['species'];
  petNotes: string;
  addressId: string;
  districtName: string;
  addressDetail: string;
  orderNotes: string;
  addressMode: 'EXISTING' | 'NEW';
};

const STEPS: readonly BookingStep[] = ['SERVICE_TIME', 'VISIT_INFO', 'CONFIRM'];

export function createBookingDraft(serviceType: ServiceType = 'CAT_FEEDING'): BookingDraft {
  return {
    step: 'SERVICE_TIME',
    serviceType,
    startsAt: '',
    durationMinutes: 30,
    petMode: 'EXISTING',
    petId: '',
    petName: '',
    petSpecies: serviceType === 'CAT_FEEDING' ? 'CAT' : 'DOG',
    petNotes: '',
    addressId: '',
    districtName: '建邺区',
    addressDetail: '',
    orderNotes: '',
    addressMode: 'EXISTING',
  };
}

export function selectBookingService(
  draft: BookingDraft,
  serviceType: ServiceType,
): BookingDraft {
  if (draft.serviceType === serviceType) return draft;
  return {
    ...draft,
    serviceType,
    petId: '',
    petName: '',
    petSpecies: serviceType === 'CAT_FEEDING' ? 'CAT' : 'DOG',
    petNotes: '',
  };
}

export function bookingStepIsComplete(draft: BookingDraft): boolean {
  if (draft.step === 'SERVICE_TIME') {
    return draft.startsAt !== '' && Number.isFinite(new Date(draft.startsAt).getTime());
  }
  if (draft.step === 'VISIT_INFO') {
    const petReady = draft.petMode === 'EXISTING' ? draft.petId !== '' : draft.petName.trim() !== '';
    const addressReady = draft.addressMode === 'EXISTING'
      ? draft.addressId !== ''
      : draft.addressDetail.trim() !== '';
    return petReady && addressReady;
  }
  return draft.petId !== ''
    && draft.addressId !== ''
    && draft.startsAt !== ''
    && Number.isFinite(new Date(draft.startsAt).getTime());
}

export function nextBookingStep(draft: BookingDraft): BookingStep {
  if (!bookingStepIsComplete(draft)) return draft.step;
  return STEPS[Math.min(STEPS.indexOf(draft.step) + 1, STEPS.length - 1)]!;
}

export function previousBookingStep(step: BookingStep): BookingStep {
  return STEPS[Math.max(STEPS.indexOf(step) - 1, 0)]!;
}
