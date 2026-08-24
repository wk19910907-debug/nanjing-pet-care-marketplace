import {
  assignMiniOrder, confirmMiniOrder, createMiniOrder, initialMiniState, loadMiniState, saveMiniState,
  startMiniService, submitMiniReport, type MiniServiceType, type MiniState,
} from '../../demo/workflow.js';

const storage = { get: (key: string) => wx.getStorageSync(key), set: (key: string, value: string) => wx.setStorageSync(key, value) };
const labels = { WAITING_MATCH: '待平台匹配', WAITING_SERVICE: '已匹配，等待服务', IN_SERVICE: '服务进行中', WAITING_CONFIRMATION: '等待宠主确认', COMPLETED: '服务已完成' };

Page({
  data: {
    role: 'OWNER', state: initialMiniState(), order: null, statusLabel: '', priceText: '',
    draft: { serviceType: 'CAT_FEEDING', petName: '', district: '建邺区', address: '', scheduledAt: '2026-08-24 19:00' },
    report: { fed: false, cleaned: false, notes: '' },
  },
  onLoad(this: any) { this.refresh(loadMiniState(storage)); },
  refresh(this: any, state: MiniState) {
    this.setData({ state, order: state.order, statusLabel: state.order ? labels[state.order.status] : '', priceText: state.order ? `¥${(state.order.priceFen / 100).toFixed(2)}` : '' });
  },
  commit(this: any, next: MiniState, message: string) { saveMiniState(storage, next); this.refresh(next); wx.showToast({ title: message, icon: 'none' }); },
  run(this: any, action: () => MiniState, message: string) { try { this.commit(action(), message); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' }); } },
  setRole(this: any, event: any) { this.setData({ role: event.currentTarget.dataset.role }); },
  chooseService(this: any, event: any) { this.setData({ 'draft.serviceType': event.currentTarget.dataset.value as MiniServiceType }); },
  changeDraft(this: any, event: any) { this.setData({ [`draft.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  changeReport(this: any, event: any) { this.setData({ [`report.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  toggleReport(this: any, event: any) { this.setData({ [`report.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  submitOrder(this: any) { this.run(() => createMiniOrder(this.data.state, this.data.draft), '订单已提交'); },
  assign(this: any) { this.run(() => assignMiniOrder(this.data.state, this.data.order.id), '已匹配王小宁'); },
  start(this: any) { this.run(() => startMiniService(this.data.state, this.data.order.id), '服务已开始'); },
  submitReport(this: any) { this.run(() => submitMiniReport(this.data.state, this.data.order.id, this.data.report), '报告已提交'); },
  confirm(this: any) { this.run(() => confirmMiniOrder(this.data.state, this.data.order.id), '服务已完成'); },
  reset(this: any) { this.commit(initialMiniState(), '体验数据已恢复'); this.setData({ role: 'OWNER', report: { fed: false, cleaned: false, notes: '' } }); },
});
