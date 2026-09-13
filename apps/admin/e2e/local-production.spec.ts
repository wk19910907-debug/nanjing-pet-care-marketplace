import { createHash, randomBytes } from 'node:crypto';
import { expect, type Browser, type Page } from '@playwright/test';

// The safe runner imports this executable acceptance specification directly.
// No Playwright reporter, trace, screenshot, video or credential artifact is used.
const origin = 'https://petcare.localhost';
const storageOrigin = 'https://storage.petcare.localhost';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const checksum = createHash('sha256').update(png).digest('hex');
const localInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
type Check = (name: string, operation: () => Promise<number>) => Promise<number>;

async function login(page: Page, username: string, password: string, workspace: string, changedPassword = password) {
  await page.goto(origin);
  await page.getByRole('button', { name: '员工登录' }).click();
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const temporary = page.getByRole('heading', { name: '请先修改临时密码' });
  await expect(temporary.or(page.getByRole('heading', { name: workspace }))).toBeVisible();
  if (await temporary.isVisible()) {
    // Retain the externally protected administrator password for repeatable runs
    // and user acceptance. Provider passwords are fresh, in-memory values.
    await page.getByLabel('新密码', { exact: true }).fill(changedPassword);
    await page.getByLabel('确认新密码', { exact: true }).fill(changedPassword);
    const passwordResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/staff/password');
    await page.getByRole('button', { name: '保存新密码' }).click();
    expect((await passwordResponse).status()).toBe(200);
  }
  await expect(page.getByRole('heading', { name: workspace })).toBeVisible();
}

