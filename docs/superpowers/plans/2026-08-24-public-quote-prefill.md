# Public Quote and Order Prefill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a truthful public experience quote that carries the selected service and district into the existing owner order form.

**Architecture:** A pure quote module owns supported options and price derivation, a controlled `PublicQuote` component renders the public interaction, and `DemoApp` coordinates the handoff to `OwnerWorkspace`. `OwnerWorkspace` applies only service and district when a new keyed prefill request arrives.

**Tech Stack:** React, TypeScript, Vitest, Playwright, Vite, CSS

## Global Constraints

- Cat feeding remains `¥32` and dog walking remains `¥37`, both labeled as experience reference prices.
- Supported experience districts remain `建邺区`, `鼓楼区`, `玄武区`, and `秦淮区`.
- Do not add real booking, payment, remote submission, contact collection, phone numbers, WeChat QR codes, analytics, geolocation, or formal coverage claims.
- Preserve the existing demo workflow, browser-local persistence, reset behavior, and direct landing CTA.
- Keep desktop and 390×844 mobile layouts free of horizontal overflow.

---

### Task 1: Typed Public Quote Model

**Files:**
- Create: `apps/admin/src/demo/publicQuote.ts`
- Test: `apps/admin/src/demo/publicQuote.test.ts`

**Interfaces:**
- Produces: `PUBLIC_DISTRICTS`, `PublicQuoteSelection`, `getPublicQuote(serviceType): { priceFen: number; priceLabel: string }`.
- Consumes: `ServiceType` from `workflow.ts`.

- [x] **Step 1: Write the failing model tests**

```ts
import { describe, expect, it } from 'vitest';
import { getPublicQuote, PUBLIC_DISTRICTS } from './publicQuote.js';

describe('public quote', () => {
  it('uses the existing demo prices', () => {
    expect(getPublicQuote('CAT_FEEDING')).toEqual({ priceFen: 3200, priceLabel: '¥32' });
    expect(getPublicQuote('DOG_WALKING')).toEqual({ priceFen: 3700, priceLabel: '¥37' });
  });

  it('offers only the four declared experience districts', () => {
    expect(PUBLIC_DISTRICTS).toEqual(['建邺区', '鼓楼区', '玄武区', '秦淮区']);
  });
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @pet/admin test -- src/demo/publicQuote.test.ts`

Expected: FAIL because `publicQuote.js` does not exist.

- [x] **Step 3: Implement the minimal typed model**

```ts
import type { ServiceType } from './workflow.js';

export const PUBLIC_DISTRICTS = ['建邺区', '鼓楼区', '玄武区', '秦淮区'] as const;
export type PublicDistrict = typeof PUBLIC_DISTRICTS[number];
export type PublicQuoteSelection = { serviceType: ServiceType; district: PublicDistrict };

const prices = {
  CAT_FEEDING: { priceFen: 3200, priceLabel: '¥32' },
  DOG_WALKING: { priceFen: 3700, priceLabel: '¥37' },
} as const;

export function getPublicQuote(serviceType: ServiceType) {
  return prices[serviceType];
}
```

- [x] **Step 4: Run the focused and admin tests**

Run: `pnpm --filter @pet/admin test -- src/demo/publicQuote.test.ts && pnpm --filter @pet/admin test`

Expected: 15 admin tests pass.

- [x] **Step 5: Commit**

```powershell
git add apps/admin/src/demo/publicQuote.ts apps/admin/src/demo/publicQuote.test.ts
git commit -m "feat: add public quote model"
```

### Task 2: Public Quote Panel

**Files:**
- Create: `apps/admin/src/demo/PublicQuote.tsx`
- Modify: `apps/admin/src/demo/PublicLanding.tsx`
- Modify: `apps/admin/src/styles.css`
- Test: `apps/admin/e2e/public-landing.spec.ts`

**Interfaces:**
- Consumes: `PublicQuoteSelection`, `PUBLIC_DISTRICTS`, and `getPublicQuote` from Task 1.
- Produces: controlled `PublicQuote({ selection, onChange, onStartOrder })` component.

- [x] **Step 1: Add a failing Playwright test for quote rendering and updates**

```ts
test('shows a transparent quote and updates the service price', async ({ page }) => {
  await page.goto('/?fixture=service-loop');
  const quote = page.getByRole('region', { name: '体验报价' });
  await expect(quote.getByText('¥32', { exact: true })).toBeVisible();
  await quote.getByLabel('服务类型').selectOption('DOG_WALKING');
  await expect(quote.getByText('¥37', { exact: true })).toBeVisible();
  await expect(quote.getByText('体验参考价，不会产生真实费用')).toBeVisible();
});
```

- [x] **Step 2: Run the focused E2E test and verify RED**

Run: `pnpm --filter @pet/admin test:e2e -- --grep "shows a transparent quote"`

Expected: FAIL because the `体验报价` region is absent.

- [x] **Step 3: Implement `PublicQuote` and render it from `PublicLanding`**

