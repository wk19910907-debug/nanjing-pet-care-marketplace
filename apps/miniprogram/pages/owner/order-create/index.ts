import { presentCatalog, presentCatalogFailure } from '../../../presenters/catalog-presenter.js';
import { presentQuoteBreakdown } from '../../../presenters/order-presenter.js';
import { createOrderAttempt, petsForService } from '../../../presenters/order-create-presenter.js';
import { accountErrorMessage } from '../../../services/account-models.js';
import { profileHandlers } from '../../../services/profile-page.js';

Page({
  ...profileHandlers('OWNER', 'loadForm'),
  data: {
    needsProfile: false, displayName: '', profileError: '',
    status: 'loading', errorMessage: '', serviceCards: [], districts: [], announcement: '',
    allPets: [], pets: [], addresses: [], serviceType: 'CAT_FEEDING', petIndex: 0, addressIndex: 0,
    startsAt: '', durationMinutes: 30, quote: null, quoteRows: [], pendingAttempt: null, busy: false,
  },
  async onLoad(this: any, query: { serviceType?: string }) {
    if (query.serviceType === 'DOG_WALKING') this.setData({ serviceType: 'DOG_WALKING' });
    await this.loadForm();
  },
  onUnload(this: any) { this.disposed = true; },
  async loadForm(this: any) {
    if (this.disposed || this.data.busy) return;
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
      this.setData({ ...view, serviceType, allPets: pets, pets: petsForService(pets, serviceType), addresses: addresses.filter(
        (address: { district: string }) => openNames.has(address.district),
      ), petIndex: 0, quote: null, quoteRows: [], pendingAttempt: null });
    } catch (error) { if (!this.disposed) this.setData({ ...presentCatalogFailure(), errorMessage: accountErrorMessage(error) }); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  chooseService(this: any, event: any) {
    const serviceType = event.currentTarget.dataset.value;
    this.setData({ serviceType, pets: petsForService(this.data.allPets, serviceType), petIndex: 0,
      quote: null, quoteRows: [], pendingAttempt: null });
  },
  choosePet(this: any, event: any) { this.setData({ petIndex: Number(event.detail.value), quote: null, quoteRows: [], pendingAttempt: null }); },
  chooseAddress(this: any, event: any) { this.setData({ addressIndex: Number(event.detail.value), quote: null, quoteRows: [], pendingAttempt: null }); },
  changeStartsAt(this: any, event: any) { this.setData({ startsAt: event.detail.value, quote: null, quoteRows: [], pendingAttempt: null }); },
  requestInput(this: any) {
    const pet = this.data.pets[this.data.petIndex];
    const address = this.data.addresses[this.data.addressIndex];
    if (!this.data.serviceType || !pet || !address || !this.data.startsAt) throw new Error('请完善宠物、地址和上门时间');
    return { serviceType: this.data.serviceType, petIds: [pet.id], addressId: address.id,
      startsAt: this.data.startsAt, durationMinutes: this.data.durationMinutes };
  },
  async refreshQuote(this: any) {
    if (this.disposed || this.data.busy || this.data.needsProfile || this.data.status !== 'ready') return;
    try {
      const quote = await getApp<any>().globalData.api.quote(this.requestInput());
      if (this.disposed) return;
      this.setData({ quote, quoteRows: presentQuoteBreakdown(quote) });
    } catch (error) { if (!this.disposed) wx.showToast({ title: error instanceof Error ? error.message : '报价失败', icon: 'none' }); }
  },
  async submit(this: any) {
    if (this.disposed || this.data.needsProfile || this.data.status !== 'ready' || !this.data.quote || this.data.busy) return;
    this.setData({ busy: true });
    try {
      const attempt = this.data.pendingAttempt ?? createOrderAttempt(
        { ...this.requestInput(), notes: '' }, () => `${Date.now()}-${Math.random()}`,
      );
      if (!this.data.pendingAttempt) this.setData({ pendingAttempt: attempt });
      const order = await getApp<any>().globalData.api.createOrder(attempt.input, attempt.idempotencyKey);
      if (this.disposed) return;
      this.setData({ pendingAttempt: null });
      wx.showToast({ title: '订单已提交，等待平台匹配', icon: 'none' });
      wx.navigateTo({ url: `/pages/owner/order-detail/index?id=${order.id}` });
    } catch (error) { if (!this.disposed) wx.showToast({ title: error instanceof Error ? error.message : '提交失败', icon: 'none' }); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
});
