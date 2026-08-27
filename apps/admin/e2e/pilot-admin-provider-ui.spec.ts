import { expect, test, type Page } from '@playwright/test';

async function assertMobileBoundary(page: Page) {
  const result = await page.evaluate(() => ({
    stored: localStorage.length + sessionStorage.length,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    controls: [...document.querySelectorAll<HTMLElement>('button, input, select, textarea')]
      .filter((node) => node.offsetParent !== null)
      .map((node) => ({ label: node.textContent || node.getAttribute('aria-label') || node.tagName, height: node.getBoundingClientRect().height })),
    text: document.body.textContent ?? '',
  }));
  expect(result.stored).toBe(0);
  expect(result.overflow).toBe(false);
  expect(result.controls.filter(({ height }) => height < 44)).toEqual([]);
  expect(result.text).not.toMatch(/手机号|微信号|邮箱|身份证|证件照片|银行卡|支付码|门锁密码/);
}

test('admin reviews, confirms one offline fee, and starts safe dispatch on mobile', async ({ page }) => {
  const feeOrder = {
    id: '11111111-1111-4111-8111-111111111111', serviceType: 'CAT_FEEDING', status: 'PENDING_PAYMENT',
    startsAt: '2026-09-10T02:00:00.000Z', durationMinutes: 30, totalFen: 3900, currency: 'CNY',
    city: '南京市', district: '建邺区', serviceZone: '建邺区', ownerDisplayName: '建邺团子家',
  };
  const dispatchOrder = { ...feeOrder, id: '22222222-2222-4222-8222-222222222222', status: 'PENDING_DISPATCH' };
  let feeKey = '';
  let dispatched = '';
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/pilot/session') return route.fulfill({ status: 200, json: {
      userId: 'admin-1', role: 'ADMIN', displayName: '试点运营', expiresAt: '2099-09-03T10:00:00.000Z',
    } });
    if (path === '/api/v1/pilot/invites') return route.fulfill({ status: 200, json: [] });
    if (path === '/api/v1/pilot/providers/review-queue') return route.fulfill({ status: 200, json: [{
      id: '33333333-3333-4333-8333-333333333333', displayName: '秦淮小周', reviewStatus: 'PENDING',
      serviceTypes: ['CAT_FEEDING'], catExperienceMonths: 18, dogExperienceMonths: 0,
      serviceZone: '秦淮区', radiusKm: 5, createdAt: '2026-08-28T02:00:00.000Z',
    }] });
    if (path === '/api/v1/pilot/orders') return route.fulfill({ status: 200, json: [feeOrder, dispatchOrder] });
    if (path.endsWith('/review')) return route.fulfill({ status: 200, json: { id: '33333333-3333-4333-8333-333333333333', reviewStatus: 'APPROVED' } });
    if (path.endsWith('/manual-fee-confirmation')) {
      feeKey = request.headers()['idempotency-key'] ?? '';
      return route.fulfill({ status: 200, json: {
        id: 'fee-1', orderId: feeOrder.id, provider: 'pilot-manual', status: 'SUCCEEDED', amountFen: 3900, currency: 'CNY',
      } });
    }
    if (path.endsWith('/start')) {
      dispatched = path.split('/').at(-2) ?? '';
      return route.fulfill({ status: 200, json: [] });
    }
    return route.fulfill({ status: 404, json: { code: 'ORDER_NOT_FOUND' } });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '平台工作区' })).toBeVisible();
  await page.getByRole('button', { name: `核对订单 ${feeOrder.id} 费用` }).click();
  await page.getByRole('button', { name: '确认记录费用已线下核对' }).click();
  expect(feeKey.length).toBeGreaterThanOrEqual(8);
  await page.getByRole('button', { name: `派单订单 ${dispatchOrder.id}` }).click();
  await page.getByRole('button', { name: '确认启动派单' }).click();
  expect(dispatched).toBe(dispatchOrder.id);
  await assertMobileBoundary(page);
});

