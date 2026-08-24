# 服务人员任务身份闭环实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让平台新审核并匹配的服务人员能在自己的体验身份下查看、履约并完成专属订单，同时在领域层阻止越权操作。

**Architecture:** 在现有 version-1 浏览器业务状态之上增加纯派生的服务人员身份选择，不新增持久化版本或真实认证数据。领域层通过 `preferredProviderId` 选择安全默认身份，并把 `providerId` 加入开始服务和提交报告接口；UI 用已认证人员选择器显式切换身份，平台匹配成功后自动选择被匹配人员。

**Tech Stack:** TypeScript 5.9、React 19、Vitest 3、Playwright、Vite 8、Node.js 22.22.2、pnpm 10.15.0。

## Global Constraints

- 公开体验必须继续标明不承接真实订单或费用，数据只保存在当前浏览器。
- 不新增真实账号、密码、手机号、微信登录、验证码、OAuth、身份证、证件照片、背景调查、合同、银行卡或支付字段。
- 保持 `DemoState.version === 1`、`nanjing-pet-care-demo-v1`、价格、四个南京区域、固定种子人员、报价预填和恢复体验行为不变。
- 服务人员只能操作 `order.providerId === providerId` 的订单；越权失败不得修改订单或审计记录。
- 身份选择器只列出已认证人员，平台匹配仍同时要求已认证、同区域和支持相同服务类型。
- 390×844 手机和 1440×900 桌面 populated 状态不得出现文档横向溢出；选择器和主要操作按钮高度不得低于 44px。
- 所有生产代码必须先有失败测试，确认预期失败后再写最小实现。
- 所有命令显式使用 Node.js `v22.22.2`；完整集成测试只能使用唯一命名的一次性 PostgreSQL 数据库，结束后验证数据库计数为 `0`。

---

### Task 1: 领域身份选择与履约授权

**Files:**
- Modify: `apps/admin/src/demo/workflow.ts`
- Modify: `apps/admin/src/demo/workflow.test.ts`
- Modify: `apps/admin/src/demo/DemoApp.tsx`

**Interfaces:**
- Consumes: `DemoState`, `DemoOrder`, `DemoProvider`, `ServiceReport`, existing order status machine.
- Produces: `preferredProviderId(state: DemoState, requestedProviderId?: string): string | undefined`.
- Produces: `startService(state: DemoState, orderId: string, providerId: string): DemoState`.
- Produces: `submitReport(state: DemoState, orderId: string, providerId: string, report: ServiceReport): DemoState`.

- [ ] **Step 1: Write failing domain tests**

Add focused tests to `workflow.test.ts` that express the exact selection and authorization rules:

```ts
it('selects an explicit verified provider before an active-task fallback', () => {
  let state = createOrder(createInitialState(), draft);
  state = assignOrder(state, state.orders[0]!.id, 'provider-wang');
  expect(preferredProviderId(state, 'provider-chen')).toBe('provider-chen');
});

it('selects the provider on the newest active order and safely falls back', () => {
  let state = createOrder(createInitialState(), draft);
  state = assignOrder(state, state.orders[0]!.id, 'provider-chen');
  expect(preferredProviderId(state)).toBe('provider-chen');
  expect(preferredProviderId(createInitialState())).toBe('provider-wang');
  expect(preferredProviderId({ ...createInitialState(), providers: [] })).toBeUndefined();
});

it('rejects another provider starting or reporting an assigned order without mutation', () => {
  let state = createOrder(createInitialState(), draft);
  state = assignOrder(state, state.orders[0]!.id, 'provider-wang');
  const before = structuredClone(state);
  expect(() => startService(state, state.orders[0]!.id, 'provider-chen')).toThrow('只能操作分配给自己的订单');
  expect(state).toEqual(before);
  state = startService(state, state.orders[0]!.id, 'provider-wang');
  const inService = structuredClone(state);
  expect(() => submitReport(state, state.orders[0]!.id, 'provider-chen', completeReport)).toThrow('只能操作分配给自己的订单');
  expect(state).toEqual(inService);
});
```

Update every existing `startService` and `submitReport` test call to pass the assigned provider ID explicitly. Keep the original state-transition and incomplete-report assertions.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
& 'C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64\node.exe' 'C:\Users\Administrator\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs' --filter @pet/admin exec vitest run src/demo/workflow.test.ts
```

Expected: fail because `preferredProviderId` is not exported and the existing fulfillment interfaces do not accept/enforce `providerId`.

- [ ] **Step 3: Implement the minimal domain behavior**

Add to `workflow.ts`:

```ts
const activeProviderStatuses: DemoStatus[] = ['WAITING_SERVICE', 'IN_SERVICE', 'WAITING_CONFIRMATION'];

