import type { ServiceType } from '@pet/contracts';

type Pet = { id: string; name: string; species: 'CAT' | 'DOG' };
type OrderInput = {
  serviceType: ServiceType;
  petIds: string[];
  addressId: string;
  startsAt: string;
  durationMinutes: number;
  notes: string;
};

export function petsForService<T extends Pet>(pets: T[], serviceType: ServiceType): T[] {
  const species = serviceType === 'CAT_FEEDING' ? 'CAT' : 'DOG';
  return pets.filter((pet) => pet.species === species);
}

export function createOrderAttempt(input: OrderInput, key: () => string) {
  return { input: { ...input, petIds: [...input.petIds] }, idempotencyKey: key() };
}
