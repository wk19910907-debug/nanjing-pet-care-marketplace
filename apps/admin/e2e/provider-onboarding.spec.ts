import { expect, test, type Page } from '@playwright/test';

async function submitApplication(page: Page, name: string) {
  await page.getByRole('button', { name: '服务人员', exact: true }).click();
  const panel = page.getByRole('region', { name: '申请成为服务人员' });
  await panel.getByLabel('体验昵称').fill(name);
  await panel.getByLabel('服务区域').selectOption('秦淮区');
  await panel.getByLabel('上门遛狗').check();
  await panel.getByLabel('经验说明').fill('有两年养犬经验，熟悉牵引和基础清洁。');
  await panel.getByRole('button', { name: '提交审核申请' }).click();
  await expect(panel.getByText('待平台审核')).toBeVisible();
}

async function submitQinhuaiDogOrder(page: Page, petName: string) {
  await page.getByRole('button', { name: '宠主', exact: true }).click();
  const orderForm = page.locator('.order-form');
  await orderForm.getByLabel('服务类型').selectOption('DOG_WALKING');
  await orderForm.getByLabel('宠物昵称').fill(petName);
  await orderForm.getByLabel('服务区域').selectOption('秦淮区');
  await orderForm.getByLabel('详细地址').fill('体验地址 1 号');
  await orderForm.getByRole('button', { name: '提交订单' }).click();
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

test('keeps provider onboarding within a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?fixture=provider-onboarding');
  await page.getByRole('button', { name: '服务人员', exact: true }).click();

  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);

  const panel = page.getByRole('region', { name: '申请成为服务人员' });
  const name = await panel.getByLabel('体验昵称').boundingBox();
  const district = await panel.getByLabel('服务区域').boundingBox();
  const action = await panel.getByRole('button', { name: '提交审核申请' }).boundingBox();
  expect(name).not.toBeNull();
  expect(district).not.toBeNull();
  expect(action).not.toBeNull();
  expect(district!.y).toBeGreaterThan(name!.y + name!.height);
  expect(action!.height).toBeGreaterThanOrEqual(44);
});

test('keeps submitted applications and operator matching controls usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?fixture=provider-onboarding');
  await page.getByRole('button', { name: '服务人员', exact: true }).click();
  const applicationPanel = page.getByRole('region', { name: '申请成为服务人员' });
  const submitAction = await applicationPanel.getByRole('button', { name: '提交审核申请' }).boundingBox();
  expect(submitAction).not.toBeNull();
  expect(submitAction!.height).toBeGreaterThanOrEqual(44);
  await applicationPanel.getByLabel('体验昵称').fill('小林');
  await applicationPanel.getByLabel('服务区域').selectOption('秦淮区');
  await applicationPanel.getByLabel('上门遛狗').check();
  await applicationPanel.getByLabel('经验说明').fill('有两年养犬经验，熟悉牵引和基础清洁。');
  await applicationPanel.getByRole('button', { name: '提交审核申请' }).click();
  await expect(applicationPanel.getByText('待平台审核')).toBeVisible();
  await expect(applicationPanel.locator('.application-card')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);

  await submitQinhuaiDogOrder(page, '团子');
  await page.getByRole('button', { name: '平台运营', exact: true }).click();
  const reviewQueue = page.getByRole('region', { name: '服务人员审核队列' });
  const reviewCard = reviewQueue.locator('.application-card');
  const approveAction = reviewQueue.getByRole('button', { name: '审核通过：小林' });
  await expect(reviewCard).toHaveCount(1);
  const approveBox = await approveAction.boundingBox();
  expect(approveBox).not.toBeNull();
  expect(approveBox!.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);

  await approveAction.click();
  const matchPanel = page.locator('.match-panel');
  await expect(matchPanel.getByLabel('匹配服务人员')).toContainText('小林 · 秦淮区 · 已认证');
  const matchAction = await matchPanel.getByRole('button', { name: '确认匹配' }).boundingBox();
  expect(matchAction).not.toBeNull();
  expect(matchAction!.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);
});

