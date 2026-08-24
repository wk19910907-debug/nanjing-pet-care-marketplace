# Provider Application and Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-local provider application, platform approval, and matching-eligibility loop without collecting personal contact or identity data.

**Architecture:** Pure workflow functions own application validation, one-time approval, backward-compatible persistence, and matching eligibility. Focused provider and platform components render the two sides of the flow, while `DemoApp` applies and persists state transitions through its existing operation helper.

**Tech Stack:** React, TypeScript, Vitest, Playwright, Vite, CSS

## Global Constraints

- Collect only an experience nickname, one of `建邺区` / `鼓楼区` / `玄武区` / `秦淮区`, one or both core services, and a short experience description.
- Do not collect or imply collection of phone numbers, ID numbers, ID photos, certificates, background checks, bank details, contracts, or payment information.
- Pending applicants never enter `providers`; approval creates exactly one verified provider.
- Matching candidates must be verified and match both the order district and service type.
- Keep persisted state version `1` and load legacy state without `providerApplications` without losing orders.
- Preserve public pricing, quote prefill, reset, browser-local persistence, existing seeded providers, and the owner-to-confirmation flow.
- Desktop and 390×844 layouts must remain free of horizontal overflow with action targets at least 44 pixels high.

---

### Task 1: Provider Application Domain and Persistence

**Files:**
- Modify: `apps/admin/src/demo/workflow.ts`
- Test: `apps/admin/src/demo/workflow.test.ts`

**Interfaces:**
- Produces: `ProviderApplicationStatus`, `ProviderApplicationDraft`, `ProviderApplication`, `submitProviderApplication`, `approveProviderApplication`, and `eligibleProvidersForOrder`.
- Preserves: `DemoState.version === 1`, existing order interfaces, seeded providers, and storage key.

- [x] **Step 1: Add failing workflow tests**

Add focused tests that prove:

```ts
const application = {
  name: '小林',
  district: '秦淮区',
  services: ['DOG_WALKING'] as const,
  experience: '有两年养犬经验，熟悉牵引和基础清洁。',
};

it('keeps pending applicants out of matching until one-time approval', () => {
  let state = submitProviderApplication(createInitialState(), application);
  expect(state.providerApplications[0]).toMatchObject({ status: 'PENDING' });
  expect(state.providers.map((item) => item.name)).not.toContain('小林');

  state = approveProviderApplication(state, state.providerApplications[0]!.id);
  expect(state.providerApplications[0]).toMatchObject({ status: 'APPROVED' });
  expect(state.providers.at(-1)).toMatchObject({ name: '小林', district: '秦淮区', verified: true });
  expect(() => approveProviderApplication(state, state.providerApplications[0]!.id)).toThrow('申请已完成审核');
});

it('filters matching candidates by verified status, service and district', () => {
  let state = submitProviderApplication(createInitialState(), application);
  const orderState = createOrder(state, { ...draft, district: '秦淮区', serviceType: 'DOG_WALKING' });
  const order = orderState.orders.at(-1)!;
  expect(eligibleProvidersForOrder(orderState, order)).toEqual([]);
  state = approveProviderApplication(orderState, orderState.providerApplications[0]!.id);
  expect(eligibleProvidersForOrder(state, state.orders.at(-1)!).map((item) => item.name)).toEqual(['小林']);
  expect(() => assignOrder(state, order.id, 'provider-wang')).toThrow('服务人员不在订单服务区域');
});
```

Also test required fields, at least one valid service, duplicate name/district rejection, and legacy saved state normalization to `providerApplications: []`.

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @pet/admin test -- src/demo/workflow.test.ts`

Expected: FAIL because the new types/functions/state field do not exist.

- [x] **Step 3: Implement the minimal domain model and rules**

Add the specified types and `providerApplications` to `DemoState`. Initialize it to `[]`. Validate fixed districts and service types, trim strings, reject duplicates, create deterministic application/provider IDs, and enforce one-time approval.

Implement:

```ts
export function eligibleProvidersForOrder(state: DemoState, order: DemoOrder): DemoProvider[] {
  return state.providers.filter((provider) =>
    provider.verified
    && provider.district === order.district
    && provider.services.includes(order.serviceType));
}
```

Make `assignOrder` call this selector. Normalize legacy parsed state with `providerApplications: Array.isArray(parsed.providerApplications) ? parsed.providerApplications : []`.

- [x] **Step 4: Run focused and complete admin tests**

Run: `pnpm --filter @pet/admin test -- src/demo/workflow.test.ts && pnpm --filter @pet/admin test`

Expected: all new workflow tests and all existing admin tests pass.

- [x] **Step 5: Commit**

```powershell
git add apps/admin/src/demo/workflow.ts apps/admin/src/demo/workflow.test.ts
git commit -m "feat: add provider application workflow"
```

### Task 2: Provider Application Experience

**Files:**
- Create: `apps/admin/src/demo/ProviderApplicationPanel.tsx`
- Modify: `apps/admin/src/demo/ProviderWorkspace.tsx`
- Modify: `apps/admin/src/demo/DemoApp.tsx`
- Modify: `apps/admin/src/styles.css`
- Test: `apps/admin/e2e/provider-onboarding.spec.ts`

**Interfaces:**
- Consumes: `ProviderApplicationDraft`, `DemoState.providerApplications`, and `submitProviderApplication` from Task 1.
- Produces: `ProviderApplicationPanel({ applications, submit })` and a persisted application transition in `DemoApp`.

- [x] **Step 1: Add a failing provider-side Playwright test**

```ts
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
```

- [x] **Step 2: Run the focused E2E test and verify RED**

Run: `pnpm --filter @pet/admin test:e2e -- --grep "submits a safe provider application"`

Expected: FAIL because the application region is absent.

- [x] **Step 3: Implement the application panel and state integration**

The panel owns its draft form state, renders the four fixed district options and two service checkboxes, emits a `ProviderApplicationDraft`, resets only after successful submission, and lists applications newest-first with `待平台审核` or `审核通过 · 已进入匹配池`.

`ProviderWorkspace` renders the panel above the existing verified-provider task list. `DemoApp` passes an application callback that applies `submitProviderApplication` and shows `申请已提交，等待平台审核。`.

- [x] **Step 4: Add responsive styles and run GREEN**

Add `.provider-application`, `.application-form`, `.service-choice-group`, `.application-list`, and `.application-card` styles. Use two form columns on desktop, one column on mobile, and minimum 44-pixel primary actions.

Run: `pnpm --filter @pet/admin test:e2e -- --grep "submits a safe provider application"`

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add apps/admin/src/demo/ProviderApplicationPanel.tsx apps/admin/src/demo/ProviderWorkspace.tsx apps/admin/src/demo/DemoApp.tsx apps/admin/src/styles.css apps/admin/e2e/provider-onboarding.spec.ts
git commit -m "feat: add provider application experience"
```

