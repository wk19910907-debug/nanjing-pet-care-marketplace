import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.PILOT_ACCEPTANCE_BASE_URL;
const controlUrl = process.env.PILOT_ACCEPTANCE_CONTROL_URL;
const credentialsUrl = process.env.PILOT_ACCEPTANCE_CREDENTIALS_URL;

if (!baseUrl || !controlUrl || !credentialsUrl) {
  throw new Error('Live production acceptance requires the private runner control endpoints.');
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const password = () => randomBytes(18).toString('base64url');
const localInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

async function api(page: Page, path: string, init: { method?: string; body?: unknown } = {}) {
  return page.evaluate(async ({ path: requestPath, init: requestInit }) => {
    const response = await fetch(requestPath, { method: requestInit.method ?? 'GET', credentials: 'same-origin', ...(requestInit.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestInit.body) }) });
    const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { path, init });
}

async function staffLogin(page: Page, username: string, temporaryPassword: string, workspace: string) {
  await page.goto(baseUrl!); await page.getByRole('button', { name: '员工登录' }).click();
  await page.getByLabel('用户名').fill(username); await page.getByLabel('密码').fill(temporaryPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const changed = password();
  await expect(page.getByRole('heading', { name: '请先修改临时密码' })).toBeVisible();
  await page.getByLabel('新密码', { exact: true }).fill(changed); await page.getByLabel('确认新密码', { exact: true }).fill(changed);
  await page.getByRole('button', { name: '保存新密码' }).click();
  await expect(page.getByRole('heading', { name: workspace })).toBeVisible();
}

async function submitBooking(page: Page, type: 'CAT_FEEDING' | 'DOG_WALKING', startsAt: Date, alreadyOpen = false) {
  if (!alreadyOpen) await page.getByRole('button', { name: type === 'CAT_FEEDING' ? '预约上门喂猫' : '预约上门遛狗' }).click();
  await expect(page.getByRole('heading', { name: '服务与时间' })).toBeVisible();
  if (type === 'DOG_WALKING') await page.locator('input[name="booking-service"]').nth(1).check();
  await page.getByLabel('服务时间').fill(localInput(startsAt));
  await page.getByRole('button', { name: '下一步：填写上门信息' }).click();
  const petName = page.getByLabel('宠物昵称');
  if (await petName.isVisible()) await petName.fill(type === 'CAT_FEEDING' ? '团子' : '旺财');
  else await page.getByLabel('选择已有宠物').selectOption({ index: 1 });
  const district = page.getByLabel('服务区');
  if (await district.isVisible()) {
    await district.selectOption('建邺区');
    await page.getByLabel('详细服务地址').fill(type === 'CAT_FEEDING' ? '南京市建邺区中山南路 188 号' : '南京市建邺区江东中路 99 号');
  } else {
    await page.getByLabel('选择已有地址').selectOption({ index: 1 });
  }
  await page.getByRole('button', { name: '获取服务报价' }).click(); await expect(page.getByText('服务器固定报价')).toBeVisible();
  const response = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === '/api/v1/orders' && candidate.request().method() === 'POST');
  await page.getByRole('button', { name: '确认提交订单' }).click();
  const orderResponse = await response;
  expect(orderResponse.request().postDataJSON()).toMatchObject({ serviceType: type });
  const created = await orderResponse.json() as { id: string; status: string };
  expect(created).toMatchObject({ status: 'PENDING_PAYMENT' }); return created.id;
}

