import { presentQuoteBreakdown } from '../../../presenters/order-presenter.js';
const { api } = getApp<any>().globalData;
Page({
  data: { serviceType: 'CAT_FEEDING', petIds: [], addressId: '', startsAt: '', durationMinutes: 30, quoteRows: [], busy: false },
  async refreshQuote(this: any) {
    const quote = await api.quote({ serviceType: this.data.serviceType, petIds: this.data.petIds,
      addressId: this.data.addressId, startsAt: this.data.startsAt, durationMinutes: this.data.durationMinutes });
    this.setData({ quote, quoteRows: presentQuoteBreakdown(quote) });
  },
  async submit(this: any) {
    this.setData({ busy: true });
    try {
      const order = await api.createOrder({ serviceType: this.data.serviceType, petIds: this.data.petIds,
        addressId: this.data.addressId, startsAt: this.data.startsAt,
        durationMinutes: this.data.durationMinutes, notes: '' }, `${Date.now()}-${Math.random()}`);
      if (order.paymentToken) wx.requestPayment({ package: order.paymentToken });
    } finally { this.setData({ busy: false }); }
  },
});
