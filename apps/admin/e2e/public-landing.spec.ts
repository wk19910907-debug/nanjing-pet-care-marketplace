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
