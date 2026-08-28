# Owner Lightweight Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the owner-facing workspace form wall with a mobile-first service home and a four-step booking flow while preserving the existing authenticated API, server quote, idempotent order creation, evidence review, and confirmation behavior.

**Architecture:** Keep `OwnerPilotWorkspace` as the data/mutation controller and move consumer-facing presentation into focused owner components. Add a small pure booking-state module, progressively create or select pet/address resources inside the flow, and extend the owner-safe order read model with pet names so the active order card remains useful after refresh.

**Tech Stack:** React 19, TypeScript 5.9, Vite, Vitest, Testing Library, Playwright, Fastify, Prisma 6, PostgreSQL 16, CSS.

## Global Constraints

- Scope is the OWNER experience only; provider and admin workspaces keep their behavior.
- The first owner screen contains no empty pet, address, quote, or order form.
- Services remain `CAT_FEEDING` and `DOG_WALKING`; starting copy remains ¥32 and ¥37 respectively, while the authoritative total always comes from `POST /api/v1/quotes`.
- City is fixed to `南京市`; supported districts remain 建邺区、鼓楼区、玄武区、秦淮区.
- Provider selection remains platform-managed; do not add provider search or selection.
- Do not add search, community, shop, messages, membership, coupons, online payment, phone collection, or WeChat QR collection.
- Optional pet care notes and order notes start collapsed and do not block progress.
- 390×844 must have no horizontal overflow and all visible buttons, inputs, selects, and textareas must be at least 44px high.
- Preserve the existing lost-response retry contract: the complete order payload and idempotency key are frozen across retries.
- Preserve evidence authorization and keep confirmation disabled until every required evidence image has loaded successfully.

---

### Task 1: Add pet names to the owner-safe order read model

**Files:**
- Modify: `apps/api/src/pilot/pilot-read-model.ts`
- Modify: `apps/api/tests/pilot-business-routes.test.ts`
- Modify: `apps/admin/src/pilot/models.ts`
- Modify: `apps/admin/src/pilot/api.ts`
- Modify: `apps/admin/src/pilot/api.test.ts`

**Interfaces:**
- Produces: `OwnerOrder.petNames?: string[]` in the browser contract.
- Produces: `PilotOrderSummary.petNames?: string[]`, returned only to the order owner.
- Preserves: provider invitation and assigned-provider response key sets.

- [ ] **Step 1: Write failing read-model and parser tests**

Add an owner assertion beside the existing owner/admin/provider privacy assertions:

```ts
expect(ownerView).toMatchObject({
  notes: '只喂指定猫粮',
  petNames: ['宠物甲'],
});
expect(assignedProviderView).not.toHaveProperty('petNames');
```

Add a browser parser test that accepts a bounded array and rejects malformed content:

```ts
await expect(api.listOrders()).resolves.toEqual([
  expect.objectContaining({ petNames: ['团子'] }),
]);

fetcher.mockResolvedValueOnce(ok([{ ...validOrder, petNames: [''] }]));
await expect(api.listOrders()).rejects.toThrow('服务返回了无法识别的数据');
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
pnpm --filter @pet/api test -- pilot-business-routes.test.ts
pnpm --filter @pet/admin test -- api.test.ts
```

Expected: FAIL because owner order summaries and `parseOrder` do not expose `petNames`.

- [ ] **Step 3: Extend the safe include and response types**

Add the relation to `ORDER_INCLUDE`:

```ts
pets: {
  select: { pet: { select: { name: true } } },
  orderBy: { petId: 'asc' as const },
},
```

Add the optional owner-only field:

```ts
petNames?: string[];

// inside toSummary's returned object
...(isOwner ? { petNames: record.pets.map(({ pet }) => pet.name) } : {}),
```

Mirror the contract in `models.ts`:

```ts
petNames?: string[];
```

Parse only one to five non-empty names of at most 50 characters:

```ts
function parsePetNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) invalidResponse();
  return value.map((name) => {
    if (typeof name !== 'string' || name.trim().length < 1 || name.length > 50) invalidResponse();
    return name;
  });
}

// inside parseOrder
...(record.petNames !== undefined ? { petNames: parsePetNames(record.petNames) } : {}),
```

