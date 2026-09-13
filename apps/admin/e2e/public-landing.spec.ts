import { expect, test } from '@playwright/test';

test('publishes truthful search and sharing metadata', async ({ page }) => {
  await page.goto('/?fixture=service-loop');

  await expect(page).toHaveTitle('安心宠｜上门喂猫与遛狗预约');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    '上门喂猫与遛狗预约，宠主提交需求后由平台匹配服务人员，并可查看订单进度与服务记录。',
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://wk19910907-debug.github.io/nanjing-pet-care-marketplace/',
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    '安心宠｜上门喂猫与遛狗预约',
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://wk19910907-debug.github.io/nanjing-pet-care-marketplace/',
  );
});

test('explains the offer and moves visitors into owner ordering', async ({ page }) => {
  await page.goto('/?fixture=service-loop');

  await expect(page.getByRole('heading', { name: '先选一项服务' })).toBeVisible();
  const catCard = page.locator('.store-product-card').filter({ hasText: '上门喂猫' });
  const dogCard = page.locator('.store-product-card').filter({ hasText: '上门遛狗' });
  await expect(catCard.getByText('¥32 起', { exact: true })).toBeVisible();
  await expect(dogCard.getByText('¥37 起', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '每一次匹配和服务，都有清晰交代' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '预约前想了解的事' })).toBeVisible();

  await page.getByRole('button', { name: '平台运营', exact: true }).click();
  await page.locator('.store-primary').click();

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

  const cards = page.locator('.store-product-card');
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
  const heroAction = await page.locator('.store-primary').boundingBox();
  expect(heroAction).not.toBeNull();
  expect(heroAction!.height).toBeGreaterThanOrEqual(44);
});

test('keeps the landing page usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?fixture=service-loop');

  await expect(page.locator('.store-hero-media img')).toHaveJSProperty('complete', true);
  expect(await page.locator('.store-hero-media img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  expect(await page.locator('.store-product-card').first().evaluate((card) => card.getBoundingClientRect().top)).toBeLessThan(844);
  expect(await page.locator('.customer-web').innerText()).not.toContain('南京');
  expect(await page.locator('.customer-web').innerText()).not.toContain('NANJING');

  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);

  const cards = page.locator('.store-product-card');
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second!.y).toBeGreaterThan(first!.y + first!.height);

  await page.getByText('查看区域与参考价格', { exact: true }).click();
  const quote = page.getByRole('region', { name: '预约参考' });
  const serviceControl = await quote.getByLabel('服务类型').boundingBox();
  const districtControl = await quote.getByLabel('服务区域').boundingBox();
  const summary = await quote.locator('.quote-summary').boundingBox();
  const action = await quote.getByRole('button', { name: '按此服务立即预约' }).boundingBox();

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
  await expect(page.locator('.store-price-note')).toHaveText('仅为功能演示价格，不构成真实服务报价');
  await page.getByText('查看区域与参考价格', { exact: true }).click();
  const quote = page.getByRole('region', { name: '预约参考' });
  const summary = quote.locator('.quote-summary');
  await expect(summary).toHaveAttribute('role', 'status');
  await expect(summary).toHaveAttribute('aria-live', 'polite');
  await expect(quote.getByText('¥32', { exact: true })).toBeVisible();
  await quote.getByLabel('服务类型').selectOption('DOG_WALKING');
  await expect(quote.getByText('¥37', { exact: true })).toBeVisible();
  await expect(quote.getByText('仅为功能演示价格，不构成真实服务报价')).toBeVisible();
  await expect(page.getByText(/服务器报价/)).toHaveCount(0);
});

test('carries the public quote into the owner order form', async ({ page }) => {
  await page.goto('/?fixture=service-loop');
  await page.getByText('查看区域与参考价格', { exact: true }).click();
  const quote = page.getByRole('region', { name: '预约参考' });
  await quote.getByLabel('服务类型').selectOption('DOG_WALKING');
  await quote.getByLabel('服务区域').selectOption('秦淮区');
  await quote.getByRole('button', { name: '按此服务立即预约' }).click();
  const form = page.locator('.order-form');
  await expect(form.getByLabel('服务类型')).toHaveValue('DOG_WALKING');
  await form.getByLabel('上门时间').fill('2026-09-01T19:00');
  await form.getByRole('button', { name: '下一步：填写上门信息' }).click();
  await expect(form.getByLabel('服务区域')).toHaveValue('秦淮区');
  await expect(page.getByRole('button', { name: '宠主', exact: true })).toHaveClass(/active/);
});

test('consumes quote prefills without blocking a repeated quote', async ({ page }) => {
  await page.goto('/?fixture=service-loop');
  await page.getByText('查看区域与参考价格', { exact: true }).click();
  const quote = page.getByRole('region', { name: '预约参考' });
  const form = page.locator('.order-form');
  await quote.getByLabel('服务类型').selectOption('DOG_WALKING');
  await quote.getByLabel('服务区域').selectOption('秦淮区');
  await quote.getByRole('button', { name: '按此服务立即预约' }).click();
  await expect(form.getByLabel('服务类型')).toHaveValue('DOG_WALKING');

  await page.getByRole('button', { name: '平台运营', exact: true }).click();
  await page.getByRole('button', { name: '清空演示数据' }).click();
  await expect(form.getByLabel('服务类型')).toHaveValue('CAT_FEEDING');
  await form.getByLabel('上门时间').fill('2026-09-01T19:00');
  await form.getByRole('button', { name: '下一步：填写上门信息' }).click();
  await expect(form.getByLabel('服务区域')).toHaveValue('建邺区');

  await quote.getByRole('button', { name: '按此服务立即预约' }).click();
  await expect(form.getByLabel('服务类型')).toHaveValue('DOG_WALKING');
  await form.getByLabel('上门时间').fill('2026-09-01T19:00');
  await form.getByRole('button', { name: '下一步：填写上门信息' }).click();
  await expect(form.getByLabel('服务区域')).toHaveValue('秦淮区');
  await form.getByRole('button', { name: '返回' }).click();
  await form.getByLabel('服务类型').selectOption('CAT_FEEDING');
  await form.getByRole('button', { name: '下一步：填写上门信息' }).click();
  await form.getByLabel('服务区域').selectOption('建邺区');
  await quote.getByRole('button', { name: '按此服务立即预约' }).click();
  await expect(form.getByLabel('服务类型')).toHaveValue('DOG_WALKING');
  await form.getByLabel('上门时间').fill('2026-09-01T19:00');
  await form.getByRole('button', { name: '下一步：填写上门信息' }).click();
  await expect(form.getByLabel('服务区域')).toHaveValue('秦淮区');

  await page.getByRole('button', { name: '平台运营', exact: true }).click();
  await page.locator('.store-primary').click();
  await expect(form.getByLabel('服务类型')).toHaveValue('CAT_FEEDING');
  await form.getByLabel('上门时间').fill('2026-09-01T19:00');
  await form.getByRole('button', { name: '下一步：填写上门信息' }).click();
  await expect(form.getByLabel('服务区域')).toHaveValue('建邺区');
});
