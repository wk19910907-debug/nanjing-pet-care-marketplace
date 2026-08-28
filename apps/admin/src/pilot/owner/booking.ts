import type { OwnerPet, ServiceType } from '../models.js';

export type BookingStep = 'SERVICE' | 'SCHEDULE' | 'PET' | 'ADDRESS' | 'QUOTE';

export type BookingDraft = {
  step: BookingStep;
  serviceType: ServiceType;
  startsAt: string;
  durationMinutes: number;
  petId: string;
  petName: string;
  petSpecies: OwnerPet['species'];
  petNotes: string;
  addressId: string;
  districtName: string;
  addressDetail: string;
  orderNotes: string;
};

const STEPS: readonly BookingStep[] = ['SERVICE', 'SCHEDULE', 'PET', 'ADDRESS', 'QUOTE'];

export function createBookingDraft(serviceType: ServiceType = 'CAT_FEEDING'): BookingDraft {
  return {
    step: 'SERVICE',
    serviceType,
    startsAt: '',
    durationMinutes: 30,
    petId: '',
    petName: '',
    petSpecies: serviceType === 'CAT_FEEDING' ? 'CAT' : 'DOG',
    petNotes: '',
    addressId: '',
    districtName: '建邺区',
    addressDetail: '',
    orderNotes: '',
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
  if (draft.step === 'SERVICE') return true;
  if (draft.step === 'SCHEDULE') {
    return draft.startsAt !== '' && Number.isFinite(new Date(draft.startsAt).getTime());
  }
  if (draft.step === 'PET') return draft.petId !== '' || draft.petName.trim() !== '';
  if (draft.step === 'ADDRESS') {
    return draft.addressId !== '' || draft.addressDetail.trim() !== '';
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
