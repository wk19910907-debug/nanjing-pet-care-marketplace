import { presentCatalog, presentCatalogFailure } from '../../../presenters/catalog-presenter.js';
import { presentQuoteBreakdown } from '../../../presenters/order-presenter.js';

Page({
  data: {
    status: 'loading', errorMessage: '', serviceCards: [], districts: [], announcement: '',
    pets: [], addresses: [], serviceType: 'CAT_FEEDING', petIndex: 0, addressIndex: 0,
    startsAt: '', durationMinutes: 30, quote: null, quoteRows: [], busy: false,
  },
  async onLoad(this: any, query: { serviceType?: string }) {
    if (query.serviceType === 'DOG_WALKING') this.setData({ serviceType: 'DOG_WALKING' });
    await this.loadForm();
  },
  async loadForm(this: any) {
    this.setData({ status: 'loading', errorMessage: '' });
    const { api, login, session } = getApp<any>().globalData;
    try {
      if (!session.read()) await login();
      const [catalog, pets, addresses] = await Promise.all([api.getCatalog(), api.listPets(), api.listAddresses()]);
      const view = presentCatalog(catalog);
      const openNames = new Set<string>(view.districts.map((district) => district.name));
      const serviceType = view.serviceCards.some((service) => service.type === this.data.serviceType)
        ? this.data.serviceType : view.serviceCards[0]?.type ?? '';
      this.setData({ ...view, serviceType, pets, addresses: addresses.filter(
        (address: { district: string }) => openNames.has(address.district),
      ), quote: null, quoteRows: [] });
    } catch { this.setData(presentCatalogFailure()); }
  },
  chooseService(this: any, event: any) { this.setData({ serviceType: event.currentTarget.dataset.value, quote: null, quoteRows: [] }); },
  choosePet(this: any, event: any) { this.setData({ petIndex: Number(event.detail.value), quote: null, quoteRows: [] }); },
  chooseAddress(this: any, event: any) { this.setData({ addressIndex: Number(event.detail.value), quote: null, quoteRows: [] }); },
  changeStartsAt(this: any, event: any) { this.setData({ startsAt: event.detail.value, quote: null, quoteRows: [] }); },
  requestInput(this: any) {
    const pet = this.data.pets[this.data.petIndex];
    const address = this.data.addresses[this.data.addressIndex];
    if (!this.data.serviceType || !pet || !address || !this.data.startsAt) throw new Error('请完善宠物、地址和上门时间');
    return { serviceType: this.data.serviceType, petIds: [pet.id], addressId: address.id,
      startsAt: this.data.startsAt, durationMinutes: this.data.durationMinutes };
  },
  async refreshQuote(this: any) {
    try {
      const quote = await getApp<any>().globalData.api.quote(this.requestInput());
      this.setData({ quote, quoteRows: presentQuoteBreakdown(quote) });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '报价失败', icon: 'none' }); }
  },
  async submit(this: any) {
    if (!this.data.quote || this.data.busy) return;
    this.setData({ busy: true });
    try {
      const order = await getApp<any>().globalData.api.createOrder({ ...this.requestInput(), notes: '' }, `${Date.now()}-${Math.random()}`);
      wx.showToast({ title: '订单已提交，等待平台匹配', icon: 'none' });
      wx.navigateTo({ url: `/pages/owner/order-detail/index?id=${order.id}` });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '提交失败', icon: 'none' }); }
    finally { this.setData({ busy: false }); }
  },
});
