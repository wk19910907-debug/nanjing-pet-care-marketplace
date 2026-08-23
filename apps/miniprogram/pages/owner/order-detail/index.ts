import { ownerActions, presentOrderTimeline } from '../../../presenters/order-presenter.js';
const { api } = getApp<any>().globalData;
Page({
  data: { orderId: '', order: null, timeline: [], actions: {} },
  async onLoad(this: any, query: { id?: string }) { this.setData({ orderId: query.id ?? '' }); await this.reload(); },
  async reload(this: any) { const order = await api.getOrder(this.data.orderId); this.setData({ order,
    timeline: presentOrderTimeline(order.status), actions: ownerActions(order.status) }); },
  async confirm(this: any) { await api.confirmOrder(this.data.orderId); await this.reload(); },
  async cancel(this: any) { await api.cancelOrder(this.data.orderId, '宠主主动取消'); await this.reload(); },
});
