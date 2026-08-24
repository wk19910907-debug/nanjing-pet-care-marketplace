import { expect, test } from '@playwright/test';

test('publishes truthful search and sharing metadata', async ({ page }) => {
  await page.goto('/?fixture=service-loop');

  await expect(page).toHaveTitle('南京安心宠｜上门喂猫与遛狗平台体验');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    '南京上门喂猫与遛狗平台安全体验版：宠主提交需求，平台匹配服务人员并跟进履约报告。',
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://wk19910907-debug.github.io/nanjing-pet-care-marketplace/',
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    '南京安心宠｜上门喂猫与遛狗平台体验',
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://wk19910907-debug.github.io/nanjing-pet-care-marketplace/',
  );
});

test('explains the offer and moves visitors into owner ordering', async ({ page }) => {
  await page.goto('/?fixture=service-loop');

  await expect(page.getByRole('heading', { name: '两项核心服务，价格先说清楚' })).toBeVisible();
  const catCard = page.locator('.price-card').filter({ hasText: '上门喂猫' });
  const dogCard = page.locator('.price-card').filter({ hasText: '上门遛狗' });
  await expect(catCard.getByText('¥32', { exact: true })).toBeVisible();
  await expect(dogCard.getByText('¥37', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '平台把匹配和履约过程管起来' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '常见问题' })).toBeVisible();

  await page.getByRole('button', { name: '平台运营', exact: true }).click();
  await page.getByRole('button', { name: '立即体验下单' }).click();

  await expect(page.getByRole('button', { name: '宠主', exact: true })).toHaveClass(/active/);
  await expect(page.getByRole('heading', { name: '预约上门服务' })).toBeVisible();
});

test('lays out pricing side by side on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?fixture=service-loop');
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);

  const cards = page.locator('.price-card');
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
  await expect(page.getByRole('button', { name: '立即体验下单' })).toHaveCSS('min-height', '44px');
});

test('keeps the landing page usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?fixture=service-loop');

  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);

  const cards = page.locator('.price-card');
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second!.y).toBeGreaterThan(first!.y + first!.height);

  const quote = page.getByRole('region', { name: '体验报价' });
  const serviceControl = await quote.getByLabel('服务类型').boundingBox();
  const districtControl = await quote.getByLabel('服务区域').boundingBox();
  const summary = await quote.locator('.quote-summary').boundingBox();
  const action = await quote.getByRole('button', { name: '按此方案体验下单' }).boundingBox();

  expect(serviceControl).not.toBeNull();
  expect(districtControl).not.toBeNull();
  expect(summary).not.toBeNull();
  expect(action).not.toBeNull();
  expect(districtControl!.y).toBeGreaterThan(serviceControl!.y + serviceControl!.height);
  expect(summary!.y).toBeGreaterThan(districtControl!.y + districtControl!.height);
  expect(action!.y).toBeGreaterThan(summary!.y + summary!.height);
  expect(action!.height).toBeGreaterThanOrEqual(44);
});

test('shows a transparent quote and updates the service price', async ({ page }) => {
  await page.goto('/?fixture=service-loop');
  const quote = page.getByRole('region', { name: '体验报价' });
  const summary = quote.locator('.quote-summary');
  await expect(summary).toHaveAttribute('role', 'status');
  await expect(summary).toHaveAttribute('aria-live', 'polite');
  await expect(quote.getByText('¥32', { exact: true })).toBeVisible();
  await quote.getByLabel('服务类型').selectOption('DOG_WALKING');
  await expect(quote.getByText('¥37', { exact: true })).toBeVisible();
  await expect(quote.getByText('体验参考价，不会产生真实费用')).toBeVisible();
});

test('carries the public quote into the owner order form', async ({ page }) => {
  await page.goto('/?fixture=service-loop');
  const quote = page.getByRole('region', { name: '体验报价' });
  await quote.getByLabel('服务类型').selectOption('DOG_WALKING');
  await quote.getByLabel('服务区域').selectOption('秦淮区');
  await quote.getByRole('button', { name: '按此方案体验下单' }).click();
  const form = page.locator('.order-form');
  await expect(form.getByLabel('服务类型')).toHaveValue('DOG_WALKING');
  await expect(form.getByLabel('服务区域')).toHaveValue('秦淮区');
  await expect(page.getByRole('button', { name: '宠主', exact: true })).toHaveClass(/active/);
});

test('consumes quote prefills without blocking a repeated quote', async ({ page }) => {
  await page.goto('/?fixture=service-loop');
  const quote = page.getByRole('region', { name: '体验报价' });
  const form = page.locator('.order-form');
  await quote.getByLabel('服务类型').selectOption('DOG_WALKING');
  await quote.getByLabel('服务区域').selectOption('秦淮区');
  await quote.getByRole('button', { name: '按此方案体验下单' }).click();
  await expect(form.getByLabel('服务类型')).toHaveValue('DOG_WALKING');

  await page.getByRole('button', { name: '平台运营', exact: true }).click();
  await page.getByRole('button', { name: '恢复体验数据' }).click();
  await expect(form.getByLabel('服务类型')).toHaveValue('CAT_FEEDING');
  await expect(form.getByLabel('服务区域')).toHaveValue('建邺区');

  await quote.getByRole('button', { name: '按此方案体验下单' }).click();
  await expect(form.getByLabel('服务类型')).toHaveValue('DOG_WALKING');
  await expect(form.getByLabel('服务区域')).toHaveValue('秦淮区');
  await form.getByLabel('服务类型').selectOption('CAT_FEEDING');
  await form.getByLabel('服务区域').selectOption('建邺区');
  await quote.getByRole('button', { name: '按此方案体验下单' }).click();
  await expect(form.getByLabel('服务类型')).toHaveValue('DOG_WALKING');
  await expect(form.getByLabel('服务区域')).toHaveValue('秦淮区');

  await page.getByRole('button', { name: '平台运营', exact: true }).click();
  await page.getByRole('button', { name: '立即体验下单' }).click();
  await expect(form.getByLabel('服务类型')).toHaveValue('CAT_FEEDING');
  await expect(form.getByLabel('服务区域')).toHaveValue('建邺区');
});
