import { expect, test, type Page } from '@playwright/test';
import { submitDemoOrder } from './demo-order.js';

async function submitApplication(page: Page) {
  await page.getByRole('button', { name: '服务人员', exact: true }).click();
  const panel = page.getByRole('region', { name: '申请成为服务人员' });
  await panel.getByLabel('体验昵称').fill('体验小林');
  await panel.getByLabel('服务区域').selectOption('秦淮区');
  await panel.getByLabel('上门遛狗').check();
  await panel.getByLabel('经验说明').fill('有两年养犬经验，熟悉牵引和基础清洁。');
  await panel.getByRole('button', { name: '提交审核申请' }).click();
}

async function createOrder(page: Page) {
  await page.getByRole('button', { name: '宠主', exact: true }).click();
  await submitDemoOrder(page, { serviceType: 'DOG_WALKING', petName: '线上团子', district: '秦淮区' });
}

test('lets the matched approved provider complete only their own task after reload', async ({ page }) => {
  await page.goto('/');
  await submitApplication(page);
  await createOrder(page);

  await page.getByRole('button', { name: '平台运营', exact: true }).click();
  await page.getByRole('button', { name: '审核通过：体验小林' }).click();
  const providerChoice = page.getByLabel('匹配服务人员');
  await providerChoice.selectOption({ label: '体验小林 · 秦淮区 · 已认证' });
  await page.getByRole('button', { name: '确认匹配' }).click();

  await page.getByRole('button', { name: '服务人员', exact: true }).click();
  const identity = page.getByLabel('体验服务人员身份');
  await expect(identity).toHaveValue('provider-provider-application-1');
  await expect(identity.locator('option:checked')).toHaveText('体验小林 · 秦淮区 · 已认证');
  await expect(page.getByText('线上团子')).toBeVisible();
  await identity.selectOption('provider-wang');
  await expect(page.getByText('线上团子')).toBeHidden();
  await identity.selectOption('provider-provider-application-1');
  await expect(page.getByText('线上团子')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: '服务人员', exact: true }).click();
  const restoredIdentity = page.getByLabel('体验服务人员身份');
  await expect(restoredIdentity).toHaveValue('provider-provider-application-1');
  await expect(page.getByText('线上团子')).toBeVisible();

  await page.getByRole('button', { name: '开始服务' }).click();
  await page.getByLabel('已完成喂食换水').check();
  await page.getByLabel('已清理宠物区域').check();
  await page.getByLabel('服务记录').fill('线上团子状态良好，已完成遛狗和清洁。');
  await page.getByRole('button', { name: '提交服务报告' }).click();

  await page.getByRole('button', { name: '宠主', exact: true }).click();
  await expect(page.getByText('线上团子 · 遛狗', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认完成' }).click();
  await expect(page.getByText('服务已完成', { exact: true })).toBeVisible();
});

test('restores the default provider identity after resetting the experience', async ({ page }) => {
  await page.goto('/?fixture=provider-onboarding');
  await page.getByRole('button', { name: '服务人员', exact: true }).click();
  const identity = page.getByLabel('体验服务人员身份');
  await identity.selectOption('provider-chen');
  await expect(identity).toHaveValue('provider-chen');

  await page.getByRole('button', { name: '清空演示数据' }).click();
  await page.getByRole('button', { name: '服务人员', exact: true }).click();
  await expect(page.getByLabel('体验服务人员身份')).toHaveValue('provider-wang');
});
