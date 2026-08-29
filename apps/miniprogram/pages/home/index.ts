import { presentCatalog, presentCatalogFailure } from '../../presenters/catalog-presenter.js';

Page({
  data: { status: 'loading', announcement: '', serviceCards: [], districts: [], bookingAvailable: false, errorMessage: '' },
  onLoad(this: any) { void this.loadCatalog(); },
  async loadCatalog(this: any) {
    this.setData({ status: 'loading', errorMessage: '' });
    try {
      const catalog = await getApp<any>().globalData.api.getCatalog();
      this.setData(presentCatalog(catalog));
    } catch { this.setData(presentCatalogFailure()); }
  },
  startOrder(this: any, event: any) {
    wx.navigateTo({ url: `/pages/owner/order-create/index?serviceType=${event.currentTarget.dataset.service}` });
  },
});
