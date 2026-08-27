import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const baseUrl = process.env.PILOT_ACCEPTANCE_BASE_URL;
const controlUrl = process.env.PILOT_ACCEPTANCE_CONTROL_URL;

if (!baseUrl || !controlUrl) {
  throw new Error('Live acceptance must be launched through pnpm test:e2e:live');
}

const exactAddress = '中山南路 188 号试点楼 2 单元 301';
const secondExactAddress = '江东中路 99 号试点楼 1 单元 202';
const forbiddenSensitiveCopy = /手机号|微信(?:号)?|邮箱|门锁密码|收款码|付款码|二维码|银行卡|身份证|证件照片|token|令牌/i;
const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

type HttpResult = { status: number; body: unknown; headers: Record<string, string> };

function localInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

async function browserFetch(
  page: Page,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<HttpResult> {
  return page.evaluate(async ({ requestPath, requestInit }) => {
    const options: RequestInit = {
      method: requestInit.method ?? 'GET',
      credentials: 'same-origin',
      ...(requestInit.headers === undefined ? {} : { headers: requestInit.headers }),
      ...(requestInit.body === undefined ? {} : {
        headers: { ...requestInit.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestInit.body),
      }),
    };
    const response = await fetch(requestPath, options);
    const text = await response.text();
    let body: unknown = text;
    try { body = text ? JSON.parse(text) as unknown : null; } catch { /* binary or plain text */ }
    return { status: response.status, body, headers: Object.fromEntries(response.headers.entries()) };
  }, { requestPath: path, requestInit: init });
}

async function browserFetchBytes(page: Page, path: string) {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath, { credentials: 'same-origin' });
    return {
      status: response.status,
      bytes: [...new Uint8Array(await response.arrayBuffer())],
      headers: Object.fromEntries(response.headers.entries()),
    };
  }, path);
}

async function login(page: Page, invite: string, displayName: string, workspace: string) {
  await page.goto(baseUrl!);
  await assertMobilePrivacy(page);
  await page.getByRole('textbox', { name: '邀请码', exact: true }).fill(invite);
  await page.getByRole('button', { name: '进入试运营' }).click();
  await assertMobilePrivacy(page);
  await page.getByRole('textbox', { name: '展示昵称', exact: true }).fill(displayName);
  await page.getByRole('button', { name: '保存昵称' }).click();
  await expect(page.getByRole('heading', { name: workspace })).toBeVisible();
  await assertMobilePrivacy(page);
}

async function assertSessionCookie(context: BrowserContext, page: Page) {
  const cookies = await context.cookies(baseUrl!);
  const session = cookies.find((cookie) => cookie.name === 'petcare_pilot_session');
  expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  expect(session?.value).toBeTruthy();
  expect(await page.evaluate(() => document.cookie)).not.toContain('petcare_pilot_session');
  const response = await browserFetch(page, '/api/v1/pilot/session');
  expect(response.status).toBe(200);
  expect(JSON.stringify(response.body)).not.toMatch(/token|cookie|codeHash/i);
}

async function contextStatus(context: BrowserContext, path: string): Promise<number> {
  return (await context.request.get(`${baseUrl}${path}`)).status();
}

async function assertViewportPrivacy(page: Page, viewport: { width: number; height: number }) {
  const result = await page.evaluate(() => ({
    localStorage: localStorage.length,
    sessionStorage: sessionStorage.length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    controls: [...document.querySelectorAll<HTMLElement>('button, input, select, textarea')]
      .filter((node) => node.offsetParent !== null)
      .map((node) => ({
        label: node.getAttribute('aria-label') ?? node.textContent ?? node.tagName,
        height: node.getBoundingClientRect().height,
      })),
    text: document.body.textContent ?? '',
    descriptors: [...document.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
    >('input, select, textarea, button')]
      .flatMap((node) => [
        node.getAttribute('aria-label'),
        node.getAttribute('placeholder'),
        node.getAttribute('name'),
        ...(node.labels ? [...node.labels].map((label) => label.textContent) : []),
      ])
      .filter((value): value is string => value !== null),
    location: window.location.href,
    cookie: document.cookie,
  }));
  expect(page.viewportSize()).toEqual(viewport);
  expect(result.localStorage).toBe(0);
  expect(result.sessionStorage).toBe(0);
  expect(result.overflow).toBe(false);
  expect(result.controls.filter(({ height }) => height < 44)).toEqual([]);
  expect(result.text).not.toMatch(forbiddenSensitiveCopy);
  expect(result.descriptors.join('\n')).not.toMatch(forbiddenSensitiveCopy);
  expect(result.text).not.toContain('petcare_pilot_session');
  expect(result.location).not.toMatch(/token|invite|session/i);
  expect(result.cookie).not.toContain('petcare_pilot_session');
}

