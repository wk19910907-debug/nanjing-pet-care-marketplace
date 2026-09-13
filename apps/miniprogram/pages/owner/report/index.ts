const { api } = getApp<any>().globalData;

Page({
  data: { orderId: '', report: null, photos: [], loaded: false, loading: false, error: '',
    reason: '', disputeBusy: false, disputeSubmitted: false, disputeError: '' },
  async onLoad(this: any, query: { id?: string }) {
    this.disposed = false;
    this.setData({ orderId: query.id ?? '' });
    await this.reload();
  },
  onUnload(this: any) { this.disposed = true; },
  async reload(this: any) {
    if (this.disposed || this.data.loading) return;
    if (!this.data.orderId) { this.setData({ error: '订单编号缺失，请从我的订单重新进入。', loaded: false }); return; }
    this.setData({ loading: true, error: '' });
    try {
      const report = await api.getOwnerReport(this.data.orderId);
      if (this.disposed) return;
      this.setData({ report, photos: report.evidence.map(({ id }: { id: string }, index: number) => ({
        id, label: `现场照片 ${index + 1}`, url: '', loading: false, error: '',
      })), loaded: true });
    } catch {
      if (!this.disposed) this.setData({ error: '服务报告读取失败，请检查网络或登录状态后重试。', loaded: false });
    } finally { if (!this.disposed) this.setData({ loading: false }); }
  },
  async viewEvidence(this: any, event: any) {
    const id = event.currentTarget.dataset.id;
    const photo = this.data.photos.find((item: any) => item.id === id);
    if (!photo || photo.loading || this.disposed) return;
    this.setData({ photos: this.data.photos.map((item: any) => item.id === id ? { ...item, loading: true, error: '', url: '' } : item) });
    try {
      const url = await api.getEvidenceReadUrl(id);
      if (this.disposed) return;
      this.setData({ photos: this.data.photos.map((item: any) => item.id === id ? { ...item, url, loading: false } : item) });
    } catch {
      if (!this.disposed) this.setData({ photos: this.data.photos.map((item: any) => item.id === id
        ? { ...item, url: '', loading: false, error: '照片读取失败，请重试。' } : item) });
    }
  },
  evidenceError(this: any, event: any) {
    if (this.disposed) return;
    const id = event.currentTarget.dataset.id;
    this.setData({ photos: this.data.photos.map((item: any) => item.id === id
      ? { ...item, url: '', loading: false, error: '照片已过期或加载失败，请重新读取。' } : item) });
  },
  onReason(this: any, event: any) {
    if (!this.data.disputeBusy && !this.data.disputeSubmitted) this.setData({ reason: event.detail.value, disputeError: '' });
  },
  async dispute(this: any) {
    if (this.disposed || this.data.disputeBusy || this.data.disputeSubmitted || !this.data.report?.reportReady) return;
    const reason = this.data.reason.trim();
    if (!reason || reason.length > 1000) { this.setData({ disputeError: '请填写 1–1000 字的问题说明。' }); return; }
    this.setData({ disputeBusy: true, disputeError: '' });
    try {
      await api.openDispute(this.data.orderId, reason);
      if (this.disposed) return;
      this.setData({ disputeSubmitted: true });
      wx.showToast({ title: '已提交平台处理' });
    } catch {
      if (!this.disposed) this.setData({ disputeError: '提交结果未确认，请先返回订单页查看状态，再决定是否重试。' });
    } finally { if (!this.disposed) this.setData({ disputeBusy: false }); }
  },
});
