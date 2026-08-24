import { describe, expect, it } from 'vitest';
import {
  invitationCountdown,
  presentUploadFailure,
  reportReadiness,
} from '../presenters/provider-presenter.js';

describe('provider journey presenters', () => {
  it('counts invitations down in whole seconds and closes at zero', () => {
    const now = new Date('2026-08-23T10:00:00.500Z');
    expect(invitationCountdown('2026-08-23T10:00:05.100Z', now)).toEqual({ seconds: 5, expired: false });
    expect(invitationCountdown('2026-08-23T10:00:00.000Z', now)).toEqual({ seconds: 0, expired: true });
  });

  it('blocks cat and dog reports until mandatory checklist and evidence are complete', () => {
    expect(reportReadiness('CAT_FEEDING', {
      petCountConfirmed: true, foodRefilled: true, waterRefilled: true, litterCleaned: false,
    }, 1)).toEqual({ ready: false, missing: ['清理猫砂'] });
    expect(reportReadiness('DOG_WALKING', { leashSecured: true, walkDurationMinutes: 30 }, 1))
      .toEqual({ ready: true, missing: [] });
    expect(reportReadiness('DOG_WALKING', { leashSecured: true, walkDurationMinutes: 30 }, 0))
      .toEqual({ ready: false, missing: ['至少上传一项服务证据'] });
  });

  it('turns upload failures into actionable retry copy without leaking storage details', () => {
    expect(presentUploadFailure(new Error('S3 signature mismatch'))).toEqual({
      title: '上传失败', message: '请检查网络后重试，原文件已保留。', canRetry: true,
    });
  });
});