### Task 3: Platform Review and Matching Eligibility

**Files:**
- Create: `apps/admin/src/demo/ProviderReviewQueue.tsx`
- Modify: `apps/admin/src/demo/OperatorWorkspace.tsx`
- Modify: `apps/admin/src/demo/DemoApp.tsx`
- Modify: `apps/admin/src/styles.css`
- Test: `apps/admin/e2e/provider-onboarding.spec.ts`

**Interfaces:**
- Consumes: applications, `approveProviderApplication`, and `eligibleProvidersForOrder` from Task 1.
- Produces: `ProviderReviewQueue({ applications, approve })`; provider approval callback from `DemoApp`; order dropdowns containing only eligible providers.

- [x] **Step 1: Add a failing end-to-end approval and matching test**

Extend the application setup from Task 2, then:

```ts
await page.getByRole('button', { name: '宠主', exact: true }).click();
// Submit a DOG_WALKING order in 秦淮区 through the existing form.
await page.getByRole('button', { name: '平台运营', exact: true }).click();
await expect(page.getByText('暂无符合区域和服务类型的已认证人员')).toBeVisible();
await page.getByRole('button', { name: '审核通过：小林' }).click();
await expect(page.getByText('审核通过 · 已进入匹配池')).toBeVisible();
await expect(page.getByLabel('匹配服务人员')).toContainText('小林 · 秦淮区 · 已认证');
```

Add a second order or selector assertion proving the approved Qinhuai dog walker does not appear for a Jianye cat-feeding order.

- [x] **Step 2: Run the focused E2E test and verify RED**

Run: `pnpm --filter @pet/admin test:e2e -- --grep "approves an applicant"`

Expected: FAIL because review and eligibility UI are absent.

- [x] **Step 3: Implement review queue and eligibility-aware matching**

Render `ProviderReviewQueue` before the order list. Pending cards show declared information and an `审核通过：{name}` button; approved cards show the approved state without another action.

For each waiting order, derive candidates using `eligibleProvidersForOrder`. When empty, render `暂无符合区域和服务类型的已认证人员` and no enabled match action. When populated, render only candidates and use the first eligible provider as the default.

`DemoApp` applies `approveProviderApplication` and displays `审核通过，申请人已进入匹配池。`.

- [x] **Step 4: Run focused and all provider onboarding E2E tests**

Run: `pnpm --filter @pet/admin test:e2e -- apps/admin/e2e/provider-onboarding.spec.ts`

Expected: provider application, pending exclusion, approval, eligible matching, and mismatched exclusion all pass.

- [x] **Step 5: Commit**

```powershell
git add apps/admin/src/demo/ProviderReviewQueue.tsx apps/admin/src/demo/OperatorWorkspace.tsx apps/admin/src/demo/DemoApp.tsx apps/admin/src/styles.css apps/admin/e2e/provider-onboarding.spec.ts
git commit -m "feat: review providers before order matching"
```

### Task 4: Documentation, Full Verification, and Deployment

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-24-provider-onboarding.md`

**Interfaces:**
- Consumes: completed provider application and review loop.
- Produces: accurate public-demo documentation and deployment evidence.

- [x] **Step 1: Document the supply-side demo boundary**

Add a README bullet describing application → platform review → eligible matching, and explicitly state that it is browser-local and accepts no real contact or identity documents.

- [x] **Step 2: Run full verification under Node.js 22.22.2**

Use a newly created temporary PostgreSQL database, apply all migrations, then run:

```powershell
pnpm --filter @pet/admin typecheck
pnpm test
pnpm --filter @pet/admin build
pnpm --filter @pet/admin test:e2e
git diff --check
```

Expected: all commands pass; delete only the temporary verification database afterward.

- [x] **Step 3: Complete plan checkboxes and commit documentation**

```powershell
git add README.md docs/superpowers/plans/2026-08-24-provider-onboarding.md
git commit -m "docs: explain provider onboarding demo"
```

- [ ] **Step 4: Push, create PR, merge, and verify Pages**

Push `feature/provider-onboarding`, create a PR into `main`, merge after final review, wait for the Pages workflow, then verify online application, pending exclusion, approval, and eligible matching. Keep the public page open for user acceptance.