export function preferredProviderId(state: DemoState, requestedProviderId?: string): string | undefined {
  if (requestedProviderId && state.providers.some((provider) => provider.id === requestedProviderId && provider.verified)) {
    return requestedProviderId;
  }
  const activeOrder = [...state.orders].reverse().find((order) =>
    order.providerId
    && activeProviderStatuses.includes(order.status)
    && state.providers.some((provider) => provider.id === order.providerId && provider.verified));
  if (activeOrder?.providerId) return activeOrder.providerId;
  if (state.providers.some((provider) => provider.id === 'provider-wang' && provider.verified)) return 'provider-wang';
  return state.providers.find((provider) => provider.verified)?.id;
}

function requireAssignedProvider(state: DemoState, order: DemoOrder, providerId: string): void {
  const provider = state.providers.find((item) => item.id === providerId && item.verified);
  if (!provider) throw new Error('请选择已认证服务人员');
  if (order.providerId !== providerId) throw new Error('只能操作分配给自己的订单');
}
```

Change `startService` and `submitReport` to call `requireAssignedProvider` before changing state. Update `DemoApp` temporarily to pass `'provider-wang'` at both existing callback call sites so TypeScript remains green; Task 2 replaces these fixed arguments with the selected identity.

- [ ] **Step 4: Verify GREEN and regression coverage**

Run the focused test again, then:

```powershell
& 'C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64\node.exe' 'C:\Users\Administrator\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs' --filter @pet/admin test
& 'C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64\node.exe' 'C:\Users\Administrator\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs' --filter @pet/admin typecheck
git diff --check
```

Expected: all admin unit tests and typecheck pass; no whitespace errors.

- [ ] **Step 5: Commit Task 1**

```powershell
git add apps/admin/src/demo/workflow.ts apps/admin/src/demo/workflow.test.ts apps/admin/src/demo/DemoApp.tsx
git commit -m "feat: authorize provider task actions"
```

---

### Task 2: 已认证人员选择器与自动任务身份

**Files:**
- Modify: `apps/admin/src/demo/ProviderWorkspace.tsx`
- Modify: `apps/admin/src/demo/DemoApp.tsx`
- Modify: `apps/admin/src/styles.css`
- Create: `apps/admin/e2e/provider-task-identity.spec.ts`
- Modify: `apps/admin/e2e/provider-onboarding.spec.ts`

**Interfaces:**
- Consumes: Task 1 `preferredProviderId`, authorized `startService` and `submitReport` signatures.
- Produces: `ProviderWorkspace` props `providerId?: string`, `selectProvider(providerId: string): void`, `start(orderId: string, providerId: string): void`, `report(orderId: string, providerId: string, report: ServiceReport): void`.
- Produces: browser flow where platform assignment selects the matched provider identity and reload derives the provider on the newest active order.

- [ ] **Step 1: Write the failing browser identity flow**

Create `provider-task-identity.spec.ts`. Use a clean browser context at `/` rather than a fixture query so reload exercises local persistence. The test must:

```ts
test('lets the matched approved provider complete only their own task after reload', async ({ page }) => {
  await page.goto('/');
  // Submit 体验小林 / 秦淮区 / DOG_WALKING application.
  // Create 线上团子 / 秦淮区 / DOG_WALKING order.
  // In operator view approve the application and assign 体验小林.
  // Enter provider view and expect 身份 selector value to be the approved provider ID option text.
  // Expect 线上团子 visible; switch to 王小宁 and expect 线上团子 hidden; switch back.
  // Reload, re-enter provider view, and expect 体验小林 selected with 线上团子 visible.
  // Start service, complete both checklist controls, enter a report, and submit.
  // Switch to owner and confirm 线上团子; expect 服务已完成.
});
```

Add assertions using accessible names, not CSS-only selection, for `体验服务人员身份`, `开始服务`, `提交服务报告`, and `确认完成`.

Extend `provider-onboarding.spec.ts` populated mobile and desktop paths so the approved and matched provider identity selector is visible, its height is at least 44px, and document width never exceeds viewport width.

- [ ] **Step 2: Run the new browser test and verify RED**

Run:

```powershell
& 'C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64\node.exe' 'C:\Users\Administrator\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs' --filter @pet/admin exec playwright test e2e/provider-task-identity.spec.ts
```

Expected: fail because the identity selector is absent and provider view remains fixed to 王小宁.

- [ ] **Step 3: Implement the provider identity UI**

In `ProviderWorkspace.tsx`, resolve the current provider and render a labeled selector:

```tsx
const provider = props.state.providers.find((item) => item.id === props.providerId && item.verified);
const tasks = provider ? props.state.orders.filter((item) => item.providerId === provider.id) : [];

<label className="provider-identity-control">
  体验服务人员身份
  <select
    value={provider?.id ?? ''}
    disabled={props.state.providers.length === 0}
    onChange={(event) => props.selectProvider(event.target.value)}
  >
    {props.state.providers.map((item) => (
      <option key={item.id} value={item.id}>{item.name} · {item.district} · 已认证</option>
    ))}
  </select>
