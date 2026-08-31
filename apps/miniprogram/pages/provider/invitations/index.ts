import { accountErrorMessage } from '../../../services/account-models.js';
import { profileHandlers } from '../../../services/profile-page.js';

Page({
  ...profileHandlers('PROVIDER', 'reload'),
  data: { tasks: [], busy: false, error: '', needsProfile: false, displayName: '', profileError: '' },
  onLoad(this: any) { return this.reload(); },
  onUnload(this: any) { this.disposed = true; },
  async reload(this: any) {
    if (this.data.busy || this.disposed) return;
    this.setData({ busy: true, error: '', tasks: [] });
    const { api, access } = getApp<any>().globalData;
    try {
      const current = await access.load('PROVIDER');
      if (this.disposed) return;
      this.setData({ needsProfile: current.displayName === null });
      if (current.displayName === null) return;
      const records = await api.listProviderTasks();
      if (!Array.isArray(records)) throw new Error('INVALID_TASKS');
      const tasks = records.filter((item: any) => item && typeof item.id === 'string'
        && ['CAT_FEEDING', 'DOG_WALKING'].includes(item.serviceType)).map((item: any) => ({
        id: item.id, label: item.serviceType === 'CAT_FEEDING' ? '上门喂猫' : '上门遛狗',
        district: typeof item.district === 'string' ? item.district : '',
        startsAt: typeof item.startsAt === 'string' ? item.startsAt : '',
        invitationId: item.invitation?.status === 'PENDING' && typeof item.invitation.id === 'string'
          && new Date(item.invitation.expiresAt).getTime() > Date.now() ? item.invitation.id : '',
        expiresAt: item.invitation?.expiresAt ?? '',
        canOpen: ['PENDING_SERVICE', 'IN_SERVICE', 'PENDING_CONFIRMATION', 'COMPLETED', 'DISPUTED'].includes(item.status),
      }));
      if (!this.disposed) this.setData({ tasks });
    } catch (error) { if (!this.disposed) this.setData({ tasks: [], error: accountErrorMessage(error) }); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  async accept(this: any, event: any) {
    if (this.data.busy || this.disposed) return;
    const task = this.data.tasks.find((item: any) => item.invitationId === event.currentTarget.dataset.id
      && item.invitationId && new Date(item.expiresAt).getTime() > Date.now());
    if (!task) return;
    this.setData({ busy: true, error: '' });
    let failed = false;
    try { await getApp<any>().globalData.api.acceptInvitation(task.invitationId); }
    catch { failed = true; }
    finally {
      if (!this.disposed) {
        this.setData({ busy: false }); await this.reload();
        if (failed && !this.disposed && this.data.tasks.some((item: any) => item.invitationId === task.invitationId)) {
          this.setData({ error: '接单尚未确认，请稍后重试或联系平台。' });
        }
      }
    }
  },
  openTask(this: any, event: any) {
    const task = this.data.tasks.find((item: any) => item.id === event.currentTarget.dataset.id && item.canOpen);
    if (task && !this.data.busy) wx.navigateTo({ url: `/pages/provider/service/index?id=${encodeURIComponent(task.id)}` });
  },
});