- [ ] **Step 4: Run focused tests and verify pass**

Run the commands from Step 2.

Expected: both test files PASS; existing provider key-set privacy assertions remain green.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/pilot/pilot-read-model.ts apps/api/tests/pilot-business-routes.test.ts apps/admin/src/pilot/models.ts apps/admin/src/pilot/api.ts apps/admin/src/pilot/api.test.ts
git commit -m "feat: include pet names in owner order summaries"
```

---

### Task 2: Introduce a pure four-step booking state model

**Files:**
- Create: `apps/admin/src/pilot/owner/booking.ts`
- Create: `apps/admin/src/pilot/owner/booking.test.ts`

**Interfaces:**
- Produces: `BookingStep`, `BookingDraft`, `createBookingDraft`, `bookingStepIsComplete`, `nextBookingStep`, and `previousBookingStep`.
- Consumes: `OwnerPet['species']` and `ServiceType` from `../models.js`.

- [ ] **Step 1: Write failing pure-state tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  bookingStepIsComplete,
  createBookingDraft,
  nextBookingStep,
  previousBookingStep,
} from './booking.js';

describe('owner booking state', () => {
  it('prefills the selected service and starts at service selection', () => {
    expect(createBookingDraft('DOG_WALKING')).toMatchObject({
      step: 'SERVICE', serviceType: 'DOG_WALKING', petSpecies: 'DOG', durationMinutes: 30,
    });
  });

  it('allows only complete steps to advance and preserves backward navigation', () => {
    const draft = createBookingDraft('CAT_FEEDING');
    expect(bookingStepIsComplete(draft)).toBe(true);
    expect(nextBookingStep(draft)).toBe('SCHEDULE');
    expect(bookingStepIsComplete({ ...draft, step: 'SCHEDULE' })).toBe(false);
    expect(previousBookingStep('PET')).toBe('SCHEDULE');
  });

  it('switches the required pet species with the service', () => {
    expect(createBookingDraft('CAT_FEEDING').petSpecies).toBe('CAT');
    expect(createBookingDraft('DOG_WALKING').petSpecies).toBe('DOG');
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
pnpm --filter @pet/admin test -- owner/booking.test.ts
```

Expected: FAIL because `owner/booking.ts` does not exist.

- [ ] **Step 3: Implement the typed state model**

```ts
import type { OwnerPet, ServiceType } from '../models.js';

export type BookingStep = 'SERVICE' | 'SCHEDULE' | 'PET' | 'ADDRESS' | 'QUOTE';

export type BookingDraft = {
  step: BookingStep;
  serviceType: ServiceType;
  startsAt: string;
  durationMinutes: number;
  petId: string;
  petName: string;
  petSpecies: OwnerPet['species'];
  petNotes: string;
  addressId: string;
  districtName: string;
  addressDetail: string;
  orderNotes: string;
};

const STEPS: readonly BookingStep[] = ['SERVICE', 'SCHEDULE', 'PET', 'ADDRESS', 'QUOTE'];

export function createBookingDraft(serviceType: ServiceType = 'CAT_FEEDING'): BookingDraft {
  return {
    step: 'SERVICE', serviceType, startsAt: '', durationMinutes: 30,
    petId: '', petName: '', petSpecies: serviceType === 'CAT_FEEDING' ? 'CAT' : 'DOG',
    petNotes: '', addressId: '', districtName: '建邺区', addressDetail: '', orderNotes: '',
  };
}

export function bookingStepIsComplete(draft: BookingDraft): boolean {
  if (draft.step === 'SERVICE') return true;
  if (draft.step === 'SCHEDULE') return Number.isFinite(new Date(draft.startsAt).getTime());
  if (draft.step === 'PET') return draft.petId !== '' || draft.petName.trim() !== '';
  if (draft.step === 'ADDRESS') return draft.addressId !== '' || draft.addressDetail.trim() !== '';
  return draft.petId !== '' && draft.addressId !== '' && draft.startsAt !== '';
}

export function nextBookingStep(draft: BookingDraft): BookingStep {
  if (!bookingStepIsComplete(draft)) return draft.step;
  return STEPS[Math.min(STEPS.indexOf(draft.step) + 1, STEPS.length - 1)]!;
}

export function previousBookingStep(step: BookingStep): BookingStep {
  return STEPS[Math.max(STEPS.indexOf(step) - 1, 0)]!;
}
```