test('provider sees only returned work, reads assigned address, and submits evidence report', async ({ page }) => {
  const invitation = {
    id: '11111111-1111-4111-8111-111111111111', serviceType: 'CAT_FEEDING', startsAt: '2026-09-10T02:00:00.000Z', durationMinutes: 30,
    city: '南京市', district: '秦淮区', serviceZone: '秦淮区', invitation: { id: '22222222-2222-4222-8222-222222222222', status: 'PENDING', expiresAt: '2026-09-10T01:55:00.000Z' },
  };
  const task = {
    id: '33333333-3333-4333-8333-333333333333', serviceType: 'DOG_WALKING', status: 'IN_SERVICE', startsAt: '2026-09-10T02:00:00.000Z', durationMinutes: 30,
    totalFen: 4900, currency: 'CNY', city: '南京市', district: '秦淮区', serviceZone: '秦淮区', ownerDisplayName: '秦淮豆包家',
  };
  let uploadMime = '';
  let reportBody: Record<string, unknown> | undefined;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === '/api/v1/pilot/session') return route.fulfill({ status: 200, json: {
      userId: 'provider-1', role: 'PROVIDER', displayName: '秦淮小周', expiresAt: '2099-09-03T10:00:00.000Z',
    } });
    if (path === '/api/v1/pilot/orders' && method === 'GET') return route.fulfill({ status: 200, json: [invitation, task] });
    if (path.endsWith('/address/assigned')) return route.fulfill({ status: 200, json: {
      city: '南京市', district: '秦淮区', serviceZone: '秦淮区', detail: '中华路 88 号 2 幢 301', accessInstructions: '',
    } });
    if (path.endsWith('/evidence/uploads')) return route.fulfill({ status: 200, json: {
      objectKey: `orders/${task.id}/evidence-1`, uploadUrl: '/api/v1/pilot/local-evidence?token=signed-capability', expiresInSeconds: 600,
    } });
    if (path === '/api/v1/pilot/local-evidence' && method === 'PUT') {
      uploadMime = request.headers()['content-type'] ?? '';
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/evidence') && method === 'POST') return route.fulfill({ status: 201, json: { id: 'evidence-1' } });
    if (path.endsWith('/report') && method === 'POST') {
      reportBody = request.postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 200, json: { id: 'report-1', orderId: task.id, submittedAt: '2026-09-10T03:00:00.000Z' } });
    }
    if (path.includes('/invitations/') && path.endsWith('/accept')) return route.fulfill({ status: 200, json: { id: task.id, status: 'PENDING_SERVICE' } });
    return route.fulfill({ status: 404, json: { code: 'ORDER_NOT_FOUND' } });
  });

  await page.goto('/');
  await expect(page.getByText('当前身份：秦淮小周')).toBeVisible();
  await expect(page.getByText('中华路 88 号 2 幢 301')).toHaveCount(0);
  await page.getByRole('button', { name: `读取订单 ${task.id} 完整地址` }).click();
  await expect(page.getByText('中华路 88 号 2 幢 301')).toBeVisible();
  const taskCard = page.getByText(`任务 ${task.id}`).locator('..');
  await taskCard.getByLabel('履约图片').setInputFiles({
    name: 'walk.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]),
  });
  await taskCard.getByRole('button', { name: '上传履约图片' }).click();
  await expect(taskCard.getByText('履约图片已附加。')).toBeVisible();
  await taskCard.getByRole('checkbox', { name: '牵引装备已固定' }).check();
  await taskCard.getByLabel('遛狗时长（分钟）').fill('35');
  await taskCard.getByLabel('服务报告备注').fill('散步与饮水正常');
  await taskCard.getByRole('checkbox', { name: '我已确认服务后的宠物状态并如实填写报告' }).check();
  await taskCard.getByRole('button', { name: '提交服务报告' }).click();
  expect(uploadMime).toBe('image/png');
  expect(reportBody).toEqual({ checklist: { leashSecured: true, walkDurationMinutes: 35 }, afterState: { petStateConfirmed: true }, notes: '散步与饮水正常' });
  expect(reportBody).not.toHaveProperty('checkedOutAt');
  await assertMobileBoundary(page);
});
