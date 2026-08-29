# Formal Owner and Public Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the public landing page and authenticated owner experience into a warm, trustworthy, booking-first interface while preserving the real API-backed order lifecycle.

**Architecture:** Keep public marketing content in `demo/PublicLanding`, authenticated role routing in `pilot/PilotApp`, and owner booking state in focused owner components. Condense the visible booking journey to three stages while continuing to create pets and addresses through existing APIs before requesting a server quote and order.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, Playwright, CSS.

## Global Constraints

- Keep the brand name “南京安心宠” and use the approved A “可信服务型” visual direction.
- Only offer 上门喂猫 and 上门遛狗; owners submit requests and the platform matches providers.
- Prices remain “¥32 起” and “¥37 起”; final prices and statuses come from the server.
- Do not claim online payments, insurance, public phone support, full-Nanjing coverage, or fabricated operating metrics.
- Mobile acceptance viewport is 390×844; primary controls must be at least 44px high and the page must not scroll horizontally.
- Do not change provider/admin workflows, quote rules, matching rules, or the fulfillment state machine.

---

### Task 1: Public Website Conversion Experience

**Files:**
- Modify: `apps/admin/src/demo/PublicLanding.tsx`
- Modify: `apps/admin/src/demo/DemoApp.tsx`
- Modify: `apps/admin/index.html`
- Test: `apps/admin/src/demo/DemoApp.test.tsx`

**Interfaces:**
- Consumes: `PublicQuoteSelection`, `onStartOrder(): void`, `onQuoteStartOrder(): void`.
- Produces: service cards and hero actions that call the existing callbacks without accessing protected order data.

- [ ] **Step 1: Write failing public-page assertions**

Add assertions that the rendered page contains the heading `出门放心，宠物在家也被认真照顾`, a button named `立即预约`, both `¥32 起` and `¥37 起`, and the truthful safeguards `身份资料审核`, `平台统一匹配`, `订单状态可查`, and `服务过程留痕`. Assert that `/体验|演示人员|不会上传到远端服务器/` is absent from the public hero.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @pet/admin test -- src/demo/DemoApp.test.tsx`

Expected: FAIL because the old hero says `立即体验下单` and renders the safety-demo copy.

- [ ] **Step 3: Implement the approved public structure**

Change `PublicLanding` to render, in order: branded navigation, booking-first hero, two service cards, four-step process, four truthful safeguard cards, the existing public quote panel, existing children, FAQ, and footer-safe operating limitations. Each service action must set or preserve the associated `PublicQuoteSelection` and call the existing order callback; it must not create local prices or order state.

Update `DemoApp` footer to say `服务范围与接单时间以平台确认为准 · 请勿填写门锁密码等敏感信息`. Update title and description metadata in `index.html` to describe a南京上门喂猫与遛狗预约平台 without “体验版”.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @pet/admin test -- src/demo/DemoApp.test.tsx src/demo/publicQuote.test.ts`

Expected: PASS with the existing quote-selection behavior intact.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/demo/PublicLanding.tsx apps/admin/src/demo/DemoApp.tsx apps/admin/index.html apps/admin/src/demo/DemoApp.test.tsx
git commit -m "feat: refresh public booking experience"
```

### Task 2: Formal Authenticated Shell and Owner Home

**Files:**
- Modify: `apps/admin/src/pilot/PilotApp.tsx`
- Modify: `apps/admin/src/pilot/LoginPanel.tsx`
- Modify: `apps/admin/src/pilot/owner/OwnerHome.tsx`
- Test: `apps/admin/src/pilot/PilotApp.test.tsx`
- Test: `apps/admin/src/pilot/owner/OwnerHome.test.tsx`

**Interfaces:**
- Consumes: authenticated `PilotSession`, `OwnerOrder[]`, and `onBook(serviceType)`.
- Produces: a role-safe shell and owner homepage; provider and admin workspace selection remains unchanged.

- [ ] **Step 1: Write failing shell and owner-home assertions**

Change tests to expect `南京 · 今日可预约`, `今天需要照顾谁？`, `身份审核`, `服务留痕`, and `平台匹配`. Assert that the authenticated owner page does not contain `本地试运营`, `宠主工作区`, or `刷新全部`. Keep the assertion that clicking `预约上门遛狗` calls `onBook('DOG_WALKING')`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @pet/admin test -- src/pilot/PilotApp.test.tsx src/pilot/owner/OwnerHome.test.tsx`

