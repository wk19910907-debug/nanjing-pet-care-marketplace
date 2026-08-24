# Public Landing Conversion Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add truthful pricing, service scope, platform safeguards, FAQ, search metadata, and a working “立即体验下单” path to the public 南京安心宠 demo without adding contact details or real lead collection.

**Architecture:** A new presentational `PublicLanding` component owns all public product content and wraps the existing role workspace through `children`. `DemoApp` remains responsible for role and order state, and supplies one callback that selects the owner role and scrolls to the experience area. Playwright verifies metadata, content, conversion behavior, and responsive layout before the existing service-loop tests are rerun.

**Tech Stack:** React, TypeScript 5.9, Vite 8, CSS Grid, Playwright, Vitest, pnpm 10.15.0, Node.js 22

## Global Constraints

- Do not publish a WeChat QR code, phone number, form link, email address, or nonfunctional contact button.
- Use “体验参考价” for ¥32 cat feeding and ¥37 dog walking.
- Describe 建邺区、鼓楼区、玄武区、秦淮区 as demo areas, not active citywide coverage.
- State that the page is a demo, creates no real order, charges no fee, and stores order state only in the visitor's browser.
- Do not add analytics, cookies, a remote API, payments, SMS, maps, login, or new dependencies.
- Preserve the three-role service loop, `http://127.0.0.1:43123/`, and `https://wk19910907-debug.github.io/nanjing-pet-care-marketplace/`.
- New interactive controls must be at least 44px high and the 390×844 layout must have no horizontal overflow.

---

### Task 1: Add searchable and shareable page metadata

**Files:**
- Create: `apps/admin/e2e/public-landing.spec.ts`
- Modify: `apps/admin/index.html`

**Interfaces:**
- Produces: a stable title, search description, canonical URL, and Open Graph title/description/URL for the public page.
- Consumes: the fixed GitHub Pages URL; no runtime environment variable is needed.

- [ ] **Step 1: Write the failing metadata test**

Create `apps/admin/e2e/public-landing.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```powershell
pnpm --filter @pet/admin exec playwright test e2e/public-landing.spec.ts
```

Expected: FAIL because the current document has no title, description, canonical URL, or Open Graph metadata.

- [ ] **Step 3: Replace the minimal HTML document with metadata**

Replace `apps/admin/index.html` with:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>南京安心宠｜上门喂猫与遛狗平台体验</title>
    <meta
      name="description"
      content="南京上门喂猫与遛狗平台安全体验版：宠主提交需求，平台匹配服务人员并跟进履约报告。"
    />
    <link rel="canonical" href="https://wk19910907-debug.github.io/nanjing-pet-care-marketplace/" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="南京安心宠｜上门喂猫与遛狗平台体验" />
    <meta
      property="og:description"
      content="体验南京上门喂猫、遛狗的平台匹配与履约闭环。体验数据只保存在当前浏览器。"
    />
    <meta property="og:url" content="https://wk19910907-debug.github.io/nanjing-pet-care-marketplace/" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Run the focused metadata test**

Run:

```powershell
pnpm --filter @pet/admin exec playwright test e2e/public-landing.spec.ts
```

Expected: 1 Playwright test passes.

- [ ] **Step 5: Commit the metadata**

```powershell
git add apps/admin/index.html apps/admin/e2e/public-landing.spec.ts
git commit -m "feat: add public product metadata"
```

### Task 2: Add product information and the owner conversion path

**Files:**
- Modify: `apps/admin/e2e/public-landing.spec.ts`
- Create: `apps/admin/src/demo/PublicLanding.tsx`
- Modify: `apps/admin/src/demo/DemoApp.tsx`

**Interfaces:**
- Produces: `PublicLanding({ onStartOrder, children })` and a button named `立即体验下单`.
- Consumes: `onStartOrder(): void`; `DemoApp` changes the active role to `OWNER` and scrolls `#order-experience` into view.

- [ ] **Step 1: Add the failing content and conversion test**

Append to `apps/admin/e2e/public-landing.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run the focused tests and verify the content test fails**

Run:

```powershell
pnpm --filter @pet/admin exec playwright test e2e/public-landing.spec.ts
```

Expected: metadata test passes and content/conversion test fails because the landing sections and CTA do not exist.

- [ ] **Step 3: Create the presentational landing component**

Create `apps/admin/src/demo/PublicLanding.tsx`:

```tsx
import type { ReactNode } from 'react';

type PublicLandingProps = {
  children: ReactNode;
  onStartOrder: () => void;
};

const safeguards = [
  ['人员审核机制', '产品已设计资料审核与权限分级；公开体验使用演示人员。'],
  ['平台统一匹配', '宠主提交需求后，由平台视角选择合适人员，不公开联系方式。'],
  ['留痕服务报告', '服务清单、状态记录与宠主确认形成可回看的履约过程。'],
  ['异常订单处理', '产品已设计投诉冻结与退款流程；正式运营前仍需配备真实客服资源。'],
] as const;