test('production web closes the guest, recovery, staff and order loop against PostgreSQL', async ({ browser }) => {
  test.setTimeout(300_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext(), browser.newContext(), browser.newContext()]);
  const [ownerContext, recoveredContext, adminContext, providerContext, attackerContext] = contexts as [typeof contexts[number], typeof contexts[number], typeof contexts[number], typeof contexts[number], typeof contexts[number]];
  try {
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const [ownerPage, recoveredPage, adminPage, providerPage, attackerPage] = pages as [Page, Page, Page, Page, Page];
    await ownerContext.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl! });
    await ownerPage.setViewportSize({ width: 1280, height: 800 });
    await ownerPage.goto(baseUrl!);
    await expect(ownerPage.getByRole('button', { name: '立即预约' })).toBeVisible({ timeout: 5_000 });
    await ownerPage.getByRole('button', { name: '立即预约' }).click();
    await expect(ownerPage.getByRole('heading', { name: '保存你的恢复凭据' })).toBeVisible();
    await ownerPage.getByRole('button', { name: '下载文本文件' }).click();
    await ownerPage.getByRole('button', { name: '复制恢复链接' }).click();
    const rotatedRecovery = await api(ownerPage, '/api/v1/public/owner-recovery-credentials/rotate', { method: 'POST' });
    expect(rotatedRecovery.status).toBe(200);
    const recoveryToken = (rotatedRecovery.body as { token?: unknown }).token;
    expect(typeof recoveryToken).toBe('string');
    await ownerPage.getByRole('button', { name: '我已保存', exact: true }).click();
    const start = new Date(Date.now() + 25 * 60_000);
    const catOrderId = await submitBooking(ownerPage, 'CAT_FEEDING', start, true);
    const dogOrderId = await submitBooking(ownerPage, 'DOG_WALKING', new Date(start.getTime() + 90 * 60_000));
    await recoveredPage.goto(`${baseUrl}/#/orders/access/${recoveryToken}`);
    await expect(recoveredPage.getByRole('heading', { name: '我的订单' })).toBeVisible(); await expect(recoveredPage.getByText(catOrderId)).toBeVisible();
    const credentials = await (await fetch(credentialsUrl!)).json() as { adminUsername: string; adminTemporaryPassword: string };
    await staffLogin(adminPage, credentials.adminUsername, credentials.adminTemporaryPassword, '平台工作区');
    await adminPage.getByLabel('员工用户名').fill('nj.provider'); await adminPage.getByLabel('员工展示名称').fill('南京小周');
    await adminPage.getByRole('button', { name: '创建服务人员账号' }).click();
    const providerTemporaryPassword = await adminPage.locator('.pilot-one-time-secret code').textContent(); expect(providerTemporaryPassword).toBeTruthy();
    await adminPage.getByRole('button', { name: '我已安全记录，关闭' }).click();
    await staffLogin(providerPage, 'nj.provider', providerTemporaryPassword!, '服务人员工作区');
    await providerPage.getByRole('checkbox', { name: '上门喂猫' }).check(); await providerPage.getByLabel('申请服务区').selectOption('建邺区');
    await providerPage.getByLabel('喂猫经验（月）').fill('24'); await providerPage.getByRole('button', { name: '提交服务申请' }).click();
    await providerPage.getByLabel('开始时间').fill(localInput(new Date(Date.now() - 60 * 60_000))); await providerPage.getByLabel('结束时间').fill(localInput(new Date(Date.now() + 5 * 60 * 60_000)));
    await providerPage.getByRole('button', { name: '保存可服务时间' }).click();
    await adminPage.getByRole('button', { name: '刷新运营数据' }).click(); await adminPage.getByRole('button', { name: '审核南京小周' }).click(); await adminPage.getByRole('button', { name: '确认批准' }).click();
    await recoveredPage.getByRole('button', { name: `订单沟通 ${catOrderId}` }).click(); await recoveredPage.getByLabel('订单沟通内容').fill('请在到达前留言。'); await recoveredPage.getByRole('button', { name: '发送消息' }).click();
    await adminPage.getByRole('button', { name: '刷新运营数据' }).click(); await adminPage.getByRole('button', { name: `订单沟通 ${catOrderId}` }).click(); await expect(adminPage.getByText('请在到达前留言。')).toBeVisible();
    await adminPage.getByLabel('订单沟通内容').fill('已收到，会提前联系。'); await adminPage.getByRole('button', { name: '发送消息' }).click(); await recoveredPage.getByRole('button', { name: '刷新沟通记录' }).click(); await expect(recoveredPage.getByText('已收到，会提前联系。')).toBeVisible();
    await attackerPage.setViewportSize({ width: 1280, height: 800 }); await attackerPage.goto(baseUrl!); await attackerPage.getByRole('button', { name: '立即预约' }).click(); await attackerPage.getByRole('button', { name: '我已保存', exact: true }).click();
    expect((await attackerContext.request.get(`${baseUrl}/api/v1/pilot/orders/${catOrderId}/messages`)).status()).toBe(403);
    await adminPage.getByRole('button', { name: `核对订单 ${catOrderId} 费用` }).click(); await adminPage.getByRole('button', { name: '确认记录费用已线下核对' }).click();
    await expect.poll(async () => (await api(adminPage, '/api/v1/pilot/orders')).body as Array<{ id: string; status: string }>).toContainEqual(expect.objectContaining({ id: catOrderId, status: 'PENDING_DISPATCH' }));
    await adminPage.getByRole('button', { name: '刷新运营数据' }).click(); await adminPage.getByRole('button', { name: `派单订单 ${catOrderId}` }).click();
    const dispatchResponse = adminPage.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/dispatch/${catOrderId}/start` && candidate.request().method() === 'POST');
    await adminPage.getByRole('button', { name: '确认启动派单' }).click(); expect((await dispatchResponse).status()).toBe(200);
    const providerRefresh = providerPage.waitForResponse((candidate) => new URL(candidate.url()).pathname === '/api/v1/pilot/orders' && candidate.request().method() === 'GET');
    await providerPage.getByRole('button', { name: '刷新我的任务' }).click(); expect((await providerRefresh).status()).toBe(200);
    await providerPage.getByRole('button', { name: `接受邀请 ${catOrderId}` }).click();
    const task = providerPage.getByText(`任务 ${catOrderId}`).locator('..'); await task.getByRole('checkbox', { name: '我已到达并确认宠物当前状态可开始服务' }).check(); await task.getByRole('button', { name: `订单 ${catOrderId} 签到` }).click();
    await task.getByLabel('履约图片').setInputFiles({ name: 'acceptance.png', mimeType: 'image/png', buffer: png }); await task.getByRole('button', { name: '上传履约图片' }).click();
    for (const label of ['宠物数量已确认', '猫粮已补充', '饮水已补充', '猫砂已清理']) await task.getByRole('checkbox', { name: label }).check();
    await task.getByLabel('服务报告备注').fill('真实上传适配器验收。'); await task.getByRole('checkbox', { name: '我已确认服务后的宠物状态并如实填写报告' }).check(); await task.getByRole('button', { name: '提交服务报告' }).click();
    await recoveredPage.getByRole('button', { name: '刷新', exact: true }).click(); await recoveredPage.getByRole('button', { name: '查看履约证据 1' }).click(); await expect(recoveredPage.getByRole('button', { name: '确认服务完成' })).toBeEnabled(); await recoveredPage.getByRole('button', { name: '确认服务完成' }).click(); await expect(recoveredPage.getByText('服务已完成')).toBeVisible();
    expect((await api(providerPage, `/api/v1/orders/${dogOrderId}/address/assigned`)).status).toBe(403); expect((await api(attackerPage, `/api/v1/pilot/orders/${catOrderId}/messages`)).status).toBe(403);
    expect((await fetch(`${controlUrl}/restart`, { method: 'POST' })).status).toBe(200); await recoveredPage.reload(); await expect(recoveredPage.getByText('服务已完成')).toBeVisible();
    await recoveredPage.getByRole('button', { name: '退出登录' }).click(); await expect(recoveredPage.getByRole('button', { name: '预约服务', exact: true })).toBeVisible();
  } finally { await Promise.allSettled(contexts.map((context) => context.close())); }
});