async function assertMobilePrivacy(page: Page) {
  await assertViewportPrivacy(page, { width: 390, height: 844 });
}

async function assertDesktopPrivacy(page: Page, workspace: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('heading', { name: workspace })).toBeVisible();
  await assertViewportPrivacy(page, { width: 1280, height: 800 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: workspace })).toBeVisible();
  await assertMobilePrivacy(page);
}

async function logoutAndAssertRevoked(context: BrowserContext, page: Page) {
  const session = (await context.cookies(baseUrl!))
    .find((cookie) => cookie.name === 'petcare_pilot_session');
  expect(session?.value).toBeTruthy();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('button', { name: '进入试运营' })).toBeVisible();
  expect((await browserFetch(page, '/api/v1/pilot/session')).status).toBe(401);
  const revoked = await context.request.get(`${baseUrl}/api/v1/pilot/session`, {
    headers: { Cookie: `petcare_pilot_session=${session!.value}` },
  });
  expect(revoked.status()).toBe(401);
}

test('real PostgreSQL pilot closes the ADMIN, OWNER, and PROVIDER service loop', async ({ browser }) => {
  test.setTimeout(180_000);
  const requests: string[] = [];
  let eventSequence = 0;
  const consoleErrors: Array<{ page: string; text: string; url: string; sequence: number }> = [];
  const failedResponses: Array<{ key: string; sequence: number }> = [];
  const negativeWindows: Array<{
    page: string; path: string; statuses: readonly number[]; start: number; end: number | undefined;
  }> = [];
  const pageErrors: string[] = [];
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 390, height: 844 } }),
    browser.newContext({ viewport: { width: 390, height: 844 } }),
    browser.newContext({ viewport: { width: 390, height: 844 } }),
  ]);
  const adminContext = contexts[0]!;
  const ownerContext = contexts[1]!;
  const providerContext = contexts[2]!;
  const adminPage = await adminContext.newPage();
  const ownerPage = await ownerContext.newPage();
  const providerPage = await providerContext.newPage();
  const pageNames = new Map<Page, string>([
    [adminPage, 'admin'], [ownerPage, 'owner'], [providerPage, 'provider'],
  ]);
  const responseKey = (page: Page, requestPath: string, status: number) => (
    `${pageNames.get(page)}|${new URL(requestPath, baseUrl).pathname}|${status}`
  );
  for (const page of [adminPage, ownerPage, providerPage]) {
    page.on('request', (request) => requests.push(request.url()));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push({
          page: pageNames.get(page)!,
          text: message.text(),
          url: message.location().url,
          sequence: ++eventSequence,
        });
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedResponses.push({
          key: responseKey(page, response.url(), response.status()),
          sequence: ++eventSequence,
        });
      }
    });
  }
  async function withinNegativeWindow<T>(
    page: Page,
    requestPath: string,
    allowedStatuses: readonly number[],
    operation: () => Promise<T>,
  ): Promise<T> {
    const window = {
      page: pageNames.get(page)!,
      path: new URL(requestPath, baseUrl).pathname,
      statuses: allowedStatuses,
      start: eventSequence + 1,
      end: undefined as number | undefined,
    };
    negativeWindows.push(window);
    try {
      return await operation();
    } finally {
      await page.waitForTimeout(0);
      window.end = eventSequence;
    }
  }
  const deliberateNegative = async (
    page: Page,
    requestPath: string,
    allowedStatuses: readonly number[],
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) => {
    return withinNegativeWindow(page, requestPath, allowedStatuses, async () => {
      const result = await browserFetch(page, requestPath, init);
      expect(allowedStatuses).toContain(result.status);
      return result;
    });
  };

  try {
    const bootstrapResponse = await fetch(`${controlUrl}/admin-invite`);
    expect(bootstrapResponse.status).toBe(200);
    const adminInvite = (await bootstrapResponse.json() as { inviteCode: string }).inviteCode;
    expect(adminInvite).toBeTruthy();
    expect((await fetch(`${controlUrl}/admin-invite`)).status).toBe(410);
    await withinNegativeWindow(adminPage, '/api/v1/pilot/session', [401], () => (
      login(adminPage, adminInvite, '试点运营员', '平台工作区')
    ));
    await assertSessionCookie(adminContext, adminPage);

    await adminPage.getByRole('combobox', { name: '邀请角色', exact: true }).selectOption('OWNER');
    await adminPage.getByRole('button', { name: '创建一次性邀请码' }).click();
    const ownerInvite = (await adminPage.locator('.pilot-one-time-code code').textContent())?.trim();
    expect(ownerInvite).toBeTruthy();
    await assertMobilePrivacy(adminPage);

    await adminPage.getByRole('button', { name: '创建一次性邀请码' }).click();
    const secondOwnerInvite = (await adminPage.locator('.pilot-one-time-code code').textContent())?.trim();
    expect(secondOwnerInvite).toBeTruthy();

    await adminPage.getByRole('combobox', { name: '邀请角色', exact: true }).selectOption('PROVIDER');
    await adminPage.getByRole('button', { name: '创建一次性邀请码' }).click();
    const providerInvite = (await adminPage.locator('.pilot-one-time-code code').textContent())?.trim();
    expect(providerInvite).toBeTruthy();

    await adminPage.getByRole('button', { name: '创建一次性邀请码' }).click();
    const secondProviderInvite = (await adminPage.locator('.pilot-one-time-code code').textContent())?.trim();
    expect(secondProviderInvite).toBeTruthy();
    await assertMobilePrivacy(adminPage);

    await Promise.all([
      withinNegativeWindow(ownerPage, '/api/v1/pilot/session', [401], () => (
        login(ownerPage, ownerInvite!, '建邺团子家', '宠主工作区')
      )),
      withinNegativeWindow(providerPage, '/api/v1/pilot/session', [401], () => (
        login(providerPage, providerInvite!, '建邺小周', '服务人员工作区')
      )),
    ]);
    await Promise.all([
      assertSessionCookie(ownerContext, ownerPage),
      assertSessionCookie(providerContext, providerPage),
    ]);

    await providerPage.getByRole('checkbox', { name: '上门喂猫' }).check();
    await providerPage.getByRole('combobox', { name: '申请服务区' }).selectOption('建邺区');
    await providerPage.getByLabel('喂猫经验（月）').fill('24');
    await providerPage.getByRole('button', { name: '提交服务申请' }).click();
    await expect(providerPage.getByText('服务申请已提交，等待平台审核。')).toBeVisible();
    await assertMobilePrivacy(providerPage);

    const now = new Date();
    const serviceStarts = new Date(now.getTime() + 10 * 60_000);
    const availabilityStarts = new Date(now.getTime() - 60 * 60_000);
    const availabilityEnds = new Date(now.getTime() + 3 * 60 * 60_000);
    await providerPage.getByLabel('开始时间').fill(localInput(availabilityStarts));
    await providerPage.getByLabel('结束时间').fill(localInput(availabilityEnds));
    await providerPage.getByRole('button', { name: '保存可服务时间' }).click();
    await expect(providerPage.getByText('可服务时间已保存。')).toBeVisible();
    await assertMobilePrivacy(providerPage);

    await adminPage.getByRole('button', { name: '刷新运营数据' }).click();
    await adminPage.getByRole('button', { name: '审核建邺小周' }).click();
    await adminPage.getByRole('button', { name: '确认批准' }).click();
    await expect(adminPage.getByRole('button', { name: '暂停建邺小周' })).toBeVisible();
    await assertMobilePrivacy(adminPage);

    await ownerPage.getByLabel('宠物昵称').fill('团子');
    await ownerPage.getByRole('button', { name: '保存宠物' }).click();
    await expect(ownerPage.locator('strong', { hasText: '团子 · 猫' })).toBeVisible();
    await ownerPage.getByRole('combobox', { name: '服务区' }).selectOption('建邺区');
    await ownerPage.getByLabel('详细服务地址').fill(exactAddress);
    await ownerPage.getByRole('button', { name: '保存地址' }).click();
    await expect(ownerPage.getByText(exactAddress)).toHaveCount(0);
    await assertMobilePrivacy(ownerPage);

    await ownerPage.getByRole('combobox', { name: '服务宠物' }).selectOption({ label: '团子 · 猫' });
    await ownerPage.getByRole('combobox', { name: '服务地址' }).selectOption({ index: 1 });
    await ownerPage.getByLabel('服务时间').fill(localInput(serviceStarts));
    await ownerPage.getByRole('button', { name: '获取服务报价' }).click();
    await expect(ownerPage.getByText('服务器固定报价')).toBeVisible();
    await ownerPage.getByLabel('订单备注（可选）').fill('进门前请轻声敲门');
    const orderResponsePromise = ownerPage.waitForResponse((response) => (
      new URL(response.url()).pathname === '/api/v1/orders'
      && response.request().method() === 'POST'
      && response.status() === 201
    ));
    await ownerPage.getByRole('button', { name: '按固定报价提交订单' }).click();
    const orderResponse = await orderResponsePromise;
    const ownerOrderInput = orderResponse.request().postDataJSON() as Record<string, unknown>;
    const order = await orderResponse.json() as { id: string; status: string; paymentToken: null };
    expect(order).toMatchObject({ status: 'PENDING_PAYMENT', paymentToken: null });
    const orderId = order.id;
    await assertMobilePrivacy(ownerPage);
    await assertDesktopPrivacy(ownerPage, '宠主工作区');

    const [adminOrdersBefore, providerOrdersBefore] = await Promise.all([
      browserFetch(adminPage, '/api/v1/pilot/orders'),
      browserFetch(providerPage, '/api/v1/pilot/orders'),
    ]);
    expect(JSON.stringify(adminOrdersBefore.body)).not.toContain(exactAddress);
    expect(JSON.stringify(providerOrdersBefore.body)).not.toContain(exactAddress);

    const restart = await fetch(`${controlUrl}/restart`, { method: 'POST' });
    expect(restart.status).toBe(200);
    expect((await restart.json() as { generation: number }).generation).toBe(2);
    await Promise.all([adminPage.reload(), ownerPage.reload(), providerPage.reload()]);
    await expect(adminPage.getByRole('heading', { name: '平台工作区' })).toBeVisible();
    await expect(ownerPage.getByRole('heading', { name: '宠主工作区' })).toBeVisible();
    await expect(providerPage.getByRole('heading', { name: '服务人员工作区' })).toBeVisible();
    await Promise.all([
      assertMobilePrivacy(adminPage), assertMobilePrivacy(ownerPage), assertMobilePrivacy(providerPage),
    ]);
    const ownerOrdersAfterRestart = await browserFetch(ownerPage, '/api/v1/pilot/orders');
    expect(ownerOrdersAfterRestart.status).toBe(200);
    expect(ownerOrdersAfterRestart.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: orderId, status: 'PENDING_PAYMENT' }),
    ]));

    expect(await contextStatus(ownerContext, '/api/v1/pilot/invites')).toBe(403);
    expect(await contextStatus(providerContext, '/api/v1/pilot/providers/review-queue')).toBe(403);
    expect(await contextStatus(adminContext, '/api/v1/pets')).toBe(403);

    await adminPage.getByRole('button', { name: `核对订单 ${orderId} 费用` }).click();
    const feeResponsePromise = adminPage.waitForResponse((response) => (
      new URL(response.url()).pathname === `/api/v1/pilot/orders/${orderId}/manual-fee-confirmation`
      && response.request().method() === 'POST'
    ));
    await adminPage.getByRole('button', { name: '确认记录费用已线下核对' }).click();
    const feeResponse = await feeResponsePromise;
    expect(await feeResponse.text()).toMatch(/^\{"id":"[^"]+","orderId":"[^"]+","provider":"pilot-manual","status":"SUCCEEDED"/);
    expect(feeResponse.status()).toBe(200);
    await expect.poll(async () => {
      const result = await browserFetch(adminPage, '/api/v1/pilot/orders');
      const item = (result.body as Array<{ id: string; status: string }>).find((candidate) => candidate.id === orderId);
      return item?.status;
    }).toBe('PENDING_DISPATCH');
    await assertMobilePrivacy(adminPage);
    await adminPage.getByRole('button', { name: '刷新运营数据' }).click();
    await adminPage.getByRole('button', { name: `派单订单 ${orderId}` }).click();
    const dispatchResponsePromise = adminPage.waitForResponse((response) => (
      new URL(response.url()).pathname === `/api/v1/dispatch/${orderId}/start`
      && response.request().method() === 'POST'
    ));
    await adminPage.getByRole('button', { name: '确认启动派单' }).click();
    const dispatchResponse = await dispatchResponsePromise;
    expect(dispatchResponse.status()).toBe(200);
    const firstDispatchInvitations = await dispatchResponse.json() as Array<{ id: string; status: string }>;
    expect(firstDispatchInvitations).toEqual([
      expect.objectContaining({ status: 'PENDING' }),
    ]);
    await assertMobilePrivacy(adminPage);
    await assertDesktopPrivacy(adminPage, '平台工作区');

    await providerPage.getByRole('button', { name: '刷新我的任务' }).click();
    await expect(providerPage.getByRole('button', { name: `接受邀请 ${orderId}` })).toBeVisible();
    await assertMobilePrivacy(providerPage);
    const candidateAddress = await browserFetch(providerPage, `/api/v1/orders/${orderId}/address/candidate`);
    expect(candidateAddress.status).toBe(200);
    expect(candidateAddress.body).toMatchObject({ city: '南京市', district: '建邺区', serviceZone: '建邺区' });
    expect(JSON.stringify(candidateAddress.body)).not.toContain(exactAddress);
    expect(await contextStatus(providerContext, `/api/v1/orders/${orderId}/address/assigned`)).toBe(403);
    expect(await providerPage.getByText(exactAddress).count()).toBe(0);

    await providerPage.getByRole('button', { name: `接受邀请 ${orderId}` }).click();
    await expect(providerPage.getByText(`任务 ${orderId}`)).toBeVisible();
    expect(await providerPage.getByText(exactAddress).count()).toBe(0);
    await providerPage.getByRole('button', { name: `读取订单 ${orderId} 完整地址` }).click();
    await expect(providerPage.getByText(exactAddress)).toBeVisible();
    await assertMobilePrivacy(providerPage);

    const taskCard = providerPage.getByText(`任务 ${orderId}`).locator('..');
    await taskCard.getByRole('checkbox', { name: '我已到达并确认宠物当前状态可开始服务' }).check();
    await taskCard.getByRole('button', { name: `订单 ${orderId} 签到` }).click();
    await expect(taskCard.getByRole('heading', { name: '履约图片与服务清单' })).toBeVisible();
    await assertMobilePrivacy(providerPage);
    await assertDesktopPrivacy(providerPage, '服务人员工作区');

    await taskCard.getByLabel('履约图片').setInputFiles({
      name: 'service-evidence.png', mimeType: 'image/png', buffer: validPng,
    });
    await taskCard.getByRole('button', { name: '上传履约图片' }).click();
    await expect(taskCard.getByText('履约图片已附加。')).toBeVisible();
    for (const name of ['宠物数量已确认', '猫粮已补充', '饮水已补充', '猫砂已清理']) {
      await taskCard.getByRole('checkbox', { name }).check();
    }
    await taskCard.getByLabel('服务报告备注').fill('团子进食和饮水正常，猫砂已清理。');
    await taskCard.getByRole('checkbox', { name: '我已确认服务后的宠物状态并如实填写报告' }).check();
    await taskCard.getByRole('button', { name: '提交服务报告' }).click();
    await expect(providerPage.getByText('服务报告已提交，等待宠主确认。')).toBeVisible();
    await expect(providerPage.getByText(exactAddress)).toHaveCount(0);
    await assertMobilePrivacy(providerPage);
    await assertDesktopPrivacy(providerPage, '服务人员工作区');

    await ownerPage.getByRole('button', { name: '刷新全部' }).click();
    await expect(ownerPage.getByText('团子进食和饮水正常，猫砂已清理。')).toBeVisible();
    const ownerOrdersWithEvidence = await browserFetch(ownerPage, '/api/v1/pilot/orders');
    const ownerOrderWithEvidence = (ownerOrdersWithEvidence.body as Array<{ id: string; evidence?: Array<{ id: string }> }>)
      .find((candidate) => candidate.id === orderId);
    const evidenceId = ownerOrderWithEvidence?.evidence?.[0]?.id;
    expect(evidenceId).toBeTruthy();
    await ownerPage.getByRole('button', { name: '查看履约证据 1' }).click();
    await expect(ownerPage.getByRole('img', { name: '订单履约证据 1' })).toBeVisible();
    const ownerEvidence = await browserFetch(ownerPage, `/api/v1/evidence/${evidenceId}/read-url`);
    const providerEvidence = await browserFetch(providerPage, `/api/v1/evidence/${evidenceId}/read-url`);
    const adminEvidence = await browserFetch(adminPage, `/api/v1/evidence/${evidenceId}/read-url`);
    for (const result of [ownerEvidence, providerEvidence, adminEvidence]) {
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ expiresInSeconds: 300 });
      expect((result.body as { url: string }).url).toMatch(/^\/api\/v1\/pilot\/local-evidence\?token=/);
    }
    const evidenceBytes = await browserFetchBytes(ownerPage, (ownerEvidence.body as { url: string }).url);
    expect(evidenceBytes.status).toBe(200);
    expect(evidenceBytes.headers['content-type']).toBe('image/png');
    expect(evidenceBytes.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.from(evidenceBytes.bytes)).toEqual(validPng);
    expect((await fetch(`${baseUrl}/api/v1/evidence/${evidenceId}/read-url`)).status).toBe(401);

    const confirmationResponsePromise = ownerPage.waitForResponse((response) => (
      new URL(response.url()).pathname === `/api/v1/orders/${orderId}/confirm`
      && response.request().method() === 'POST'
    ));
    await ownerPage.getByRole('button', { name: '确认服务完成' }).click();
    const confirmationResponse = await confirmationResponsePromise;
    const confirmationBody = await confirmationResponse.json();
    expect(confirmationBody).toEqual({ orderId, status: 'COMPLETED', confirmedAt: expect.any(String) });
    expect(JSON.stringify(confirmationBody)).not.toMatch(/providerId|providerFen|commission/);
    await expect(ownerPage.getByText('服务已完成')).toBeVisible();
    expect(await contextStatus(providerContext, `/api/v1/orders/${orderId}/address/assigned`)).toBe(403);
    await assertDesktopPrivacy(ownerPage, '宠主工作区');

    const holdingOrderResponse = await browserFetch(ownerPage, '/api/v1/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'provider-one-pending-isolation-order' },
      body: ownerOrderInput,
    });
    expect(holdingOrderResponse.status).toBe(201);
    const holdingOrder = holdingOrderResponse.body as { id: string; status: string };
    expect(holdingOrder.status).toBe('PENDING_PAYMENT');
    expect(holdingOrder.id).not.toBe(orderId);
    const holdingFee = await browserFetch(
      adminPage,
      `/api/v1/pilot/orders/${holdingOrder.id}/manual-fee-confirmation`,
      { method: 'POST', headers: { 'Idempotency-Key': 'provider-one-pending-isolation-fee' } },
    );
    expect(holdingFee.status).toBe(200);
    const holdingDispatch = await browserFetch(adminPage, `/api/v1/dispatch/${holdingOrder.id}/start`, {
      method: 'POST',
    });
    expect(holdingDispatch.status).toBe(200);
    const holdingInvitation = (holdingDispatch.body as Array<{ id: string; status: string }>)[0]!;
    expect(holdingInvitation.status).toBe('PENDING');
    await providerPage.getByRole('button', { name: '刷新我的任务' }).click();
    const providerOnePendingOrders = await browserFetch(providerPage, '/api/v1/pilot/orders');
    expect(providerOnePendingOrders.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: holdingOrder.id,
        invitation: expect.objectContaining({ id: holdingInvitation.id, status: 'PENDING' }),
      }),
    ]));
    await adminPage.getByRole('button', { name: '刷新运营数据' }).click();
    await adminPage.getByRole('button', { name: '暂停建邺小周' }).click();
    await adminPage.getByRole('button', { name: '确认暂停建邺小周' }).click();
    await expect(adminPage.getByText('已暂停', { exact: true })).toBeVisible();

    await withinNegativeWindow(ownerPage, '/api/v1/pilot/session', [401], () => (
      logoutAndAssertRevoked(ownerContext, ownerPage)
    ));
    await withinNegativeWindow(ownerPage, '/api/v1/pilot/session', [401], () => (
      login(ownerPage, secondOwnerInvite!, '建邺布丁家', '宠主工作区')
    ));
    await assertSessionCookie(ownerContext, ownerPage);

    for (const result of [
      await deliberateNegative(ownerPage, `/api/v1/pilot/orders/${orderId}`, [403, 404]),
      await deliberateNegative(ownerPage, `/api/v1/orders/${orderId}/address/candidate`, [403, 404]),
      await deliberateNegative(ownerPage, `/api/v1/orders/${orderId}/address/assigned`, [403, 404]),
      await deliberateNegative(ownerPage, `/api/v1/evidence/${evidenceId}/read-url`, [403, 404]),
      await deliberateNegative(ownerPage, `/api/v1/orders/${orderId}/confirm`, [403, 404], { method: 'POST' }),
      await deliberateNegative(ownerPage, `/api/v1/pilot/orders/${orderId}/report`, [403, 404], {
        method: 'POST',
        body: { checklist: {}, afterState: {}, notes: 'cross-owner-write' },
      }),
      await deliberateNegative(ownerPage, '/api/v1/orders', [403, 404], {
        method: 'POST',
        headers: { 'Idempotency-Key': 'owner2-foreign-resource-check' },
        body: ownerOrderInput,
      }),
    ]) {
      expect([403, 404]).toContain(result.status);
    }
    const secondOwnerOrdersBefore = await browserFetch(ownerPage, '/api/v1/pilot/orders');
    expect(secondOwnerOrdersBefore.body).toEqual([]);
    expect(JSON.stringify(secondOwnerOrdersBefore.body)).not.toContain(exactAddress);

    await withinNegativeWindow(providerPage, '/api/v1/pilot/session', [401], () => (
      logoutAndAssertRevoked(providerContext, providerPage)
    ));
    await withinNegativeWindow(providerPage, '/api/v1/pilot/session', [401], () => (
      login(providerPage, secondProviderInvite!, '建邺小吴', '服务人员工作区')
    ));
    await assertSessionCookie(providerContext, providerPage);
    await providerPage.getByRole('checkbox', { name: '上门喂猫' }).check();
    await providerPage.getByRole('combobox', { name: '申请服务区' }).selectOption('建邺区');
    await providerPage.getByLabel('喂猫经验（月）').fill('12');
    await providerPage.getByRole('button', { name: '提交服务申请' }).click();
    await expect(providerPage.getByText('服务申请已提交，等待平台审核。')).toBeVisible();
    await providerPage.getByLabel('开始时间').fill(localInput(availabilityStarts));
    await providerPage.getByLabel('结束时间').fill(localInput(availabilityEnds));
    await providerPage.getByRole('button', { name: '保存可服务时间' }).click();
    await assertMobilePrivacy(providerPage);

    await adminPage.getByRole('button', { name: '刷新运营数据' }).click();
    await adminPage.getByRole('button', { name: '审核建邺小吴' }).click();
    await adminPage.getByRole('button', { name: '确认批准' }).click();
    await expect(adminPage.getByRole('button', { name: '暂停建邺小吴' })).toBeVisible();
    await assertMobilePrivacy(adminPage);

    await ownerPage.getByLabel('宠物昵称').fill('布丁');
    await ownerPage.getByRole('button', { name: '保存宠物' }).click();
    await ownerPage.getByRole('combobox', { name: '服务区' }).selectOption('建邺区');
    await ownerPage.getByLabel('详细服务地址').fill(secondExactAddress);
    await ownerPage.getByRole('button', { name: '保存地址' }).click();
    await ownerPage.getByRole('combobox', { name: '服务宠物' }).selectOption({ label: '布丁 · 猫' });
    await ownerPage.getByRole('combobox', { name: '服务地址' }).selectOption({ index: 1 });
    await ownerPage.getByLabel('服务时间').fill(localInput(new Date(now.getTime() + 20 * 60_000)));
    await ownerPage.getByRole('button', { name: '获取服务报价' }).click();
    await ownerPage.getByLabel('订单备注（可选）').fill('第二账号隔离验收');
    const secondOrderResponsePromise = ownerPage.waitForResponse((response) => (
      new URL(response.url()).pathname === '/api/v1/orders'
      && response.request().method() === 'POST'
      && response.status() === 201
    ));
    await ownerPage.getByRole('button', { name: '按固定报价提交订单' }).click();
    const secondOrder = await (await secondOrderResponsePromise).json() as { id: string; status: string };
    expect(secondOrder.status).toBe('PENDING_PAYMENT');
    expect(secondOrder.id).not.toBe(orderId);
    await assertMobilePrivacy(ownerPage);

    const secondFee = await browserFetch(
      adminPage,
      `/api/v1/pilot/orders/${secondOrder.id}/manual-fee-confirmation`,
      { method: 'POST', headers: { 'Idempotency-Key': 'second-owner-fee-confirmation' } },
    );
    expect(secondFee.status).toBe(200);
    const secondDispatch = await browserFetch(adminPage, `/api/v1/dispatch/${secondOrder.id}/start`, {
      method: 'POST',
    });
    expect(secondDispatch.status).toBe(200);
    expect(secondDispatch.body).toEqual([expect.objectContaining({ status: 'PENDING' })]);
    await assertMobilePrivacy(adminPage);

    await providerPage.getByRole('button', { name: '刷新我的任务' }).click();
    const secondProviderOrders = await browserFetch(providerPage, '/api/v1/pilot/orders');
    expect(secondProviderOrders.status).toBe(200);
    expect((secondProviderOrders.body as Array<{ id: string }>).map((item) => item.id)).toEqual([secondOrder.id]);
    const secondProviderOrder = (secondProviderOrders.body as Array<{
      id: string; invitation: { id: string; status: string };
    }>)[0]!;
    expect(secondProviderOrder.invitation.status).toBe('PENDING');
    expect(await providerPage.getByText(exactAddress).count()).toBe(0);

    for (const result of [
      await deliberateNegative(providerPage, `/api/v1/pilot/orders/${orderId}`, [403, 404]),
      await deliberateNegative(providerPage, `/api/v1/orders/${orderId}/address/candidate`, [403, 404]),
      await deliberateNegative(providerPage, `/api/v1/orders/${orderId}/address/assigned`, [403, 404]),
      await deliberateNegative(providerPage, `/api/v1/evidence/${evidenceId}/read-url`, [403, 404]),
    ]) {
      expect([403, 404]).toContain(result.status);
    }
    const foreignPendingAccept = await deliberateNegative(
      providerPage,
      `/api/v1/invitations/${holdingInvitation.id}/accept`,
      [403, 404],
      { method: 'POST' },
    );
    expect([403, 404]).toContain(foreignPendingAccept.status);
    const secondAccept = await browserFetch(
      providerPage,
      `/api/v1/invitations/${secondProviderOrder.invitation.id}/accept`,
      { method: 'POST' },
    );
    expect(secondAccept.status).toBe(200);
    const secondAssignedAddress = await browserFetch(
      providerPage,
      `/api/v1/orders/${secondOrder.id}/address/assigned`,
    );
    expect(secondAssignedAddress.status).toBe(200);
    expect(secondAssignedAddress.body).toMatchObject({ detail: secondExactAddress });
    expect(JSON.stringify(secondAssignedAddress.body)).not.toContain(exactAddress);
    await providerPage.getByRole('button', { name: '刷新我的任务' }).click();
    await assertMobilePrivacy(providerPage);
    await assertDesktopPrivacy(providerPage, '服务人员工作区');

    const applicationRequests = [...requests];
    for (const path of [
      '/api/v1/payments',
      '/api/v1/payments/create',
      '/api/v1/payments/webhooks/fake',
      '/api/v1/wechat/pay',
    ]) {
      expect((await deliberateNegative(adminPage, path, [404], { method: 'POST' })).status).toBe(404);
    }

    await Promise.all([assertMobilePrivacy(adminPage), assertMobilePrivacy(ownerPage), assertMobilePrivacy(providerPage)]);
    await Promise.all([
      assertDesktopPrivacy(adminPage, '平台工作区'),
      assertDesktopPrivacy(ownerPage, '宠主工作区'),
      assertDesktopPrivacy(providerPage, '服务人员工作区'),
    ]);
    await Promise.all([
      withinNegativeWindow(ownerPage, '/api/v1/pilot/session', [401], () => (
        logoutAndAssertRevoked(ownerContext, ownerPage)
      )),
      withinNegativeWindow(providerPage, '/api/v1/pilot/session', [401], () => (
        logoutAndAssertRevoked(providerContext, providerPage)
      )),
    ]);
    expect(applicationRequests.some((url) => /\/payments(?:\/|$)|wechat|phone|qr/i.test(new URL(url).pathname))).toBe(false);
    const unexpectedConsoleErrors = consoleErrors.filter((entry) => {
      const statusMatch = entry.text.match(/\b([45]\d\d)\b/);
      if (!statusMatch || !entry.url) return true;
      const key = `${entry.page}|${new URL(entry.url, baseUrl).pathname}|${statusMatch[1]}`;
      const matchingWindow = negativeWindows.find((window) => (
        window.page === entry.page
        && window.path === new URL(entry.url, baseUrl).pathname
        && window.statuses.includes(Number(statusMatch[1]))
        && entry.sequence >= window.start
        && entry.sequence <= (window.end ?? -1)
      ));
      return !matchingWindow || !failedResponses.some((response) => (
        response.key === key
        && response.sequence >= matchingWindow.start
        && response.sequence <= (matchingWindow.end ?? -1)
      ));
    });
    expect(unexpectedConsoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
