import { expect, test } from '@playwright/test';
import { submitDemoOrder } from './demo-order.js';

test('public demo completes a booking without requesting a real street address', async ({ page }) => {
  await page.goto('/');
  const form = page.locator('.order-form');
  await form.getByLabel('上门时间').fill('2026-09-01T19:00');
  await form.getByRole('button', { name: '下一步：填写上门信息' }).click();
  await expect(form.getByLabel('详细地址')).toHaveCount(0);
  await expect(form.getByText('演示地址（非真实住址）')).toBeVisible();
  await form.getByLabel('宠物昵称').fill('团子');
  await form.getByRole('button', { name: '下一步：确认预约' }).click();
  await form.getByRole('button', { name: '提交订单' }).click();
  await expect(page.getByRole('heading', { name: '演示预约已提交' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('建邺区 · 演示地址（非真实住址）')).toBeVisible();
});

test('owner, platform and provider complete one order', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: '宠主', exact: true }).click();
  await submitDemoOrder(page, { petName: '团子' });
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
