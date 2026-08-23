# Local Usable Pet Service Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a locally runnable web product and an importable WeChat mini program that complete the owner-to-platform-to-provider pet-service loop.

**Architecture:** A framework-independent demo workflow owns order state transitions and JSON persistence. The React/Vite app renders owner, operator, and provider workspaces over that workflow. The mini program mirrors the same transition rules using `wx` storage so it can be tested without external accounts or infrastructure.

**Tech Stack:** TypeScript 5.9, React, Vite, Vitest, Playwright, WeChat mini program APIs, pnpm 10, Node.js 22.

## Global Constraints

- Local experience mode must not require Docker, SMS, WeChat Pay, object storage, a domain, or a real mini program AppID.
- The state sequence is `WAITING_MATCH → WAITING_SERVICE → IN_SERVICE → WAITING_CONFIRMATION → COMPLETED`.
- Demo fixtures must not contain real phone numbers, access codes, payment credentials, or precise real-world addresses.
- Web data persists in `localStorage`; mini program data persists with `wx.setStorageSync`.
- Existing API/domain behavior and existing operator console tests must remain passing.

---

### Task 1: Web Demo Workflow

**Files:**
- Create: `apps/admin/src/demo/workflow.ts`
- Test: `apps/admin/src/demo/workflow.test.ts`

**Interfaces:**
- Produces: `DemoState`, `DemoOrder`, `createInitialState()`, `createOrder()`, `assignOrder()`, `startService()`, `submitReport()`, `confirmOrder()`.
- Consumes: no browser APIs; persistence is injected through `loadDemoState(storage)` and `saveDemoState(storage, state)`.

- [ ] **Step 1: Write failing state-transition tests**

```ts
it('moves an order through the managed service loop', () => {
  let state = createInitialState();
  state = createOrder(state, validDraft);
  const id = state.orders.at(-1)!.id;
  state = assignOrder(state, id, 'provider-wang');
  state = startService(state, id);
  state = submitReport(state, id, completedReport);
  state = confirmOrder(state, id);
  expect(state.orders.at(-1)!.status).toBe('COMPLETED');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @pet/admin test -- src/demo/workflow.test.ts`

Expected: FAIL because `./workflow.js` does not exist.

- [ ] **Step 3: Implement immutable transitions and storage parsing**

Each transition locates one order, validates its expected current state, returns a new state with an audit entry, and throws a Chinese error for an invalid action. `submitReport` requires all checklist items and non-empty notes. `loadDemoState` returns fixtures when storage is absent or malformed.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter @pet/admin test -- src/demo/workflow.test.ts`

Expected: all workflow tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src/demo/workflow.ts apps/admin/src/demo/workflow.test.ts
git commit -m "feat: add persistent demo service workflow"
```

### Task 2: Unified Local Web Product

**Files:**
- Create: `apps/admin/src/demo/DemoApp.tsx`
- Create: `apps/admin/src/demo/OwnerWorkspace.tsx`
- Create: `apps/admin/src/demo/OperatorWorkspace.tsx`
- Create: `apps/admin/src/demo/ProviderWorkspace.tsx`
- Modify: `apps/admin/src/main.tsx`
- Modify: `apps/admin/src/styles.css`
- Test: `apps/admin/e2e/service-loop.spec.ts`

**Interfaces:**
- Consumes: all Task 1 workflow operations.
- Produces: a single responsive page with role controls labeled `宠主`, `平台运营`, `服务人员`.

- [ ] **Step 1: Write a failing Playwright closure test**

```ts
test('owner, platform and provider complete one order', async ({ page }) => {
  await page.goto('/?fixture=service-loop');
  await page.getByRole('button', { name: '宠主' }).click();
  await page.getByLabel('宠物昵称').fill('团子');
  await page.getByLabel('详细地址').fill('测试小区 1 栋');
  await page.getByRole('button', { name: '提交订单' }).click();
  await page.getByRole('button', { name: '平台运营' }).click();
  await page.getByRole('button', { name: '确认匹配' }).click();
  await page.getByRole('button', { name: '服务人员' }).click();
  await page.getByRole('button', { name: '开始服务' }).click();
  await page.getByLabel('已完成喂食换水').check();
  await page.getByLabel('已清理宠物区域').check();
  await page.getByLabel('服务记录').fill('宠物状态良好，已完成服务。');
  await page.getByRole('button', { name: '提交服务报告' }).click();
  await page.getByRole('button', { name: '宠主' }).click();
  await page.getByRole('button', { name: '确认完成' }).click();
  await expect(page.getByText('已完成')).toBeVisible();
});
```

- [ ] **Step 2: Run Playwright and verify RED**