Expected: FAIL on the new formal-operating copy and the absence checks.

- [ ] **Step 3: Implement formal shell and home semantics**

Replace the authenticated header badge with `南京 · 上门宠物照护`; preserve the display name, role label, logout control, and role routing. Update `LoginPanel` to use customer-facing login copy without “试运营”. Update `OwnerHome` hero, trust strip, service cards, active-order summary, account label, and bottom navigation so it exposes only 首页、订单、我的. Keep all status labels bound to `OwnerOrder.status` and all displayed totals bound to `totalFen`.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @pet/admin test -- src/pilot/PilotApp.test.tsx src/pilot/owner/OwnerHome.test.tsx`

Expected: PASS; role routing and owner actions remain operational.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pilot/PilotApp.tsx apps/admin/src/pilot/LoginPanel.tsx apps/admin/src/pilot/owner/OwnerHome.tsx apps/admin/src/pilot/PilotApp.test.tsx apps/admin/src/pilot/owner/OwnerHome.test.tsx
git commit -m "feat: formalize owner home experience"
```

### Task 3: Three-Stage Owner Booking Flow

**Files:**
- Modify: `apps/admin/src/pilot/owner/booking.ts`
- Modify: `apps/admin/src/pilot/owner/BookingFlow.tsx`
- Test: `apps/admin/src/pilot/owner/booking.test.ts`
- Test: `apps/admin/src/pilot/owner/BookingFlow.test.tsx`

**Interfaces:**
- Produces: `BookingStep = 'SERVICE_TIME' | 'VISIT_INFO' | 'CONFIRM'` and the existing `BookingDraft` fields used by `OwnerPilotWorkspace`.
- Consumes: existing pet/address collections plus `onPrepareQuote`, `onSubmitOrder`, `onAbandonQuote`, and `onClose` callbacks.

- [ ] **Step 1: Write failing booking-state tests**

Assert that `createBookingDraft('DOG_WALKING').step` is `SERVICE_TIME`; `nextBookingStep` stays on `SERVICE_TIME` until `startsAt` is valid; `VISIT_INFO` requires both a valid compatible pet selection/new pet name and an existing/new address; and `previousBookingStep('CONFIRM')` returns `VISIT_INFO`.

- [ ] **Step 2: Run state tests and verify failure**

Run: `pnpm --filter @pet/admin test -- src/pilot/owner/booking.test.ts`

Expected: FAIL because the current type exposes five separate steps.

- [ ] **Step 3: Implement the three-stage state machine**

Set `BookingStep` to `SERVICE_TIME | VISIT_INFO | CONFIRM`. `bookingStepIsComplete` must validate service time in the first stage, both pet and address inputs in the second, and the server-prepared IDs plus valid time in confirmation. Preserve service switching behavior that clears an incompatible pet.

- [ ] **Step 4: Write failing component assertions**

Assert the progress list contains exactly `服务与时间`, `上门信息`, and `确认预约`; selecting an existing pet and address in the second stage enables `获取服务报价`; confirmation displays the server total and `确认提交订单`; optional notes remain collapsed by default.

- [ ] **Step 5: Implement the three visible stages**

Combine service radio cards, datetime, and duration in `SERVICE_TIME`. Combine compatible pet selection/new pet fields and existing/new address fields in `VISIT_INFO`. Keep server quote, operating limitation, optional order notes, submission lock, retry, and abandonment behavior in `CONFIRM`. Keep all controls disabled during quote/submission and preserve the draft when moving backward.

