import { createProviderService, type ProviderService } from '../../../services/provider-service.js';

Page({
  data: { order: null, loaded: false, busy: false, error: '', evidenceCount: 0,
    canCheckIn: false, canUpload: false, canSubmit: false, checklist: {}, readiness: { ready: false, missing: [] } },
  async onLoad(this: any, query: { id?: string }) {
    const { api, chooseEvidence } = getApp<any>().globalData;
    this.flow = createProviderService({ api, chooseEvidence, orderId: query.id ?? '', onChange: (state) => this.setData(state) });
    await this.flow.load();
  },
  onUnload(this: { flow?: ProviderService }) { this.flow?.dispose(); },
  reload(this: { flow: ProviderService }) { return this.flow.load(); },
  checkIn(this: { flow: ProviderService }) { return this.flow.checkIn(); },
  upload(this: { flow: ProviderService }) { return this.flow.upload(); },
  submit(this: { flow: ProviderService }) { return this.flow.submit(); },
  beforeChange(this: { flow: ProviderService }, event: any) { this.flow.setBeforeConfirmed(event.detail.value.length > 0); },
  afterChange(this: { flow: ProviderService }, event: any) { this.flow.setAfterConfirmed(event.detail.value.length > 0); },
  checklistChange(this: { flow: ProviderService }, event: any) {
    for (const key of ['petCountConfirmed', 'foodRefilled', 'waterRefilled', 'litterCleaned', 'leashSecured']) {
      this.flow.setChecklist(key, event.detail.value.includes(key));
    }
  },
  walkChange(this: { flow: ProviderService }, event: any) { this.flow.setWalkMinutes(event.detail.value); },
  notesChange(this: { flow: ProviderService }, event: any) { this.flow.setNotes(event.detail.value); },
});