export function PublicLanding({ children, onStartOrder }: PublicLandingProps) {
  return <>
    <section className="hero">
      <div>
        <span className="eyebrow">MANAGED PET CARE · NANJING</span>
        <h1>把每一次上门服务<br />交给平台认真匹配</h1>
        <p>宠主只需提交订单，平台负责匹配人员并跟进上门履约。当前为安全体验版，不产生真实订单或费用。</p>
        <button className="hero-cta" onClick={onStartOrder}>立即体验下单</button>
      </div>
      <div className="flow-card"><span>服务闭环</span><strong>下单 → 匹配 → 上门 → 报告 → 确认</strong></div>
    </section>

    <section className="landing-section" aria-labelledby="services-title">
      <span className="eyebrow">SERVICES & PRICING</span>
      <h2 id="services-title">两项核心服务，价格先说清楚</h2>
      <p className="section-lead">体验区域：建邺区、鼓楼区、玄武区、秦淮区。以下为体验参考价。</p>
      <div className="price-grid">
        <article className="price-card"><span>上门喂猫</span><strong>¥32</strong><small>体验参考价 / 次</small><p>喂食换水、清理宠物区域并提交服务记录。</p></article>
        <article className="price-card"><span>上门遛狗</span><strong>¥37</strong><small>体验参考价 / 次</small><p>按约定时段完成遛狗清单并提交状态报告。</p></article>
      </div>
    </section>

    <section className="landing-section safeguards" aria-labelledby="safeguards-title">
      <span className="eyebrow">PLATFORM SAFEGUARDS</span>
      <h2 id="safeguards-title">平台把匹配和履约过程管起来</h2>
      <div className="safeguard-grid">{safeguards.map(([title, copy]) => <article key={title}><strong>{title}</strong><p>{copy}</p></article>)}</div>
    </section>

    {children}

    <section className="landing-section faq" aria-labelledby="faq-title">
      <span className="eyebrow">FAQ</span>
      <h2 id="faq-title">常见问题</h2>
      <details><summary>现在提交的是真实订单吗？</summary><p>不是。公开页面用于体验产品闭环，不会通知服务人员，也不会产生费用。</p></details>
      <details><summary>体验数据保存在哪里？</summary><p>只保存在当前浏览器中，不会上传到远端服务器。</p></details>
      <details><summary>目前支持哪些区域？</summary><p>页面提供建邺区、鼓楼区、玄武区和秦淮区体验选项，不代表已经正式覆盖这些区域。</p></details>
      <details><summary>何时可以真实预约？</summary><p>正式运营还需完成真实人员审核、客服、支付、隐私合规与生产基础设施。</p></details>
    </section>
  </>;
}
```

- [ ] **Step 4: Compose the landing component around the existing workspace**

Replace `apps/admin/src/demo/DemoApp.tsx` with:

```tsx
import { useState } from 'react';
import { OperatorWorkspace } from './OperatorWorkspace.js';
import { OwnerWorkspace } from './OwnerWorkspace.js';
import { ProviderWorkspace } from './ProviderWorkspace.js';
import { PublicLanding } from './PublicLanding.js';
import { assignOrder, confirmOrder, createInitialState, createOrder, loadDemoState, saveDemoState, startService, submitReport, type DemoState, type OrderDraft, type ServiceReport } from './workflow.js';