- [ ] **Step 6: Run booking tests**

Run: `pnpm --filter @pet/admin test -- src/pilot/owner/booking.test.ts src/pilot/owner/BookingFlow.test.tsx`

Expected: PASS with three progress stages and existing API callbacks.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/pilot/owner/booking.ts apps/admin/src/pilot/owner/BookingFlow.tsx apps/admin/src/pilot/owner/booking.test.ts apps/admin/src/pilot/owner/BookingFlow.test.tsx
git commit -m "feat: simplify owner booking to three stages"
```

### Task 4: Approved A Visual System and Responsive QA

**Files:**
- Modify: `apps/admin/src/styles.css`
- Modify: `apps/admin/e2e/pilot-live.spec.ts`
- Test: `apps/admin/src/styles.test.ts`

**Interfaces:**
- Consumes: semantic class names from Tasks 1–3.
- Produces: warm coral/cream tokens, responsive public/owner layouts, focus states, and reduced-motion behavior.

- [ ] **Step 1: Add failing style-contract tests**

Assert `styles.css` defines the brand custom properties `--brand-coral`, `--brand-cream`, and `--brand-ink`; contains `@media (max-width: 640px)` and `@media (prefers-reduced-motion: reduce)`; and gives primary booking buttons `min-height: 44px`.

- [ ] **Step 2: Run the style test and verify failure**

Run: `pnpm --filter @pet/admin test -- src/styles.test.ts`

Expected: FAIL until the approved tokens and responsive contracts exist.

- [ ] **Step 3: Implement the visual system**

Refactor the affected public and owner selectors around a warm-white page background, dark-brown copy, coral primary actions, soft peach surfaces, 16–24px radii, restrained shadows, visible `:focus-visible` outlines, mobile stacking, and a three-item sticky owner navigation. Preserve admin/provider selectors not involved in the redesign.

- [ ] **Step 4: Extend browser acceptance**

In `pilot-live.spec.ts`, exercise login, owner home, three-stage booking, server quote, order submission, and the resulting active-order card. Add a 390×844 viewport assertion that `document.documentElement.scrollWidth <= window.innerWidth` and that the primary action bounding box height is at least 44.

- [ ] **Step 5: Run complete verification**

Run: `pnpm check`

Expected: all lint, typecheck, and Vitest suites PASS.

Run: `pnpm pilot:build`

Expected: production pilot bundle builds successfully.

Run against the active local API: `pnpm test:e2e:live`

Expected: the real login, quote, order, matching, fulfillment, report, and owner confirmation flow passes without fabricated browser state.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/styles.css apps/admin/src/styles.test.ts apps/admin/e2e/pilot-live.spec.ts
git commit -m "feat: apply trusted service visual system"
```

### Task 5: Final Documentation and Operational Handoff

**Files:**
- Modify: `README.md`
- Modify: `C:/Users/Administrator/Documents/Obsidian Vault/01-Projects/pet-home-service-platform/2026-08-23-implementation-progress.md`

**Interfaces:**
- Consumes: verified commands and actual operating limitations from Tasks 1–4.
- Produces: reproducible local startup and acceptance instructions without credentials or secrets.

- [ ] **Step 1: Update run and acceptance documentation**

Document `start-local.cmd`, the public/owner URLs, owner booking acceptance path, and the verified commands. State explicitly that online payment and public phone/WeChat contact are not connected.

- [ ] **Step 2: Verify documentation against scripts**

Run: `pnpm --filter @pet/admin build --mode pilot`

Expected: PASS using the documented workspace and Node 22 toolchain.

- [ ] **Step 3: Commit repository documentation**

```bash
git add README.md
git commit -m "docs: update formal operations handoff"
```

- [ ] **Step 4: Record durable Vault summary**

Append the selected A direction, implementation commits, verification evidence, and remaining production dependencies to `01-Projects/pet-home-service-platform/2026-08-23-implementation-progress.md`. Do not store tokens, passwords, cookies, or `.env` contents.