- [ ] **Step 4: Run test and verify pass**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src/pilot/owner/booking.ts apps/admin/src/pilot/owner/booking.test.ts
git commit -m "feat: model progressive owner booking"
```

---

### Task 3: Build the consumer service home and active-order summary

**Files:**
- Create: `apps/admin/src/pilot/owner/OwnerHome.tsx`
- Create: `apps/admin/src/pilot/owner/OwnerHome.test.tsx`
- Create: `apps/admin/src/pilot/owner/OwnerOrderCard.tsx`
- Modify: `apps/admin/src/pilot/OwnerPilotWorkspace.tsx`
- Modify: `apps/admin/src/pilot/PilotApp.tsx`

**Interfaces:**
- Produces: `OwnerHome({ displayName: string, orders: OwnerOrder[], onBook(type: ServiceType): void, onRefresh(): void })`.
- Produces: `OwnerOrderCard({ order: OwnerOrder, evidenceUrls: Record<string, string>, evidenceLoaded: Record<string, boolean>, evidenceErrors: Record<string, string>, evidenceLoading: string, confirming: boolean, onViewEvidence(id: string): void, onEvidenceLoad(id: string): void, onEvidenceError(id: string): void, onConfirm(id: string): void })`, preserving the existing timeline, report, evidence, and confirmation behavior.
- Changes: `OwnerPilotWorkspaceProps` gains `displayName: string`.

- [ ] **Step 1: Write failing home tests**

```tsx
it('shows services and trust before any form', async () => {
  render(<OwnerPilotWorkspace displayName="建邺宠主" api={fakeApi({ listOrders: vi.fn().mockResolvedValue([]) })} onError={() => 'error'}/>);
  expect(await screen.findByRole('heading', { name: '放心把它交给我们' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '预约上门喂猫' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '预约上门遛狗' })).toBeTruthy();
  expect(screen.getByText('人员认证')).toBeTruthy();
  expect(screen.queryByLabelText('宠物昵称')).toBeNull();
  expect(screen.queryByLabelText('详细服务地址')).toBeNull();
});

