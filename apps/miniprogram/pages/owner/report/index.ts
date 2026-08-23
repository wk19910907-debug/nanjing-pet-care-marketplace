const { api } = getApp<any>().globalData;
Page({ data: { orderId: '', reason: '' }, onLoad(this: any, q: { id?: string }) { this.setData({ orderId: q.id ?? '' }); },
  onReason(this: any, event: any) { this.setData({ reason: event.detail.value }); },
  async dispute(this: any) { await api.openDispute(this.data.orderId, this.data.reason); wx.showToast({ title: '已提交平台处理' }); } });
