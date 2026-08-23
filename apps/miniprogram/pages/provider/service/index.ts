import { presentUploadFailure, reportReadiness } from '../../../presenters/provider-presenter.js';
const { api } = getApp<any>().globalData;
Page({ data: { orderId: '', serviceType: 'CAT_FEEDING', checklist: {}, evidenceCount: 0, readiness: { ready: false, missing: [] } },
  onLoad(this: any, q: { id?: string }) { this.setData({ orderId: q.id ?? '' }); },
  async checkIn(this: any) { await api.checkIn(this.data.orderId, { checkedInAt: new Date().toISOString(), beforeState: { petSafe: true } }); },
  updateReadiness(this: any) { this.setData({ readiness: reportReadiness(this.data.serviceType, this.data.checklist, this.data.evidenceCount) }); },
  async upload(this: any) { try { /* chooseMedia then issueUpload/attachEvidence in the platform adapter */ this.setData({ evidenceCount: this.data.evidenceCount + 1 }); this.updateReadiness(); }
    catch (error) { const message = presentUploadFailure(error); wx.showToast({ title: message.title }); } },
  async submit(this: any) { if (!this.data.readiness.ready) return; await api.submitReport(this.data.orderId, { checklist: this.data.checklist, afterState: { petSafe: true }, notes: '', checkedOutAt: new Date().toISOString() }); },
});
