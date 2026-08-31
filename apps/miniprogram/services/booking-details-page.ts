import { ApiError } from './api.js';
import { addressDraft, bookingErrorMessage, parseAddress, parsePet, petDraft } from './booking-details.js';
import { petsForService } from '../presenters/order-create-presenter.js';

export const clearedQuote = { quote: null, quoteRows: [], quotedInput: null };
export function canEditBooking(page: any): boolean {
  return !page.disposed && !page.data.busy && !page.data.detailPending && !page.data.pendingAttempt
    && !page.data.submitted && !page.data.needsProfile && page.data.status === 'ready';
}
export function definitelyRejected(error: unknown): boolean {
  return error instanceof ApiError && [400, 401, 403, 422, 429].includes(error.status);
}
const newKey = (kind: string) => `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function save(page: any, kind: 'pet' | 'address') {
  if (page.disposed || page.data.busy || page.data.needsProfile || page.data.status !== 'ready'
    || page.data.pendingAttempt || page.data.submitted || (page.data.detailPending && page.data.detailPending !== kind)
    || page.data[kind === 'pet' ? 'petMode' : 'addressMode'] !== 'NEW') return;
  const api = getApp<any>().globalData.api;
  const field = kind === 'pet' ? 'petSaveAttempt' : 'addressSaveAttempt';
  page.setData({ busy: true, detailError: '', ...clearedQuote });
  try {
    if (!page[field]) {
      const payload = kind === 'pet'
        ? petDraft(page.data.serviceType, page.data.newPetName, page.data.newPetNotes, newKey('pet'))
        : addressDraft(page.data.districts[page.data.districtIndex]?.name ?? '', page.data.newAddressDetail, newKey('address'));
      page[field] = payload;
    }
    page.setData({ detailPending: kind });
    const result = kind === 'pet' ? await api.createPet(page[field]) : await api.createAddress(page[field]);
    if (page.disposed) return;
    if (kind === 'pet') {
      const saved = parsePet(result);
      if (saved.name !== page[field].name || saved.species !== page[field].species) throw new Error('INVALID_PROFILE_RESPONSE');
      const allPets = [...page.data.allPets.filter((pet: any) => pet.id !== saved.id), saved];
      const pets = petsForService(allPets, page.data.serviceType);
      page.setData({ allPets, pets, petIndex: pets.findIndex((pet) => pet.id === saved.id), petMode: 'EXISTING', newPetName: '', newPetNotes: '' });
    } else {
      const saved = parseAddress(result);
      if (saved.detail !== page[field].detail || saved.district !== page[field].district
        || saved.city !== page[field].city || saved.serviceZone !== page[field].serviceZone) throw new Error('INVALID_PROFILE_RESPONSE');
      const addresses = [...page.data.addresses.filter((address: any) => address.id !== saved.id), saved];
      page.setData({ addresses, addressIndex: addresses.length - 1, addressMode: 'EXISTING', newAddressDetail: '' });
    }
    page[field] = null;
    page.setData({ detailPending: '', detailError: '' });
  } catch (error) {
    if (page.disposed) return;
    if (definitelyRejected(error)) { page[field] = null; page.setData({ detailPending: '' }); }
    page.setData({ detailError: bookingErrorMessage(error) });
  } finally { if (!page.disposed) page.setData({ busy: false }); }
}

export const bookingDetailHandlers = {
  changePetName(this: any, event: any) { if (canEditBooking(this)) this.setData({ newPetName: event.detail.value, detailError: '', ...clearedQuote }); },
  changePetNotes(this: any, event: any) { if (canEditBooking(this)) this.setData({ newPetNotes: event.detail.value, detailError: '', ...clearedQuote }); },
  togglePetNotes(this: any) { if (canEditBooking(this)) this.setData({ showPetNotes: !this.data.showPetNotes }); },
  changeAddressDetail(this: any, event: any) { if (canEditBooking(this)) this.setData({ newAddressDetail: event.detail.value, detailError: '', ...clearedQuote }); },
  chooseDistrict(this: any, event: any) {
    const index = Number(event.detail.value);
    if (canEditBooking(this) && Number.isInteger(index) && this.data.districts[index]) this.setData({ districtIndex: index, detailError: '', ...clearedQuote });
  },
  useNewPet(this: any) { if (canEditBooking(this)) this.setData({ petMode: 'NEW', detailError: '', ...clearedQuote }); },
  useExistingPet(this: any) { if (canEditBooking(this) && this.data.pets.length) this.setData({ petMode: 'EXISTING', detailError: '', ...clearedQuote }); },
  useNewAddress(this: any) { if (canEditBooking(this)) this.setData({ addressMode: 'NEW', detailError: '', ...clearedQuote }); },
  useExistingAddress(this: any) { if (canEditBooking(this) && this.data.addresses.length) this.setData({ addressMode: 'EXISTING', detailError: '', ...clearedQuote }); },
  savePet(this: any) { return save(this, 'pet'); },
  saveAddress(this: any) { return save(this, 'address'); },
};