it('prioritizes the newest active order and shows its pet name', async () => {
  render(<OwnerPilotWorkspace displayName="建邺宠主" api={fakeApi({
    listOrders: vi.fn().mockResolvedValue([{ ...pendingOrder, petNames: ['团子'] }]),
  })} onError={() => 'error'}/>);
  expect(await screen.findByText('团子 · 上门喂猫')).toBeTruthy();
  expect(screen.getByText('等待平台核对费用')).toBeTruthy();
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
pnpm --filter @pet/admin test -- OwnerPilotWorkspace.test.tsx owner/OwnerHome.test.tsx
```

Expected: FAIL because the workspace still renders all forms immediately.

- [ ] **Step 3: Implement the home composition**

Create service metadata inside `OwnerHome.tsx`:

```tsx
const SERVICES = [
  { type: 'CAT_FEEDING' as const, title: '上门喂猫', price: '¥32 起', icon: '猫', copy: '喂食换水、清洁宠物区域、提交服务记录' },
  { type: 'DOG_WALKING' as const, title: '上门遛狗', price: '¥37 起', icon: '犬', copy: '牵引散步、饮水照看、提交服务记录' },
];

const TRUST = [
  ['人员认证', '审核通过后才进入匹配池'],
  ['平台匹配', '按区域与服务能力安排人员'],
  ['服务留痕', '服务照片与标准报告可查看'],
  ['异常协助', '履约异常由平台继续跟进'],
] as const;
```

Render semantic sections and real navigation anchors:

```tsx
<section id="owner-home" className="owner-home">
  <header className="owner-hero">
    <p>南京 · 上门宠物照护</p>
    <h1>放心把它交给我们</h1>
    <p>上门喂猫、上门遛狗，由平台匹配已认证服务人员。</p>
  </header>
  <div className="owner-services">
    {SERVICES.map((service) => <article key={service.type} className="owner-service-card">
      <span aria-hidden="true">{service.icon}</span><strong>{service.title}</strong><b>{service.price}</b>
      <p>{service.copy}</p>
      <button type="button" onClick={() => onBook(service.type)}>预约{service.title}</button>
    </article>)}
  </div>
  <section aria-labelledby="owner-trust-title" className="owner-trust">
    <h2 id="owner-trust-title">每次上门都有交代</h2>
    {TRUST.map(([title, copy]) => <article key={title}><strong>{title}</strong><p>{copy}</p></article>)}
  </section>
</section>
```

Extract the existing order rendering into `OwnerOrderCard.tsx` without changing evidence load or confirmation gates. In `PilotApp.tsx`, pass the existing safe profile value:

```tsx
<OwnerPilotWorkspace
  key={session.userId}
  api={api}
  displayName={session.displayName}
  onError={handleProtectedError}
/>
```

- [ ] **Step 4: Run focused tests and verify pass**

Run the command from Step 2.

Expected: home tests PASS; existing order timeline, evidence, and confirmation tests still PASS after imports are updated.

- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src/pilot/owner/OwnerHome.tsx apps/admin/src/pilot/owner/OwnerHome.test.tsx apps/admin/src/pilot/owner/OwnerOrderCard.tsx apps/admin/src/pilot/OwnerPilotWorkspace.tsx apps/admin/src/pilot/PilotApp.tsx apps/admin/src/pilot/OwnerPilotWorkspace.test.tsx
git commit -m "feat: add lightweight owner service home"
```

---

### Task 4: Replace the form wall with the progressive booking flow

**Files:**
- Create: `apps/admin/src/pilot/owner/BookingFlow.tsx`
- Create: `apps/admin/src/pilot/owner/BookingFlow.test.tsx`
- Modify: `apps/admin/src/pilot/OwnerPilotWorkspace.tsx`
- Modify: `apps/admin/src/pilot/OwnerPilotWorkspace.test.tsx`

**Interfaces:**
- Consumes: `BookingDraft` and helpers from `owner/booking.ts`.
- Consumes: existing `PilotApi` methods `createPet`, `createAddress`, `getQuote`, and `createOrder` through callbacks owned by `OwnerPilotWorkspace`.
- Produces: `BookingFlow({ draft: BookingDraft, setDraft: Dispatch<SetStateAction<BookingDraft>>, pets: OwnerPet[], addresses: OwnerAddress[], quote: QuoteBreakdown | null, quoting: boolean, submitting: boolean, submissionLocked: boolean, onPrepareQuote(draft: BookingDraft): Promise<void>, onSubmitOrder(notes: string): Promise<void>, onClose(): void })`.

- [ ] **Step 1: Write failing interaction tests**

Add tests that exercise the complete flow without querying hidden future fields:

```tsx
await user.click(await screen.findByRole('button', { name: '预约上门喂猫' }));
expect(screen.getByRole('heading', { name: '选择服务' })).toBeTruthy();
expect(screen.queryByLabelText('服务时间')).toBeNull();

await user.click(screen.getByRole('button', { name: '下一步：选择时间' }));
fireEvent.change(screen.getByLabelText('服务时间'), { target: { value: '2026-09-10T10:00' } });
await user.click(screen.getByRole('button', { name: '下一步：宠物信息' }));
await user.selectOptions(screen.getByLabelText('选择已有宠物'), pets[0]!.id);
await user.click(screen.getByRole('button', { name: '下一步：上门信息' }));
await user.selectOptions(screen.getByLabelText('选择已有地址'), addresses[0]!.id);
await user.click(screen.getByRole('button', { name: '获取服务报价' }));
expect(await screen.findByText('服务器固定报价')).toBeTruthy();
```

Add one new-pet/new-address test and assert each resource is created exactly once before quoting:

```ts
expect(api.createPet).toHaveBeenCalledTimes(1);
expect(api.createAddress).toHaveBeenCalledTimes(1);
expect(api.getQuote).toHaveBeenCalledWith(expect.objectContaining({
  serviceType: 'CAT_FEEDING', petIds: [pets[0]!.id], addressId: addresses[0]!.id,
}));
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
pnpm --filter @pet/admin test -- OwnerPilotWorkspace.test.tsx owner/BookingFlow.test.tsx
```

Expected: FAIL because no progressive flow exists.

- [ ] **Step 3: Implement one visible decision per step**

Use a labelled progress list and conditionally render exactly one step:

```tsx
const STEP_LABELS = ['服务', '时间', '宠物', '上门信息', '确认'] as const;
const STEP_INDEX: Readonly<Record<BookingStep, number>> = {
  SERVICE: 0, SCHEDULE: 1, PET: 2, ADDRESS: 3, QUOTE: 4,
};
const currentIndex = STEP_INDEX[draft.step];
const currentLabel = STEP_LABELS[currentIndex];

<section className="owner-booking" aria-labelledby="owner-booking-title">
  <div className="owner-booking-head">
    <button type="button" onClick={onClose}>关闭预约</button>
    <p>{currentIndex + 1} / 5</p>
  </div>
  <ol aria-label="预约进度" className="owner-booking-progress">
    {STEP_LABELS.map((label) => <li key={label} aria-current={label === currentLabel ? 'step' : undefined}>{label}</li>)}
  </ol>
  {draft.step === 'SERVICE' && <ServiceStep draft={draft} onChange={setDraft}/>}
  {draft.step === 'SCHEDULE' && <ScheduleStep draft={draft} onChange={setDraft}/>}
  {draft.step === 'PET' && <PetStep draft={draft} pets={compatiblePets} onChange={setDraft}/>}
  {draft.step === 'ADDRESS' && <AddressStep draft={draft} addresses={addresses} onChange={setDraft}/>}
  {draft.step === 'QUOTE' && <QuoteStep draft={draft} quote={quote} onQuote={onQuote} onSubmit={onSubmit}/>}
</section>
```

Creation rules in the controller:

```ts
async function ensurePet(draft: BookingDraft): Promise<string> {
  if (draft.petId) return draft.petId;
  const created = await api.createPet({
    name: draft.petName.trim(), species: draft.petSpecies, sensitiveNotes: draft.petNotes,
  });
  return created.id;
}

async function ensureAddress(draft: BookingDraft): Promise<string> {
  if (draft.addressId) return draft.addressId;
  const district = pilotDistrict(draft.districtName);
  if (!district) throw new Error('invalid district');
  const created = await api.createAddress({
    city: '南京市', district: district.district, serviceZone: district.zone,
    latitude: district.latitude, longitude: district.longitude,
    detail: draft.addressDetail.trim(), accessInstructions: '',
  });
  return created.id;
}
```

Do not call either helper twice after successful creation; write the returned IDs back into the draft before requesting the quote. Reuse the existing `quoteVersion`, `orderAttemptRef`, `quoteLock`, and `submitLock` logic unchanged for stale-response and duplicate-submit protection.

Render optional fields with native disclosure controls:

```tsx
<details>
  <summary>补充照护要求（选填）</summary>
  <label>照护备注（可选）<textarea value={draft.petNotes} onChange={(event) => {
    setDraft((current) => ({ ...current, petNotes: event.target.value }));
  }}/></label>
</details>
```

- [ ] **Step 4: Run focused tests and verify pass**

Run the command from Step 2.

Expected: PASS, including existing stale quote, lost-response retry, duplicate submit, unmount, evidence, and confirmation tests.

- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src/pilot/owner/BookingFlow.tsx apps/admin/src/pilot/owner/BookingFlow.test.tsx apps/admin/src/pilot/OwnerPilotWorkspace.tsx apps/admin/src/pilot/OwnerPilotWorkspace.test.tsx
git commit -m "feat: add progressive owner booking flow"
```

---

### Task 5: Add the mobile visual system and truthful bottom navigation

**Files:**
- Modify: `apps/admin/src/styles.css`
- Modify: `apps/admin/src/pilot/owner/OwnerHome.tsx`
- Modify: `apps/admin/src/pilot/owner/BookingFlow.tsx`
- Modify: `apps/admin/src/pilot/PilotApp.tsx`
- Modify: `apps/admin/src/pilot/PilotApp.test.tsx`

**Interfaces:**
- Produces: real anchors `#owner-home`, `#owner-orders`, and `#owner-account`.
- Preserves: provider/admin header and layout styles by scoping new selectors below `.pilot-owner-workspace` or with `.owner-*` names.

- [ ] **Step 1: Add failing navigation and accessibility assertions**

```tsx
expect(await screen.findByRole('navigation', { name: '宠主导航' })).toBeTruthy();
expect(screen.getByRole('link', { name: '首页' }).getAttribute('href')).toBe('#owner-home');
expect(screen.getByRole('link', { name: '订单' }).getAttribute('href')).toBe('#owner-orders');
expect(screen.getByRole('link', { name: '我的' }).getAttribute('href')).toBe('#owner-account');
expect(document.body.textContent).not.toMatch(/搜索|商城|社区|消息中心/);
```

- [ ] **Step 2: Run focused test and verify failure**

Run:

```powershell
pnpm --filter @pet/admin test -- PilotApp.test.tsx OwnerPilotWorkspace.test.tsx
```

Expected: FAIL because owner navigation and account anchor do not exist.

- [ ] **Step 3: Implement scoped responsive styles**

Add the three real anchors and an account summary using only the current safe display name:

```tsx
<section id="owner-account" className="owner-account" aria-labelledby="owner-account-title">
  <p>我的</p><h2 id="owner-account-title">{displayName}</h2>
  <span>宠主身份 · 南京本地试运营</span>
</section>
<nav className="owner-bottom-nav" aria-label="宠主导航">
  <a href="#owner-home">首页</a><a href="#owner-orders">订单</a><a href="#owner-account">我的</a>
</nav>
```

Apply the mobile-first layout with isolated selectors:

```css
.pilot-owner-workspace { width: min(100%, 880px); margin: 0 auto; padding-bottom: 76px; }
.owner-hero { padding: clamp(24px, 6vw, 48px); border-radius: 28px; color: #3c312b; background: linear-gradient(145deg,#fff0ec,#fff8e8); }
.owner-hero h1 { margin: 8px 0; font-size: clamp(32px, 7vw, 52px); line-height: 1.08; }
.owner-services { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 16px; }
.owner-service-card { min-width: 0; padding: 22px; border: 1px solid #f2ded7; border-radius: 22px; background: #fff; box-shadow: 0 14px 36px #6c46300d; }
.owner-service-card button { width: 100%; min-height: 48px; }
.owner-trust { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; }
.owner-trust h2 { grid-column: 1/-1; }
.owner-trust article,.owner-account { padding: 16px; border-radius: 18px; background: #fff; }
.owner-booking { width: min(100%,680px); margin: 0 auto; padding: clamp(18px,4vw,30px); border-radius: 24px; background: #fff; }
.owner-bottom-nav { position: fixed; z-index: 20; left: 50%; bottom: 12px; width: min(calc(100% - 24px),520px); min-height: 58px; padding: 6px; display: grid; grid-template-columns: repeat(3,1fr); transform: translateX(-50%); border: 1px solid #eadfd7; border-radius: 22px; background: #fffffff2; box-shadow: 0 14px 38px #3f2e2224; backdrop-filter: blur(12px); }
.owner-bottom-nav a { min-height: 46px; display: grid; place-items: center; border-radius: 16px; color: #6d625c; font-weight: 800; text-decoration: none; }

@media (max-width: 760px) {
  .pilot-main:has(.pilot-owner-workspace) { padding: 14px 12px 96px; }
  .owner-services { grid-template-columns: 1fr; }
  .owner-trust { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .owner-hero { border-radius: 22px; }
}
```

- [ ] **Step 4: Run focused tests and verify pass**

Run the command from Step 2, then:

```powershell
pnpm --filter @pet/admin typecheck
pnpm --filter @pet/admin build --mode pilot
```

Expected: tests PASS, typecheck exits 0, pilot build exits 0.

- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src/styles.css apps/admin/src/pilot/owner/OwnerHome.tsx apps/admin/src/pilot/owner/BookingFlow.tsx apps/admin/src/pilot/PilotApp.tsx apps/admin/src/pilot/PilotApp.test.tsx apps/admin/src/pilot/OwnerPilotWorkspace.test.tsx
git commit -m "style: simplify owner mobile experience"
```

---

### Task 6: Update browser acceptance and verify the complete product loop

**Files:**
- Modify: `apps/admin/e2e/pilot-owner-ui.spec.ts`
- Modify: `apps/admin/e2e/pilot-live.spec.ts`
- Modify: `docs/operations/pilot-quickstart.md`
- Modify outside the repository: `C:/Users/Administrator/Documents/Obsidian Vault/01-Projects/pet-home-service-platform/南京上门宠物服务平台实施进度.md` (update the existing progress log; do not create a duplicate)

**Interfaces:**
- Verifies: mobile home, progressive booking, real order flow, provider/admin continuity, evidence viewing, and owner confirmation.

- [ ] **Step 1: Rewrite the mocked owner browser path for the new flow**

Replace direct form-wall interactions with visible-step interactions:

```ts
await expect(page.getByRole('heading', { name: '放心把它交给我们' })).toBeVisible();
await expect(page.getByLabel('宠物昵称')).toHaveCount(0);
await page.getByRole('button', { name: '预约上门喂猫' }).click();
await page.getByRole('button', { name: '下一步：选择时间' }).click();
await page.getByLabel('服务时间').fill('2026-09-10T10:00');
await page.getByRole('button', { name: '下一步：宠物信息' }).click();
await page.getByLabel('选择已有宠物').selectOption(pet.id);
await page.getByRole('button', { name: '下一步：上门信息' }).click();
await page.getByLabel('选择已有地址').selectOption(address.id);
await page.getByRole('button', { name: '获取服务报价' }).click();
await expect(page.getByText('服务器固定报价')).toBeVisible();
await page.getByText('补充上门要求（选填）').click();
await page.getByLabel('订单备注（可选）').fill('请轻声进门');
await page.getByRole('button', { name: '确认提交订单' }).click();
```

Keep the existing request-payload, idempotency-key, evidence-load, confirmation, storage, sensitive-copy, overflow, and 44px assertions.

- [ ] **Step 2: Run the mocked pilot UI suite and fix only contract regressions**

Run:

```powershell
pnpm --filter @pet/admin test:e2e:pilot
```

Expected: all pilot UI projects PASS at their configured mobile and desktop viewports.

- [ ] **Step 3: Update the live acceptance selectors without weakening assertions**

Use the same visible booking sequence in `pilot-live.spec.ts`. Keep the existing three browser contexts, API restart, role isolation, address-window, evidence authorization, suspended-provider, and old-invitation assertions unchanged.

- [ ] **Step 4: Run full verification**

Run under Node.js 22:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm pilot:build
pnpm --filter @pet/admin test:e2e
pnpm --filter @pet/admin test:e2e:pilot
pnpm test:e2e:live
```

Expected: every command exits 0; the live runner reports 1/1 passed and cleans its PostgreSQL container, marker, evidence directory, and child processes.

- [ ] **Step 5: Inspect the running page at 390×844 and 1280×800**

Verify visually and with browser assertions:

```ts
const result = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > window.innerWidth,
  visibleForms: [...document.querySelectorAll('input,select,textarea')].filter((node) => (node as HTMLElement).offsetParent !== null).length,
  shortControls: [...document.querySelectorAll<HTMLElement>('button,input,select,textarea')]
    .filter((node) => node.offsetParent !== null && node.getBoundingClientRect().height < 44)
    .length,
}));
expect(result).toEqual({ overflow: false, visibleForms: 0, shortControls: 0 });
```

The `visibleForms: 0` assertion applies before opening booking. After booking begins, assert that future-step fields are absent rather than hidden.

- [ ] **Step 6: Update operations documentation and durable project summary**

Document the new owner path exactly:

```markdown
宠主进入后先看到两项服务和平台保障；点击“预约上门喂猫”或“预约上门遛狗”，依次选择时间、宠物、上门地址，取得服务器报价后提交。订单仍由平台匹配服务人员。
```

Record the final verification counts and commit IDs in the existing Vault project summary. Do not store cookies, secrets, addresses, access instructions, or evidence bytes.

- [ ] **Step 7: Commit**

```powershell
git add apps/admin/e2e/pilot-owner-ui.spec.ts apps/admin/e2e/pilot-live.spec.ts docs/operations/pilot-quickstart.md
git commit -m "test: verify lightweight owner booking"
```

Commit the Vault summary only if it belongs to the same Git worktree; otherwise leave it as a Vault-local durable note and report its path.
