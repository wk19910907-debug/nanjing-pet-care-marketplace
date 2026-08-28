import { expect, test } from '@playwright/test';

test('direct role entry keeps nickname onboarding private on mobile', async ({ page }) => {
  let session: null | {
    userId: string;
    role: 'ADMIN';
    displayName: string | null;
    expiresAt: string;
  } = null;
  let localSessionCalls = 0;
  let releaseLocalSession!: () => void;
  const localSessionPending = new Promise<void>((resolve) => { releaseLocalSession = resolve; });
  await page.route('**/api/v1/pilot/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/session') && request.method() === 'GET') {
      await route.fulfill(session
        ? { status: 200, json: session }
        : { status: 401, json: { code: 'UNAUTHENTICATED' } });
      return;
    }
    if (path.endsWith('/local-sessions') && request.method() === 'POST') {
      localSessionCalls += 1;
      expect(request.postDataJSON()).toEqual({ role: 'ADMIN' });
      await localSessionPending;
      session = {
        userId: 'admin-1', role: 'ADMIN', displayName: null,
        expiresAt: '2026-09-03T10:00:00.000Z',
      };
      await route.fulfill({ status: 201, json: { expiresAt: session.expiresAt } });
      return;
    }
    if (path.endsWith('/me') && request.method() === 'PATCH' && session) {
      const body = request.postDataJSON() as { displayName: string };
      session.displayName = body.displayName;
      await route.fulfill({ status: 200, json: {
        id: session.userId, role: session.role, displayName: session.displayName,
      } });
      return;
    }
    if (path.endsWith('/session') && request.method() === 'DELETE') {
      session = null;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
  });

  await page.goto('/');
  await expect(page.getByRole('button', { name: '以宠主身份进入' })).toBeVisible();
  await expect(page.getByRole('button', { name: '以服务人员身份进入' })).toBeVisible();
  await expect(page.getByRole('button', { name: '以平台管理员身份进入' })).toBeVisible();
  await expect(page.getByText(
    '仅限本机试运营；仅记录线下费用，不收集联系方式',
    { exact: true },
  )).toBeVisible();
  await expect(page.getByRole('textbox', { name: '邀请码', exact: true })).toHaveCount(0);
  await expect(page.getByText('邀请码管理')).toHaveCount(0);

  await page.getByRole('button', { name: '以平台管理员身份进入' }).dblclick();
  await expect.poll(() => localSessionCalls).toBe(1);
  await expect(page.getByRole('button', { name: '正在以平台管理员身份进入…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '以宠主身份进入' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '以服务人员身份进入' })).toBeDisabled();
  releaseLocalSession();
  await page.getByRole('textbox', { name: '展示昵称', exact: true }).fill('试点运营');
  await page.getByRole('button', { name: '保存昵称' }).click();
  await expect(page.getByRole('heading', { name: '平台工作区' })).toBeVisible();
  await expect(page.getByText('邀请码管理')).toHaveCount(0);
  expect(localSessionCalls).toBe(1);

  const privacy = await page.evaluate(() => ({
    stored: localStorage.length,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    controls: [...document.querySelectorAll('button, input, select')]
      .filter((node) => (node as HTMLElement).offsetParent !== null)
      .map((node) => ({ tag: node.tagName, height: node.getBoundingClientRect().height })),
    text: document.body.textContent ?? '',
  }));
  expect(privacy.stored).toBe(0);
  expect(privacy.overflow).toBe(false);
  expect(privacy.controls.every(({ height }) => height >= 44)).toBe(true);
  expect(privacy.text).not.toMatch(/邀请码|手机号|微信号|邮箱|身份证|证件照片|银行卡|支付码|门锁密码/);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('button', { name: '以平台管理员身份进入' })).toBeVisible();
});
