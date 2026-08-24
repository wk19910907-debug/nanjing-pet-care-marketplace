import { expect, test } from '@playwright/test';

test('reviewer, dispatcher and support complete a masked audited operator flow', async ({ page }) => {
  await page.goto('/?fixture=operator-flow');
  await page.getByLabel('当前角色').selectOption('REVIEWER');
  await page.getByRole('button', { name: '服务者审核' }).click();
  await expect(page.getByText('王小宁 · 待审核')).toBeVisible();
  await page.getByRole('button', { name: '批准服务者' }).click();
  await expect(page.getByText('王小宁 · 已批准')).toBeVisible();

  await page.getByLabel('当前角色').selectOption('DISPATCHER');
  await page.getByRole('button', { name: '订单调度' }).click();
  await expect(page.getByText('建邺区·奥体东（详细地址已隐藏）')).toBeVisible();
  await expect(page.getByText('门锁1234')).toHaveCount(0);
  await page.getByRole('button', { name: '人工指派' }).click();
  await expect(page.getByText('已指派 王小宁')).toBeVisible();

  await page.getByLabel('当前角色').selectOption('SUPPORT');
  await page.getByRole('button', { name: '投诉退款' }).click();
  await page.getByLabel('退款金额（分）').fill('1000');
  await page.getByRole('button', { name: '解决投诉' }).click();
  await expect(page.getByText('已解决 · 退款 ¥10.00')).toBeVisible();
  await page.getByRole('button', { name: '审计记录' }).click();
  await expect(page.getByText('批准服务者')).toBeVisible();
  await expect(page.getByText('人工指派订单')).toBeVisible();
  await expect(page.getByText('部分退款解决投诉')).toBeVisible();
});