Run: `pnpm --filter @pet/admin test:e2e -- service-loop.spec.ts`

Expected: FAIL because the role controls and form do not exist.

- [ ] **Step 3: Build the minimal role workspaces**

`DemoApp` owns state, writes every change to storage, and displays a top progress strip. Owner fields are service type, pet name, district, address, time, and notes. Operator selects one of two verified providers. Provider starts service, completes two checklist items, and submits notes. Owner confirms the report. `?fixture=service-loop` resets deterministic test data.

- [ ] **Step 4: Add responsive product styling**

Use a green/cream/orange palette, 44px minimum action targets, mobile single-column layout below 760px, clear status chips, and an always-visible “本地体验模式” notice.

- [ ] **Step 5: Run unit, existing operator E2E, and new closure E2E tests**

Run: `pnpm --filter @pet/admin test && pnpm --filter @pet/admin test:e2e`

Expected: unit tests and both Playwright flows pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/admin/src apps/admin/e2e/service-loop.spec.ts
git commit -m "feat: add usable local pet service web loop"
```

### Task 3: Mini Program Experience Loop

**Files:**
- Create: `apps/miniprogram/demo/workflow.ts`
- Create: `apps/miniprogram/pages/home/index.ts`
- Create: `apps/miniprogram/pages/home/index.wxml`
- Create: `apps/miniprogram/pages/home/index.wxss`
- Create: `apps/miniprogram/pages/home/index.json`
- Create: `apps/miniprogram/project.config.json`
- Modify: `apps/miniprogram/app.json`
- Modify: `apps/miniprogram/platform.d.ts`
- Test: `apps/miniprogram/tests/demo-workflow.test.ts`

**Interfaces:**
- Produces: mini program workflow operations with the same status names and validation as Task 1.
- Consumes: `wx.getStorageSync`, `wx.setStorageSync`, `wx.navigateTo`, and `wx.showToast`.

- [ ] **Step 1: Write failing mini program workflow tests**

The test creates an order, assigns a provider, starts service, rejects an incomplete report, accepts a complete report, confirms the order, and reloads the final state from an in-memory storage adapter.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @pet/miniprogram test -- tests/demo-workflow.test.ts`

Expected: FAIL because `demo/workflow.ts` does not exist.

- [ ] **Step 3: Implement the mini program workflow and home page**

The home page provides three role cards, the current order, status progress, and role-valid actions. All form and button event handlers call the typed workflow module and refresh page data from storage.

- [ ] **Step 4: Add a tourist project configuration**

```json
{
  "description": "南京安心宠本地体验版",
  "compileType": "miniprogram",
  "miniprogramRoot": "./",
  "appid": "touristappid",
  "setting": { "es6": true, "minified": false, "urlCheck": false }
}
```

- [ ] **Step 5: Run mini program tests and typecheck**

Run: `pnpm --filter @pet/miniprogram test && pnpm --filter @pet/miniprogram typecheck`

Expected: all tests pass and TypeScript reports no errors.

- [ ] **Step 6: Commit**

```powershell
git add apps/miniprogram
git commit -m "feat: add local mini program service loop"
```

### Task 4: One-Command Delivery and Full Verification

**Files:**
- Create: `README.md`
- Modify: `package.json`
- Modify: `docs/operations/LOCAL.md`
- Modify: `C:/Users/Administrator/Documents/Obsidian Vault/01-Projects/pet-home-service-platform/2026-08-23-implementation-progress.md`

**Interfaces:**
- Produces: `pnpm dev` at `http://127.0.0.1:4173` and exact mini program import instructions.

- [ ] **Step 1: Add root launch commands**

`dev` runs `pnpm --filter @pet/admin dev --port 4173`; `build` runs the admin production build.

- [ ] **Step 2: Document the exact five-step user journey**

README includes Node 22 and pnpm 10 requirements, `pnpm install`, `pnpm dev`, the URL, role switching sequence, reset behavior, WeChat developer tool import path, and the distinction between experience mode and production integrations.

- [ ] **Step 3: Run fresh verification**

```powershell
pnpm check
pnpm build
pnpm --filter @pet/admin test:e2e
pnpm --filter @pet/miniprogram typecheck
git diff --check
```

Expected: every command exits 0, all tests pass, and `git diff --check` prints no output.

- [ ] **Step 4: Start the app and verify the page responds**

Run `pnpm dev`, open `http://127.0.0.1:4173`, and repeat the full Playwright role sequence against the live page.

- [ ] **Step 5: Commit**

```powershell
git add README.md package.json docs/operations/LOCAL.md
git commit -m "docs: add one-command local delivery"
```
