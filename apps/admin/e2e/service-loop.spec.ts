import { expect, test } from '@playwright/test';

test('owner, platform and provider complete one order', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: '宠主', exact: true }).click();
  await page.getByLabel('宠物昵称').fill('团子');
  await page.locator('.order-form').getByLabel('服务区域').selectOption('建邺区');
  await page.getByLabel('详细地址').fill('测试小区 1 栋');
  await page.getByLabel('上门时间').fill('2026-08-24T19:00');
  await page.getByRole('button', { name: '提交订单' }).click();
  await expect(page.getByText('待平台匹配', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '平台运营', exact: true }).click();
  await page.getByRole('button', { name: '确认匹配' }).click();
  await expect(page.getByText('已匹配，等待服务')).toBeVisible();

  await page.getByRole('button', { name: '服务人员', exact: true }).click();
  await page.getByRole('button', { name: '开始服务' }).click();
  await page.getByLabel('已完成喂食换水').check();
  await page.getByLabel('已清理宠物区域').check();
  await page.getByLabel('服务记录').fill('宠物状态良好，已完成服务。');
  await page.getByRole('button', { name: '提交服务报告' }).click();
  await expect(page.getByText('等待宠主确认', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '宠主', exact: true }).click();
  await page.getByRole('button', { name: '确认完成' }).click();
  await expect(page.getByText('服务已完成')).toBeVisible();

  await page.reload();
  await expect(page.getByText('服务已完成')).toBeVisible();
});