export async function verifyBrowserWorkflow({ browser, check, adminPassword, rememberSecret }: {
  browser: Browser; check: Check; adminPassword: string; rememberSecret: (value: string) => void;
}) {
  const createPage = async () => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    context.setDefaultTimeout(15_000);
    context.setDefaultNavigationTimeout(20_000);
    const page = await context.newPage();
    // Observe, never log: used to prove the application log does not leak sessions.
    page.on('request', (request) => {
      const cookie = request.headers().cookie;
      if (cookie) for (const item of cookie.split(';')) rememberSecret(item.slice(item.indexOf('=') + 1).trim());
    });
    return page;
  };
  const owner = await createPage();
  const admin = await createPage();
  const provider = await createPage();
  const runId = randomBytes(6).toString('hex');
  const providerUsername = `verify.${runId}`;
  const providerName = `验收${runId}`;
  let orderId = '';
  let readUrl = '';
  let uploadUrl = '';
  let uploadHeaders: Record<string, string> = {};

  await check('owner-booking', async () => {
    await owner.goto(origin);
    await owner.getByRole('button', { name: '立即预约' }).click();
    await expect(owner.getByRole('heading', { name: '服务与时间' })).toBeVisible();
    await owner.getByLabel('服务时间').fill(localInput(new Date(Date.now() + 25 * 60_000)));
    await owner.getByRole('button', { name: '下一步：填写上门信息' }).click();
    await owner.getByLabel('宠物昵称').fill('团子');
    await owner.getByLabel('服务区').selectOption('建邺区');
    await owner.getByLabel('详细服务地址').fill('南京市建邺区中山南路 188 号');
    await owner.getByRole('button', { name: '获取服务报价' }).click();
    await expect(owner.getByText('服务器固定报价')).toBeVisible();
    const pending = owner.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/orders' && response.request().method() === 'POST');
    await owner.getByRole('button', { name: '确认提交订单' }).click();
    const response = await pending;
    expect(response.status()).toBe(201);
    const order = await response.json() as { id: string; status: string };
    expect(order.status).toBe('PENDING_PAYMENT');
    orderId = order.id;
    expect(Boolean(orderId)).toBe(true);
    await expect(owner.getByRole('heading', { name: '保存你的恢复凭据' })).toBeVisible();
    await owner.getByRole('button', { name: '我已保存', exact: true }).click();
    return response.status();
  });
  await check('administrator-login', async () => { await login(admin, 'admin', adminPassword, '平台工作区'); return 200; });
  await check('provider-onboarding', async () => {
    await admin.getByLabel('员工用户名').fill(providerUsername);
    await admin.getByLabel('员工展示名称').fill(providerName);
    await admin.getByRole('button', { name: '创建服务人员账号' }).click();
    const password = await admin.locator('.pilot-one-time-secret code').textContent();
    expect(Boolean(password)).toBe(true);
    rememberSecret(password!);
    const changed = randomBytes(24).toString('base64url');
    rememberSecret(changed);
    await admin.getByRole('button', { name: '我已安全记录，关闭' }).click();
    await login(provider, providerUsername, password!, '服务人员工作区', changed);
    await provider.getByRole('checkbox', { name: '上门喂猫' }).check();
    await provider.getByLabel('申请服务区').selectOption('建邺区');
    await provider.getByLabel('喂猫经验（月）').fill('24');
    await provider.getByRole('button', { name: '提交服务申请' }).click();
    await provider.getByLabel('开始时间').fill(localInput(new Date(Date.now() - 60 * 60_000)));
    await provider.getByLabel('结束时间').fill(localInput(new Date(Date.now() + 5 * 60 * 60_000)));
    await provider.getByRole('button', { name: '保存可服务时间' }).click();
    await admin.getByRole('button', { name: '刷新运营数据' }).click();
    await admin.getByRole('button', { name: `审核${providerName}` }).click();
    await admin.getByRole('button', { name: '确认批准' }).click();
    return 200;
  });
  await check('dispatch', async () => {
    await admin.getByRole('button', { name: `核对订单 ${orderId} 费用` }).click();
    await admin.getByRole('button', { name: '确认记录费用已线下核对' }).click();
    await expect.poll(async () => {
      const orders = await admin.evaluate(async () => (await fetch('/api/v1/pilot/orders')).json()) as { id: string; status: string }[];
      return orders.find((order) => order.id === orderId)?.status;
    }).toBe('PENDING_DISPATCH');
    await admin.getByRole('button', { name: '刷新运营数据' }).click();
    await admin.getByRole('button', { name: `派单订单 ${orderId}` }).click();
    const pending = admin.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/dispatch/${orderId}/start` && response.request().method() === 'POST');
    await admin.getByRole('button', { name: '确认启动派单' }).click();
    expect((await pending).status()).toBe(200);
    await provider.getByRole('button', { name: '刷新我的任务' }).click();
    await provider.getByRole('button', { name: `接受邀请 ${orderId}` }).click();
    const task = provider.getByText(`任务 ${orderId}`).locator('..');
    await task.getByRole('checkbox', { name: '我已到达并确认宠物当前状态可开始服务' }).check();
    await task.getByRole('button', { name: `订单 ${orderId} 签到` }).click();
    return 200;
  });
  await check('signed-put', async () => {
    const task = provider.getByText(`任务 ${orderId}`).locator('..');
    await task.getByLabel('履约图片').setInputFiles({ name: 'acceptance.png', mimeType: 'image/png', buffer: png });
    const pending = provider.waitForResponse((response) => new URL(response.url()).origin === storageOrigin && response.request().method() === 'PUT');
    await task.getByRole('button', { name: '上传履约图片' }).click();
    const response = await pending;
    expect(response.status()).toBe(200);
    uploadUrl = response.url();
    const headers = response.request().headers();
    uploadHeaders = { 'content-type': headers['content-type']!, 'x-amz-checksum-sha256': headers['x-amz-checksum-sha256']! };
    expect(uploadHeaders['x-amz-checksum-sha256']).toBe(Buffer.from(checksum, 'hex').toString('base64'));
    const signed = new URL(uploadUrl);
    expect(Number(signed.searchParams.get('X-Amz-Expires'))).toBeGreaterThan(0);
    expect(Number(signed.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(600);
    rememberSecret(uploadUrl);
    await expect(task.getByText('履约图片已附加。')).toBeVisible();
    return response.status();
  });
  await check('evidence-report', async () => {
    const task = provider.getByText(`任务 ${orderId}`).locator('..');
    for (const label of ['宠物数量已确认', '猫粮已补充', '饮水已补充', '猫砂已清理']) await task.getByRole('checkbox', { name: label }).check();
    await task.getByLabel('服务报告备注').fill('本地生产基础设施验收。');
    await task.getByRole('checkbox', { name: '我已确认服务后的宠物状态并如实填写报告' }).check();
    await task.getByRole('button', { name: '提交服务报告' }).click();
    await expect(task.getByText(/服务报告已于/)).toBeVisible();
    return 200;
  });
  const readEvidence = async () => {
    await owner.getByRole('button', { name: '刷新', exact: true }).click();
    const pending = owner.waitForResponse((response) => new URL(response.url()).origin === storageOrigin && response.request().method() === 'GET');
    await owner.getByRole('button', { name: '查看履约证据 1' }).click();
    const response = await pending;
    expect(response.status()).toBe(200);
    expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(checksum);
    readUrl = response.url();
    rememberSecret(readUrl);
    expect(new URL(readUrl).searchParams.has('X-Amz-Signature')).toBe(true);
    return response.status();
  };
  await check('signed-get', readEvidence);
  await check('owner-completion', async () => {
    await expect(owner.getByRole('button', { name: '确认服务完成' })).toBeEnabled();
    await owner.getByRole('button', { name: '确认服务完成' }).click();
    await expect(owner.getByText('服务已完成')).toBeVisible();
    return 200;
  });
  return {
    orderId, checksum, readUrl, uploadUrl, uploadHeaders,
    verifyPersistence: async () => {
      await check('persisted-admin', async () => {
        const freshAdmin = await createPage();
        await login(freshAdmin, 'admin', adminPassword, '平台工作区');
        return 200;
      });
      await check('persisted-order', async () => {
        await owner.reload();
        const order = owner.locator('.pilot-owner-order').filter({ has: owner.getByRole('button', { name: `订单沟通 ${orderId}` }) });
        await expect(order).toHaveCount(1);
        await expect(order.locator('.pilot-status')).toHaveText('服务已完成');
        return 200;
      });
      await check('persisted-evidence', readEvidence);
    },
  };
}