Create a controlled component with native service and district selects, a live price summary, the exact disclosure `体验参考价，不会产生真实费用`, and a `按此方案体验下单` button. Extend `PublicLandingProps` with the quote selection/change/start interfaces and render the component after the price grid.

- [x] **Step 4: Add responsive styles**

Add `.public-quote`, `.quote-controls`, `.quote-summary`, and `.quote-action` styles. Use a three-column desktop grid and collapse to one column inside the existing mobile media query. Maintain a minimum button height of `44px`.

- [x] **Step 5: Run the focused E2E test and verify GREEN**

Run: `pnpm --filter @pet/admin test:e2e -- --grep "shows a transparent quote"`

Expected: PASS.

- [x] **Step 6: Commit**

```powershell
git add apps/admin/src/demo/PublicQuote.tsx apps/admin/src/demo/PublicLanding.tsx apps/admin/src/styles.css apps/admin/e2e/public-landing.spec.ts
git commit -m "feat: add interactive public experience quote"
```

### Task 3: Quote-to-Order Prefill

**Files:**
- Modify: `apps/admin/src/demo/DemoApp.tsx`
- Modify: `apps/admin/src/demo/OwnerWorkspace.tsx`
- Test: `apps/admin/e2e/public-landing.spec.ts`

**Interfaces:**
- `DemoApp` produces `OrderPrefill = PublicQuoteSelection & { requestKey: number }`.
- `OwnerWorkspace` consumes optional `prefill?: OrderPrefill` and applies it when `requestKey` changes.

- [x] **Step 1: Add a failing Playwright prefill test**

```ts
test('carries the public quote into the owner order form', async ({ page }) => {
  await page.goto('/?fixture=service-loop');
  const quote = page.getByRole('region', { name: '体验报价' });
  await quote.getByLabel('服务类型').selectOption('DOG_WALKING');
  await quote.getByLabel('服务区域').selectOption('秦淮区');
  await quote.getByRole('button', { name: '按此方案体验下单' }).click();
  const form = page.locator('.order-form');
  await expect(form.getByLabel('服务类型')).toHaveValue('DOG_WALKING');
  await expect(form.getByLabel('服务区域')).toHaveValue('秦淮区');
  await expect(page.getByRole('button', { name: '宠主', exact: true })).toHaveClass(/active/);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @pet/admin test:e2e -- --grep "carries the public quote"`

Expected: FAIL because the quote action does not prefill the owner form.

- [x] **Step 3: Implement keyed prefill coordination**

In `DemoApp`, own `quoteSelection` and `orderPrefill`; increment `requestKey` on every quote action, then reuse the existing role switch and scroll behavior. Pass `orderPrefill` to `OwnerWorkspace`.

In `OwnerWorkspace`, add a `useEffect` keyed by `props.prefill?.requestKey` that updates only `serviceType` and `district`:

```ts
useEffect(() => {
  if (!props.prefill) return;
  setDraft((item) => ({
    ...item,
    serviceType: props.prefill!.serviceType,
    district: props.prefill!.district,
  }));
}, [props.prefill?.requestKey]);
```

- [x] **Step 4: Run focused and complete public landing E2E tests**

Run: `pnpm --filter @pet/admin test:e2e -- --grep "public quote|carries the public quote|landing page|pricing"`

Expected: all matching tests pass.

- [x] **Step 5: Commit**

```powershell
git add apps/admin/src/demo/DemoApp.tsx apps/admin/src/demo/OwnerWorkspace.tsx apps/admin/e2e/public-landing.spec.ts
git commit -m "feat: prefill orders from public quotes"
```

### Task 4: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-24-public-quote-prefill.md`

**Interfaces:**
- Consumes: the completed quote-to-order feature.
- Produces: user-facing scope documentation and completed plan checkboxes.

- [x] **Step 1: Document the public quote path**

Add a README bullet explaining that visitors can select a service and experience district, view a non-binding reference price, and carry those choices into the browser-local demo order form.

- [x] **Step 2: Run all verification under Node.js 22**

Run the repository's Node.js 22 runtime, then:

```powershell
pnpm --filter @pet/admin typecheck
pnpm test
pnpm --filter @pet/admin build
pnpm --filter @pet/admin test:e2e
```

Expected: typecheck passes, all Vitest tests pass, production build succeeds, and all Playwright tests pass.

- [x] **Step 3: Mark plan checkboxes complete and inspect the diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and only intended documentation changes remain.

- [x] **Step 4: Commit**

```powershell
git add README.md docs/superpowers/plans/2026-08-24-public-quote-prefill.md
git commit -m "docs: explain public quote experience"
```

- [ ] **Step 5: Push, open a pull request, merge, and verify deployment**

Push `feature/public-quote-prefill`, create a PR into `main`, merge after checks pass, wait for the Pages workflow, and verify HTTP 200 plus the quote-to-order interaction on the deployed URL.
