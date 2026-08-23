import { invitationCountdown } from '../../../presenters/provider-presenter.js';
const { api } = getApp<any>().globalData;
Page({ data: { invitations: [] }, tick(this: any) { this.setData({ invitations: this.data.invitations.map((item: any) => ({ ...item, countdown: invitationCountdown(item.expiresAt, new Date()) })) }); },
  async accept(this: any, event: any) { await api.acceptInvitation(event.currentTarget.dataset.id); wx.showToast({ title: '接单成功' }); } });
