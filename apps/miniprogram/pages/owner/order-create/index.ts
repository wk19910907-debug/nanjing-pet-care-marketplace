import { presentCatalog, presentCatalogFailure } from '../../../presenters/catalog-presenter.js';
import { presentQuoteBreakdown } from '../../../presenters/order-presenter.js';
import { createOrderAttempt, petsForService } from '../../../presenters/order-create-presenter.js';
import { accountErrorMessage } from '../../../services/account-models.js';
import { profileHandlers } from '../../../services/profile-page.js';
import { ambiguousBookingErrorMessage, bookingDetailHandlers, canEditBooking, clearedQuote, definitelyRejected } from '../../../services/booking-details-page.js';
import { bookingErrorMessage, bookingStartsAt, chinaToday } from '../../../services/booking-details.js';

Page({
  ...profileHandlers('OWNER', 'loadForm'),
  ...bookingDetailHandlers,
  data: {
    needsProfile: false, displayName: '', profileError: '',
    status: 'loading', errorMessage: '', serviceCards: [], districts: [], announcement: '',
    allPets: [], pets: [], addresses: [], serviceType: 'CAT_FEEDING', petIndex: 0, addressIndex: 0,
    petMode: 'EXISTING', addressMode: 'EXISTING', newPetName: '', newPetNotes: '', showPetNotes: false,
    newAddressDetail: '', districtIndex: 0, detailError: '', detailPending: '',
    today: '', visitDate: '', visitTime: '', durationMinutes: 25,
    quote: null, quoteRows: [], quotedInput: null, pendingAttempt: null, busy: false, submitted: false, createdOrderId: '',
  },
  async onLoad(this: any, query: { serviceType?: string }) {
    this.setData({ today: chinaToday() });
    if (query.serviceType === 'DOG_WALKING') this.setData({ serviceType: 'DOG_WALKING', durationMinutes: 30 });
    await this.loadForm();
  },
  onUnload(this: any) { this.disposed = true; },
  async loadForm(this: any) {
    if (this.disposed || this.data.busy || this.data.detailPending || this.data.pendingAttempt || this.data.submitted) return;
    this.setData({ busy: true, status: 'loading', errorMessage: '', quote: null, quoteRows: [], pendingAttempt: null });
    const { api, access } = getApp<any>().globalData;
    try {
      const current = await access.load('OWNER');
      if (this.disposed) return;
      this.setData({ needsProfile: current.displayName === null });
      if (current.displayName === null) { this.setData({ status: 'profile' }); return; }
      const [catalog, pets, addresses] = await Promise.all([api.getCatalog(), api.listPets(), api.listAddresses()]);
      if (this.disposed) return;
      const view = presentCatalog(catalog);
      const openNames = new Set<string>(view.districts.map((district) => district.name));
      const serviceType = view.serviceCards.some((service) => service.type === this.data.serviceType)
        ? this.data.serviceType : view.serviceCards[0]?.type ?? '';
      const availablePets = petsForService(pets, serviceType);
      const availableAddresses = addresses.filter((address: { district: string }) => openNames.has(address.district));
      this.setData({ ...view, serviceType, durationMinutes: serviceType === 'CAT_FEEDING' ? 25 : 30,
        allPets: pets, pets: availablePets, addresses: availableAddresses, petIndex: 0, addressIndex: 0,
        petMode: availablePets.length ? 'EXISTING' : 'NEW', addressMode: availableAddresses.length ? 'EXISTING' : 'NEW', ...clearedQuote });
    } catch (error) { if (!this.disposed) this.setData({ ...presentCatalogFailure(), errorMessage: accountErrorMessage(error) }); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  chooseService(this: any, event: any) {
    const serviceType = event.currentTarget.dataset.value;
    if (!canEditBooking(this) || !this.data.serviceCards.some((item: any) => item.type === serviceType)) return;
    const pets = petsForService(this.data.allPets, serviceType);
    this.setData({ serviceType, pets, petIndex: 0, petMode: pets.length ? 'EXISTING' : 'NEW',
      durationMinutes: serviceType === 'CAT_FEEDING' ? 25 : 30, newPetName: '', newPetNotes: '', ...clearedQuote });
  },
  choosePet(this: any, event: any) {
    const index = Number(event.detail.value);
    if (canEditBooking(this) && Number.isInteger(index) && this.data.pets[index]) this.setData({ petIndex: index, ...clearedQuote });
  },
  chooseAddress(this: any, event: any) {
    const index = Number(event.detail.value);
    if (canEditBooking(this) && Number.isInteger(index) && this.data.addresses[index]) this.setData({ addressIndex: index, ...clearedQuote });
  },
  changeVisitDate(this: any, event: any) { if (canEditBooking(this)) this.setData({ visitDate: event.detail.value, ...clearedQuote }); },
  changeVisitTime(this: any, event: any) { if (canEditBooking(this)) this.setData({ visitTime: event.detail.value, ...clearedQuote }); },
  requestInput(this: any) {
    const pet = this.data.pets[this.data.petIndex];
    const address = this.data.addresses[this.data.addressIndex];
    if (!this.data.serviceType || !pet || !address || this.data.petMode !== 'EXISTING' || this.data.addressMode !== 'EXISTING') throw new Error('DETAILS_REQUIRED');
    return { serviceType: this.data.serviceType, petIds: [pet.id], addressId: address.id,
      startsAt: bookingStartsAt(this.data.visitDate, this.data.visitTime), durationMinutes: this.data.durationMinutes };
  },
  async refreshQuote(this: any) {
    if (!canEditBooking(this)) return;
    this.setData({ busy: true, detailError: '', ...clearedQuote });
    try {
      const input = this.requestInput();
      const quote = await getApp<any>().globalData.api.quote(input);
      if (this.disposed) return;
      if (!quote || !Number.isSafeInteger(quote.totalFen) || quote.totalFen <= 0) throw new Error('INVALID_QUOTE_RESPONSE');
      this.setData({ quote, quoteRows: presentQuoteBreakdown(quote), quotedInput: { ...input, notes: '' } });
    } catch (error) { if (!this.disposed) this.setData({ detailError: bookingErrorMessage(error) }); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  async submit(this: any) {
    if (this.disposed || this.data.needsProfile || this.data.status !== 'ready' || this.data.detailPending
      || this.data.submitted || !this.data.quote || !this.data.quotedInput || this.data.busy) return;
    this.setData({ busy: true, detailError: '' });
    let requestSent = false;
    try {
      if (!this.data.pendingAttempt && JSON.stringify({ ...this.requestInput(), notes: '' }) !== JSON.stringify(this.data.quotedInput)) {
        this.setData({ ...clearedQuote }); throw new Error('DETAILS_REQUIRED');
      }
      const attempt = this.data.pendingAttempt ?? createOrderAttempt(
        this.data.quotedInput, () => `${Date.now()}-${Math.random()}`,
      );
      if (!this.data.pendingAttempt) this.setData({ pendingAttempt: attempt });
      requestSent = true;
      const order = await getApp<any>().globalData.api.createOrder(attempt.input, attempt.idempotencyKey);
      if (this.disposed) return;
      if (!order || typeof order.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(order.id)) throw new Error('INVALID_ORDER_RESPONSE');
      this.setData({ pendingAttempt: null, submitted: true, createdOrderId: order.id });
      wx.showToast({ title: '订单已提交，请查看详情', icon: 'none' });
      this.openCreatedOrder();
    } catch (error) {
      if (!this.disposed) {
        const hasPriorAmbiguity = this.orderAttemptAmbiguous === true;
        const rejected = definitelyRejected(error, hasPriorAmbiguity);
        const ambiguous = hasPriorAmbiguity || (requestSent && !rejected);
        if (rejected) {
          this.orderAttemptAmbiguous = false;
          this.setData({ pendingAttempt: null, ...clearedQuote });
        } else if (requestSent) this.orderAttemptAmbiguous = true;
        this.setData({ detailError: ambiguous ? ambiguousBookingErrorMessage(error) : bookingErrorMessage(error) });
      }
    }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  openCreatedOrder(this: any) {
    if (!this.disposed && this.data.submitted && this.data.createdOrderId) wx.navigateTo({ url: `/pages/owner/order-detail/index?id=${encodeURIComponent(this.data.createdOrderId)}` });
  },
});
