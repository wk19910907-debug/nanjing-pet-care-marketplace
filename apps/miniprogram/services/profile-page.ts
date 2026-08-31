import { accountErrorMessage } from './account-models.js';

export function profileHandlers(role: 'OWNER' | 'PROVIDER', reload: 'reload' | 'loadForm') {
  return {
    changeDisplayName(this: any, event: { detail: { value: string } }) {
      if (!this.disposed && !this.data.busy) this.setData({ displayName: event.detail.value, profileError: '' });
    },
    async saveProfile(this: any) {
      if (this.disposed || this.data.busy || !this.data.needsProfile) return;
      const name = this.data.displayName.trim();
      if (!name || name.length > 30) { this.setData({ profileError: accountErrorMessage(new Error('DISPLAY_NAME_INVALID')) }); return; }
      this.setData({ busy: true, profileError: '' });
      let saved = false;
      try { await getApp<any>().globalData.access.save(role, name); saved = true; }
      catch (error) { if (!this.disposed) this.setData({ profileError: accountErrorMessage(error) }); }
      finally { if (!this.disposed) this.setData({ busy: false }); }
      if (saved && !this.disposed) await this[reload]();
    },
  };
}
