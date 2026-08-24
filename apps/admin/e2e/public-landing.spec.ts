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
