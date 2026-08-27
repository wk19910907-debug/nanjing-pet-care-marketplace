import { expect, test } from '@playwright/test';

test('owner creates safe resources, uses a fixed quote, and reads the shared timeline on mobile', async ({ page }) => {
  const pet = {
    id: '11111111-1111-4111-8111-111111111111', name: '团子', species: 'CAT', sensitiveNotes: '',
  };
  const address = {
    id: '33333333-3333-4333-8333-333333333333', city: '南京市',
    district: '建邺区', serviceZone: '建邺区',
  };
  const pendingOrder = {
    id: '44444444-4444-4444-8444-444444444444', serviceType: 'CAT_FEEDING',
    status: 'PENDING_PAYMENT', startsAt: '2026-09-10T02:00:00.000Z', durationMinutes: 30,
    totalFen: 3900, currency: 'CNY', city: '南京市', district: '建邺区', serviceZone: '建邺区',
  };
  let addressDetail = '';
  let orderRequest: Record<string, unknown> | undefined;
  let orderKey = '';
  let confirmedOrder = '';

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === '/api/v1/pilot/session' && method === 'GET') {
      await route.fulfill({ status: 200, json: {
        userId: 'owner-1', role: 'OWNER', displayName: '建邺宠主',
        expiresAt: '2099-09-03T10:00:00.000Z',
      } });
    } else if (path === '/api/v1/pets' && method === 'GET') {
      await route.fulfill({ status: 200, json: [pet] });
    } else if (path === '/api/v1/addresses' && method === 'GET') {
      await route.fulfill({ status: 200, json: [address] });
    } else if (path === '/api/v1/addresses' && method === 'POST') {
      addressDetail = (request.postDataJSON() as { detail: string }).detail;
      await route.fulfill({ status: 201, json: address });
    } else if (path === '/api/v1/pilot/orders' && method === 'GET') {
      await route.fulfill({ status: 200, json: [pendingOrder, {
        ...pendingOrder,
        id: '55555555-5555-4555-8555-555555555555', status: 'PENDING_CONFIRMATION',
        providerDisplayName: '秦淮小周',
        report: {
          notes: '团子进食正常，已更换饮水。', submittedAt: '2026-09-10T03:00:00.000Z',
          checklist: { fed: true },
        },
        evidence: [{ id: 'evidence-owner-1' }],
      }] });
    } else if (path === '/api/v1/evidence/evidence-owner-1/read-url' && method === 'GET') {
      await route.fulfill({ status: 200, json: { url: '/api/v1/pilot/local-evidence?token=signed', expiresInSeconds: 300 } });
    } else if (path === '/api/v1/pilot/local-evidence' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from([137, 80, 78, 71]) });
    } else if (path === '/api/v1/quotes' && method === 'POST') {
      await route.fulfill({ status: 200, json: {
        baseFen: 3200, extraPetFen: 0, durationFen: 700, distanceFen: 0,
        holidayFen: 0, totalFen: 3900, currency: 'CNY',
      } });
    } else if (path === '/api/v1/orders' && method === 'POST') {
      orderRequest = request.postDataJSON() as Record<string, unknown>;
      orderKey = request.headers()['idempotency-key'] ?? '';
      await route.fulfill({ status: 201, json: {
        id: pendingOrder.id, status: 'PENDING_PAYMENT', totalFen: 3900,
        currency: 'CNY', paymentToken: null,
      } });
    } else if (path.endsWith('/confirm') && method === 'POST') {
      confirmedOrder = path.split('/').at(-2) ?? '';
      await route.fulfill({ status: 200, json: { orderId: confirmedOrder, status: 'COMPLETED', confirmedAt: '2026-09-10T03:05:00.000Z' } });
    } else {
      await route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '宠主工作区' })).toBeVisible();
  await page.getByRole('combobox', { name: '服务区' }).selectOption('秦淮区');
  await page.getByLabel('详细服务地址').fill('中华路 88 号 2 幢 301');
  await page.getByRole('button', { name: '保存地址' }).click();
  await expect.poll(() => addressDetail).toBe('中华路 88 号 2 幢 301');
  await expect(page.getByText('中华路 88 号 2 幢 301')).toHaveCount(0);

  await page.getByRole('combobox', { name: '服务宠物' }).selectOption(pet.id);
  await page.getByRole('combobox', { name: '服务地址' }).selectOption(address.id);
  await page.getByLabel('服务时间').fill('2026-09-10T10:00');
  await page.getByRole('button', { name: '获取服务报价' }).click();
  await expect(page.getByText('服务器固定报价')).toBeVisible();
  await page.getByLabel('订单备注（可选）').fill('请轻声进门');
  await page.getByRole('button', { name: '按固定报价提交订单' }).click();

  expect(orderKey).toMatch(/^.{8,100}$/);
  expect(orderRequest).toMatchObject({
    serviceType: 'CAT_FEEDING', petIds: [pet.id], addressId: address.id,
    durationMinutes: 30, notes: '请轻声进门',
  });
  expect(orderRequest).not.toHaveProperty('totalFen');
  await expect(page.getByText('团子进食正常，已更换饮水。')).toBeVisible();
  await page.getByRole('button', { name: '查看履约证据 1' }).click();
  await expect(page.getByRole('img', { name: '订单履约证据 1' })).toBeVisible();
  await page.getByRole('button', { name: '确认服务完成' }).click();
  expect(confirmedOrder).toBe('55555555-5555-4555-8555-555555555555');

  const mobile = await page.evaluate(() => ({
    stored: localStorage.length + sessionStorage.length,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    controls: [...document.querySelectorAll<HTMLElement>('button, input, select, textarea')]
      .filter((node) => node.offsetParent !== null)
      .map((node) => ({ label: node.getAttribute('aria-label') ?? node.tagName, height: node.getBoundingClientRect().height })),
    text: document.body.textContent ?? '',
  }));
  expect(mobile.stored).toBe(0);
  expect(mobile.overflow).toBe(false);
  expect(mobile.controls.every(({ height }) => height >= 44)).toBe(true);
  expect(mobile.text).not.toMatch(/二维码|手机号|付款码|收款码/);
});