type Role = 'OWNER' | 'OPERATOR' | 'PROVIDER';
export function DemoApp() {
  const fixture = new URLSearchParams(window.location.search).get('fixture');
  const [state, setState] = useState<DemoState>(() => fixture === 'service-loop' ? createInitialState() : loadDemoState(window.localStorage));
  const [role, setRole] = useState<Role>('OWNER');
  const [notice, setNotice] = useState('可以从宠主下单开始体验完整流程。');
  const apply = (operation: (current: DemoState) => DemoState, message: string) => { try { const next = operation(state); setState(next); saveDemoState(window.localStorage, next); setNotice(message); } catch (error) { setNotice(error instanceof Error ? error.message : '操作失败，请重试'); } };
  const reset = () => { const next = createInitialState(); setState(next); saveDemoState(window.localStorage, next); setRole('OWNER'); setNotice('体验数据已恢复。'); };
  const startOrderExperience = () => {
    setRole('OWNER');
    window.requestAnimationFrame(() => {
      document.getElementById('order-experience')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  return <div className="demo-shell"><header className="topbar"><div className="brand"><span className="brand-mark">宠</span><div><strong>南京安心宠</strong><small>上门喂猫 · 遛狗</small></div></div><div className="demo-badge">安全体验版</div></header>
    <PublicLanding onStartOrder={startOrderExperience}>
      <nav id="order-experience" className="role-tabs" aria-label="体验身份"><button className={role === 'OWNER' ? 'active' : ''} onClick={() => setRole('OWNER')}>宠主</button><button className={role === 'OPERATOR' ? 'active' : ''} onClick={() => setRole('OPERATOR')}>平台运营</button><button className={role === 'PROVIDER' ? 'active' : ''} onClick={() => setRole('PROVIDER')}>服务人员</button><button className="reset" onClick={reset}>恢复体验数据</button></nav>
      <div className="notice" role="status">{notice}</div><main className="demo-main">
        {role === 'OWNER' && <OwnerWorkspace state={state} create={(draft: OrderDraft) => apply((current) => createOrder(current, draft), '订单已提交，等待平台匹配。')} confirm={(id) => apply((current) => confirmOrder(current, id), '订单已确认完成。')}/>}
        {role === 'OPERATOR' && <OperatorWorkspace state={state} assign={(id, providerId) => apply((current) => assignOrder(current, id, providerId), '已完成匹配并通知服务人员。')}/>}
        {role === 'PROVIDER' && <ProviderWorkspace state={state} providerId="provider-wang" start={(id) => apply((current) => startService(current, id), '服务已开始，请完成清单。')} report={(id, report: ServiceReport) => apply((current) => submitReport(current, id, report), '报告已提交，等待宠主确认。')}/>}
      </main>
    </PublicLanding>
    <footer>体验数据只保存在当前浏览器 · 当前不承接真实订单 · 请勿填写真实门锁密码或敏感信息</footer></div>;
}
```

- [ ] **Step 5: Run the focused landing tests and typecheck**

Run:

```powershell
pnpm --filter @pet/admin exec playwright test e2e/public-landing.spec.ts
pnpm --filter @pet/admin typecheck
```

Expected: 2 Playwright tests pass and TypeScript exits with code 0.

- [ ] **Step 6: Commit content and conversion behavior**

```powershell
git add apps/admin/e2e/public-landing.spec.ts apps/admin/src/demo/PublicLanding.tsx apps/admin/src/demo/DemoApp.tsx
git commit -m "feat: add public service and trust content"
```

### Task 3: Add responsive visual hierarchy

**Files:**
- Modify: `apps/admin/e2e/public-landing.spec.ts`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: `.price-grid`, `.price-card`, `.safeguard-grid`, `.landing-section`, `.hero-cta`, and `.faq` markup from Task 2.
- Produces: two-column desktop price layout, one-column phone layout, 44px CTA, readable cards, and no horizontal overflow.

- [ ] **Step 1: Add the failing desktop layout test**

Append to `apps/admin/e2e/public-landing.spec.ts`:

```ts
test('lays out pricing side by side on desktop', async ({ page }) => {
  await page.goto('/?fixture=service-loop');
  const cards = page.locator('.price-card');
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
  await expect(page.getByRole('button', { name: '立即体验下单' })).toHaveCSS('min-height', '44px');
});
```

- [ ] **Step 2: Run the focused test and verify the layout test fails**

Run:

```powershell
pnpm --filter @pet/admin exec playwright test e2e/public-landing.spec.ts
```

Expected: metadata and content tests pass; desktop layout test fails because `.price-grid` has no two-column layout yet.

- [ ] **Step 3: Add landing and responsive styles**

Append these rules before the existing legacy console comment in `apps/admin/src/styles.css`:

```css
.hero-cta { margin-top: 12px; min-height: 44px; padding-inline: 24px; }
.landing-section { max-width: 1160px; margin: 0 auto; padding: 34px 24px; }
.landing-section h2 { margin: 8px 0 10px; font-size: clamp(26px, 4vw, 40px); }
.section-lead { margin: 0 0 22px; color: #60736b; }
.price-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.price-card { padding: 24px; border: 1px solid #dfe7df; border-radius: 20px; background: #fff; box-shadow: 0 14px 36px #173f330d; }
.price-card span,.price-card strong,.price-card small { display: block; }
.price-card span { font-weight: 900; }
.price-card strong { margin-top: 10px; color: #28634f; font-size: 36px; }
.price-card small { color: #9a681c; font-weight: 800; }
.price-card p,.safeguard-grid p,.faq p { color: #60736b; line-height: 1.7; }
.safeguards { padding-top: 46px; padding-bottom: 46px; }
.safeguard-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 22px; }
.safeguard-grid article { padding: 20px; border-radius: 16px; background: #dfe9d9; }
.safeguard-grid strong { display: block; margin-bottom: 8px; }
.faq { padding-top: 0; padding-bottom: 64px; }
.faq details { margin-top: 10px; padding: 16px 18px; border: 1px solid #dfe7df; border-radius: 14px; background: #fff; }
.faq summary { cursor: pointer; font-weight: 900; }
.faq p { margin-bottom: 0; }
```

Replace the existing `@media (max-width: 760px)` block with:

```css
@media (max-width: 760px) {
  .hero { grid-template-columns: 1fr; padding-top: 34px; }
  .hero h1 { letter-spacing: -1px; }
  .role-tabs { overflow-x: auto; }
  .role-tabs button { white-space: nowrap; }
  .role-tabs .reset { margin-left: 0; }
  .section-title { display: block; }
  .order-form,.match-panel,.summary-grid,.price-grid,.safeguard-grid { grid-template-columns: 1fr; }
  .workspace { padding: 20px; }
  .topbar { padding: 0 18px; }
  .demo-badge { font-size: 11px; }
  .landing-section { padding-top: 26px; padding-bottom: 26px; }
  .hero-cta { width: 100%; }
}
```

- [ ] **Step 4: Add and run the phone overflow test**

Append to `apps/admin/e2e/public-landing.spec.ts`:

```ts
test('keeps the landing page usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?fixture=service-loop');

  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);

  const cards = page.locator('.price-card');
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second!.y).toBeGreaterThan(first!.y + first!.height);
});
```

Run:

```powershell
pnpm --filter @pet/admin exec playwright test e2e/public-landing.spec.ts
```

Expected: all 4 public landing tests pass.

- [ ] **Step 5: Commit responsive presentation**

```powershell
git add apps/admin/e2e/public-landing.spec.ts apps/admin/src/styles.css
git commit -m "style: add responsive public landing sections"
```

### Task 4: Document and verify the complete product

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the live public URL and implemented landing sections.
- Produces: truthful repository documentation and complete local verification evidence.

- [ ] **Step 1: Document the public landing content**

Add this paragraph below the existing online-demo safety paragraph in `README.md`:

```markdown
公开页同时展示两项服务的体验参考价、南京体验区域、平台匹配与履约保障说明、常见问题，以及进入宠主下单体验的快捷入口。页面不提供联系方式，也不承接真实订单。
```

- [ ] **Step 2: Run all local checks with Node.js 22**

Run:

```powershell
$env:DATABASE_URL='postgresql://petcare:petcare@127.0.0.1:54329/petcare'
pnpm --filter @pet/admin typecheck
pnpm test
pnpm build
pnpm --filter @pet/admin test:e2e
```

Expected: typecheck passes, all 102 Vitest tests pass, production build succeeds, and all 6 Playwright tests pass (2 existing flows plus 4 public landing tests).

- [ ] **Step 3: Commit documentation**

```powershell
git add README.md
git commit -m "docs: explain public landing experience"
```

- [ ] **Step 4: Verify branch history and cleanliness**

Run:

```powershell
git diff --check origin/main...HEAD
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: no whitespace errors, no uncommitted files, and the design, plan, metadata, content, responsive presentation, and README commits are listed.

### Task 5: Publish and verify the updated landing page

**Files:**
- Modify after publication: `01-Projects/pet-home-service-platform/2026-08-23-implementation-progress.md` in the shared Obsidian Vault

**Interfaces:**
- Consumes: `feature/public-landing-conversion`, the existing Pages workflow, and the public GitHub Pages URL.
- Produces: a merged PR, a successful Pages deployment, verified desktop/mobile landing content, and an updated durable record.

- [ ] **Step 1: Push the branch**

```powershell
git push -u origin feature/public-landing-conversion
```

Expected: GitHub reports the new remote branch and compare URL.

- [ ] **Step 2: Create the landing PR**

Create a PR from `feature/public-landing-conversion` to `main` titled `feat: add public pet care landing experience`. The body must list the truthful pricing/scope content, trust explanations, FAQ, metadata, CTA behavior, and local verification. Obtain action-time confirmation immediately before publishing the PR.

- [ ] **Step 3: Merge after the PR is clean**

Verify the PR is conflict-free. Obtain action-time confirmation immediately before merging it into `main`.

- [ ] **Step 4: Wait for Pages deployment**

Monitor the `Deploy public demo` workflow triggered by the merge until both build and deploy jobs finish successfully.

- [ ] **Step 5: Verify the live desktop and phone experiences**

Open the live URL and confirm the title, prices, platform safeguards, FAQ, and CTA. At 390×844, confirm no horizontal overflow. Click the CTA and complete the existing service loop through owner confirmation, then reload and verify persistence.

- [ ] **Step 6: Update the durable record**

Record the PR URL, merge commit, workflow run, test totals, live verification date, and the explicit absence of contact details in the project progress note. Do not store browser data, tokens, cookies, or secrets.
