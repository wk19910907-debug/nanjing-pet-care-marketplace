import { expect, test } from '@playwright/test';

test('invitation login, nickname, admin invite, refresh, and logout stay private on mobile', async ({ page }) => {
  let session: null | {
    userId: string;
    role: 'ADMIN';
    displayName: string | null;
    expiresAt: string;
  } = null;
  const invitations = [{
    id: 'invite-existing', role: 'OWNER', expiresAt: '2026-08-28T10:00:00.000Z',
    consumedAt: null, createdAt: '2026-08-27T10:00:00.000Z',
  }];
  await page.route('**/api/v1/pilot/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/session') && request.method() === 'GET') {
      await route.fulfill(session
        ? { status: 200, json: session }
        : { status: 401, json: { code: 'UNAUTHENTICATED' } });
      return;
    }
    if (path.endsWith('/sessions') && request.method() === 'POST') {
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
    if (path.endsWith('/invites') && request.method() === 'GET') {
      await route.fulfill({ status: 200, json: invitations });
      return;
    }
    if (path.endsWith('/invites') && request.method() === 'POST') {
      await route.fulfill({ status: 201, json: {
        id: 'invite-new', role: 'PROVIDER', code: 'provider-code-once',
        expiresAt: '2026-08-28T11:00:00.000Z', createdAt: '2026-08-27T11:00:00.000Z',
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
  await page.getByRole('textbox', { name: '邀请码', exact: true }).fill('controlled-admin-code');
  await page.getByRole('button', { name: '进入试运营' }).click();
  await page.getByRole('textbox', { name: '展示昵称', exact: true }).fill('试点运营');
  await page.getByRole('button', { name: '保存昵称' }).click();
  await expect(page.getByRole('heading', { name: '邀请码管理' })).toBeVisible();
  await page.getByRole('combobox', { name: '邀请角色', exact: true }).selectOption('PROVIDER');
  await page.getByRole('button', { name: '创建一次性邀请码' }).click();
  await expect(page.getByText('provider-code-once')).toBeVisible();
  await page.getByRole('button', { name: '刷新邀请记录' }).click();
  await expect(page.getByText('provider-code-once')).toHaveCount(0);

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
  expect(privacy.text).not.toMatch(/手机号|微信号|邮箱|身份证|证件照片|银行卡|支付码|门锁密码/);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '邀请码登录' })).toBeVisible();
});