</label>
```

Render `当前身份：${provider.name} · ${provider.district} · 已认证` and the provider service labels. If `provider` is absent, render `暂无可用的已认证体验身份。` and no task actions. Pass `provider.id` in every start/report callback.

In `DemoApp.tsx`:

```tsx
const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(() => preferredProviderId(state));

const showProvider = () => {
  setSelectedProviderId(preferredProviderId(state, selectedProviderId));
  setRole('PROVIDER');
};
```

Use `showProvider` for the role button. When assignment succeeds, call `setSelectedProviderId(providerId)`. Pass the selected ID and setter into `ProviderWorkspace`; call Task 1 functions with the provider ID supplied by the workspace.

Add focused styles for the identity control, summary and mobile stacking. Preserve the global minimum 44px input/button rule and existing breakpoints.

- [ ] **Step 4: Verify GREEN, reload, responsive and legacy flows**

Run:

```powershell
& 'C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64\node.exe' 'C:\Users\Administrator\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs' --filter @pet/admin exec playwright test e2e/provider-task-identity.spec.ts e2e/provider-onboarding.spec.ts
& 'C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64\node.exe' 'C:\Users\Administrator\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs' --filter @pet/admin test
& 'C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64\node.exe' 'C:\Users\Administrator\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs' --filter @pet/admin typecheck
git diff --check
```

Expected: identity and onboarding E2E pass, admin tests/typecheck pass, and no whitespace errors.

- [ ] **Step 5: Commit Task 2**

```powershell
git add apps/admin/src/demo/ProviderWorkspace.tsx apps/admin/src/demo/DemoApp.tsx apps/admin/src/styles.css apps/admin/e2e/provider-task-identity.spec.ts apps/admin/e2e/provider-onboarding.spec.ts
git commit -m "feat: switch provider task identities"
```

---

### Task 3: 交付说明与最终验证

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-24-provider-task-identity.md`
- Modify outside repository after deployment: `01-Projects/pet-home-service-platform/2026-08-23-implementation-progress.md`

**Interfaces:**
- Consumes: completed Task 1 and Task 2 behavior.
- Produces: honest public documentation, complete Node 22 evidence, GitHub PR/Pages links and online acceptance record.

- [ ] **Step 1: Update truthful usage documentation**

Add one README bullet after the provider onboarding description:

```md
- 平台匹配后，服务人员体验页会切换到被匹配的已认证人员；也可在已认证体验身份间切换。每个身份只能开始和提交属于自己的订单，刷新后会优先恢复有进行中任务的人员。
```

Keep the existing browser-local and no-real-contact boundary unchanged.

- [ ] **Step 2: Run complete isolated verification**

Generate a unique database name matching `^petcare_verify_[a-z0-9_]+$`, create only that database in `petcare-postgres`, set `DATABASE_URL` to it, apply all Prisma migrations, and run under Node 22.22.2:

```powershell
pnpm check
pnpm build
pnpm --filter @pet/admin test:e2e
git diff --check
```

Use the explicit Node 22 executable and pnpm JavaScript entry point from earlier tasks. In `finally`, execute `DROP DATABASE "<validated-name>" WITH (FORCE)` and query `pg_database`; expected remaining count is `0`. Never modify or drop the existing `petcare` database.

- [ ] **Step 3: Mark local plan steps complete and commit**

Check Tasks 1–2 and Task 3 local steps 1–2 only after their commands pass. Leave the external deployment step unchecked until live acceptance succeeds.

```powershell
git add README.md docs/superpowers/plans/2026-08-24-provider-task-identity.md
git commit -m "docs: explain provider task identities"
```

- [ ] **Step 4: Review, publish and verify online**

Request a whole-branch review from the merge base through HEAD. Resolve every Critical and Important finding and re-run covering tests. Then push `feature/provider-task-identity`, create a PR into `main`, merge using the already-authorized publish workflow, and wait for `Deploy public demo` to complete successfully.

On the public GitHub Pages site, perform this exact acceptance flow with generated demo-only data:

1. submit and approve `身份验收小林` for 秦淮区 / 上门遛狗;
2. create and match `身份验收团子` for 秦淮区 / 上门遛狗;
3. enter provider view and verify the selected option is `身份验收小林 · 秦淮区 · 已认证`;
4. switch to 王小宁 and verify the order is hidden, then switch back;
5. reload and verify the active order restores 身份验收小林;
6. start service, complete both checklist items, submit `线上身份闭环验收通过`;
7. switch to owner, confirm the order and verify `服务已完成`;
8. verify no identity selector or application field asks for real contact, identity, contract, bank or payment data.

Mark the public site tab as the deliverable. Append PR URL, merge SHA, workflow URL, test totals and acceptance result to the durable project note.