test('keeps populated provider review and matching controls usable on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?fixture=provider-onboarding');
  await submitApplication(page, '小林');

  const applicationPanel = page.getByRole('region', { name: '申请成为服务人员' });
  const applicationCard = applicationPanel.locator('.application-card');
  const name = await applicationPanel.getByLabel('体验昵称').boundingBox();
  const district = await applicationPanel.getByLabel('服务区域').boundingBox();
  expect(applicationCard).toHaveCount(1);
  expect(name).not.toBeNull();
  expect(district).not.toBeNull();
  expect(Math.abs(name!.y - district!.y)).toBeLessThan(2);
  await expectNoHorizontalOverflow(page);

  await submitQinhuaiDogOrder(page, '团子');
  await page.getByRole('button', { name: '平台运营', exact: true }).click();
  const reviewQueue = page.getByRole('region', { name: '服务人员审核队列' });
  const reviewCard = reviewQueue.locator('.application-card');
  await expect(reviewCard).toHaveCount(1);
  await reviewQueue.getByRole('button', { name: '审核通过：小林' }).click();

  const summary = page.locator('.summary-grid > div');
  const firstSummary = await summary.nth(0).boundingBox();
  const secondSummary = await summary.nth(1).boundingBox();
  const matchPanel = page.locator('.match-panel');
  const select = await matchPanel.getByLabel('匹配服务人员').boundingBox();
  const matchAction = await matchPanel.getByRole('button', { name: '确认匹配' }).boundingBox();
  expect(firstSummary).not.toBeNull();
  expect(secondSummary).not.toBeNull();
  expect(select).not.toBeNull();
  expect(matchAction).not.toBeNull();
  expect(Math.abs(firstSummary!.y - secondSummary!.y)).toBeLessThan(2);
  expect(matchAction!.x).toBeGreaterThan(select!.x + select!.width);
  expect(matchAction!.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);
});

test('submits a safe provider application without personal identity fields', async ({ page }) => {
  await page.goto('/?fixture=provider-onboarding');
  await page.getByRole('button', { name: '服务人员', exact: true }).click();
  const panel = page.getByRole('region', { name: '申请成为服务人员' });
  await panel.getByLabel('体验昵称').fill('小林');
  await panel.getByLabel('服务区域').selectOption('秦淮区');
  await panel.getByLabel('上门遛狗').check();
  await panel.getByLabel('经验说明').fill('有两年养犬经验，熟悉牵引和基础清洁。');
  await panel.getByRole('button', { name: '提交审核申请' }).click();
  await expect(panel.getByText('待平台审核')).toBeVisible();
  await expect(panel.getByLabel(/手机号|身份证|银行卡/)).toHaveCount(0);
});

test('approves an applicant before including them in eligible order matching', async ({ page }) => {
  await page.goto('/?fixture=provider-onboarding');
  await page.getByRole('button', { name: '服务人员', exact: true }).click();
  const applicationPanel = page.getByRole('region', { name: '申请成为服务人员' });
  await applicationPanel.getByLabel('体验昵称').fill('小林');
  await applicationPanel.getByLabel('服务区域').selectOption('秦淮区');
  await applicationPanel.getByLabel('上门遛狗').check();
  await applicationPanel.getByLabel('经验说明').fill('有两年养犬经验，熟悉牵引和基础清洁。');
  await applicationPanel.getByRole('button', { name: '提交审核申请' }).click();

  await page.getByRole('button', { name: '宠主', exact: true }).click();
  const orderForm = page.locator('.order-form');
  await orderForm.getByLabel('服务类型').selectOption('DOG_WALKING');
  await orderForm.getByLabel('宠物昵称').fill('团子');
  await orderForm.getByLabel('服务区域').selectOption('秦淮区');
  await orderForm.getByLabel('详细地址').fill('体验地址 1 号');
  await orderForm.getByRole('button', { name: '提交订单' }).click();

  await page.getByRole('button', { name: '平台运营', exact: true }).click();
  await expect(page.getByText('暂无符合区域和服务类型的已认证人员')).toBeVisible();
  await page.getByRole('button', { name: '审核通过：小林' }).click();
  await expect(page.getByText('审核通过 · 已进入匹配池')).toBeVisible();
  await expect(page.getByLabel('匹配服务人员')).toContainText('小林 · 秦淮区 · 已认证');

  await page.getByRole('button', { name: '宠主', exact: true }).click();
  await orderForm.getByLabel('服务类型').selectOption('CAT_FEEDING');
  await orderForm.getByLabel('宠物昵称').fill('奶糖');
  await orderForm.getByLabel('服务区域').selectOption('建邺区');
  await orderForm.getByLabel('详细地址').fill('体验地址 2 号');
  await orderForm.getByRole('button', { name: '提交订单' }).click();

  await page.getByRole('button', { name: '平台运营', exact: true }).click();
  const matchers = page.getByLabel('匹配服务人员');
  await expect(matchers).toHaveCount(2);
  await expect(matchers.nth(0)).not.toContainText('小林 · 秦淮区 · 已认证');
  await expect(matchers.nth(1)).toContainText('小林 · 秦淮区 · 已认证');
});
