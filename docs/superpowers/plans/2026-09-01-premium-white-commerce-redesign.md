# Premium White Commerce Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current generic coral landing page with the approved W1 white premium pet-care marketplace while preserving the existing real catalog, platform-matching model, booking callbacks, demo disclosure, and responsive order flow.

**Architecture:** Keep `PublicLanding` as the shared public shell for demo and pilot modes, and keep every existing callback and catalog interface unchanged. Add repository-owned responsive media assets, a small pure hero-parallax helper, and a fully scoped `customer-web.css` design system so the redesign cannot leak into the operator console or change order behavior.

**Tech Stack:** React 19, TypeScript 5.9, Vite 8, scoped CSS, Vitest, Testing Library, Pillow for deterministic AVIF/WebP conversion, Codex ImageGen for original source photography.

## Global Constraints

- Use only `#F6F6F1`, `#FFFFFF`, `#17231D`, `#1F4B3A`, `#143428`, `#6D746F`, `#E4E5DF`, `#B79A63`, and semantic error/success colors in the customer website theme.
- Do not add search, retail products, user-selected providers, reviews, memberships, coupons, chat, maps, payments, or fabricated metrics.
- `PublicLandingProps`, `PublicOperationsCatalog`, service availability, live prices, districts, announcements, and callback behavior remain unchanged.
- Static demo copy must continue to state that browser data does not create a real order.
- All new customer-site selectors remain scoped below `.customer-web` or `.customer-owner`.
- Store production media in the repository; no runtime hotlinks or remote font dependencies.
- Hero AVIF and WebP files must each be smaller than 350KB; service images must each be smaller than 180KB.
- Every interactive target remains at least 44px, supports keyboard focus, and respects `prefers-reduced-motion`.

---

### Task 1: Original Premium Pet Photography Assets

**Files:**
- Create: `apps/admin/src/assets/premium-care-hero.avif`
- Create: `apps/admin/src/assets/premium-care-hero.webp`
- Create: `apps/admin/src/assets/cat-care-card.avif`
- Create: `apps/admin/src/assets/cat-care-card.webp`
- Create: `apps/admin/src/assets/dog-walk-card.avif`
- Create: `apps/admin/src/assets/dog-walk-card.webp`
- Create: `apps/admin/src/demo/media-assets.test.ts`

**Interfaces:**
- Consumes: approved W1 visual direction and Pillow 12.1.1.
- Produces: six local asset URLs importable by `PublicLanding.tsx`.

- [ ] **Step 1: Write the failing asset contract test**

Create `apps/admin/src/demo/media-assets.test.ts`:

```ts
import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const assets = [
  ['premium-care-hero.avif', 350_000],
  ['premium-care-hero.webp', 350_000],
  ['cat-care-card.avif', 180_000],
  ['cat-care-card.webp', 180_000],
  ['dog-walk-card.avif', 180_000],
  ['dog-walk-card.webp', 180_000],
] as const;

describe('premium customer media', () => {
  it.each(assets)('%s is repository-owned and within its transfer budget', (name, limit) => {
    const file = new URL(`../assets/${name}`, import.meta.url);
    const bytes = statSync(file).size;
    expect(bytes).toBeGreaterThan(8_000);
    expect(bytes).toBeLessThan(limit);
  });
});
```

- [ ] **Step 2: Run the contract and verify RED**

Run:

```powershell
pnpm --filter @pet/admin exec vitest run src/demo/media-assets.test.ts
```

Expected: FAIL with `ENOENT` for `premium-care-hero.avif`.

- [ ] **Step 3: Generate one coherent source photo set**

Use the `imagegen` skill to generate three original raster images with this shared art direction:

```text
Premium editorial pet-care photography for a high-end Chinese lifestyle service marketplace. Natural-white contemporary apartment, soft morning daylight, low-saturation warm grey and subtle forest-green details, realistic healthy pets, clean uncluttered composition, no text, no logos, no human faces, no doors or access codes, refined magazine lighting, photorealistic.
```

Generate these crops:

1. Hero, 16:10: a calm cat and friendly medium dog positioned on the right 45%, generous clean negative space on the left for Chinese headline.
2. Cat card, 4:3: one relaxed cat near a water bowl in the same interior and light.
3. Dog card, 4:3: one leashed dog ready for a walk near a bright neutral wall, no visible person.

Save the accepted generation results to these ignored temporary paths:

- `.superpowers/generated/premium-care-hero-source.png`
- `.superpowers/generated/cat-care-card-source.png`
- `.superpowers/generated/dog-walk-card-source.png`

Inspect all three generated sources. Reject extra limbs, distorted leads, text, logos, unsafe doors, faces, or inconsistent lighting before conversion.

- [ ] **Step 4: Convert sources deterministically**

Run Pillow from the repository root, substituting only the three generated source paths:

```powershell
python -c "from PIL import Image; jobs=[('.superpowers/generated/premium-care-hero-source.png','apps/admin/src/assets/premium-care-hero',(1600,1000)),('.superpowers/generated/cat-care-card-source.png','apps/admin/src/assets/cat-care-card',(960,720)),('.superpowers/generated/dog-walk-card-source.png','apps/admin/src/assets/dog-walk-card',(960,720))]; [(lambda im,stem: (im.save(stem+'.avif',quality=62,speed=6),im.save(stem+'.webp',format='WEBP',quality=78,method=6)))(Image.open(src).convert('RGB').resize(size,Image.Resampling.LANCZOS),stem) for src,stem,size in jobs]"
```

Do not commit the large source PNG files.

- [ ] **Step 5: Run the asset contract and verify GREEN**

Run:

```powershell
pnpm --filter @pet/admin exec vitest run src/demo/media-assets.test.ts
```

Expected: 6 asset cases pass.

- [ ] **Step 6: Commit the assets**

```powershell
git add apps/admin/src/assets apps/admin/src/demo/media-assets.test.ts
git commit -m "assets: add premium pet care photography"
```

---

### Task 2: Premium Commerce Information Architecture

**Files:**
- Modify: `apps/admin/src/demo/PublicLanding.test.tsx`
- Modify: `apps/admin/src/demo/PublicLanding.tsx`
- Create: `apps/admin/src/demo/CommerceIcon.tsx`

**Interfaces:**
- Consumes: the six Task 1 assets and unchanged `PublicLandingProps`.
- Produces: semantic navigation, hero, four quick categories, two service product cards, existing booking children, process, safeguards, FAQ, and mobile quick navigation.

- [ ] **Step 1: Replace the public hierarchy assertion with the approved copy**

In `PublicLanding.test.tsx`, change the public-experience test to assert the new hierarchy and interactions:

```tsx
it('leads with a truthful premium commerce hierarchy', async () => {
  const onStartOrder = vi.fn();
  const onQuoteStartOrder = vi.fn();
  const onQuoteChange = vi.fn();
  const onViewOrders = vi.fn();
  render(<PublicLanding
    catalog={catalog}
    onStartOrder={onStartOrder}
    onViewOrders={onViewOrders}
    onQuoteStartOrder={onQuoteStartOrder}
    quoteSelection={{ serviceType: 'CAT_FEEDING', district: '建邺区' }}
    onQuoteChange={onQuoteChange}
  ><div>预约工作区</div></PublicLanding>);

  expect(screen.getByRole('heading', { name: '熟悉的家，安心的照护' })).toBeTruthy();
  expect(screen.getByRole('navigation', { name: '服务快捷入口' })).toBeTruthy();
  expect(screen.getByText('¥32 起')).toBeTruthy();
  expect(screen.getByText('¥37 起')).toBeTruthy();
  expect(screen.getByText('最终价格以确认预约时的服务器报价为准')).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/自主选人|五星|服务\d+次|用户\d+人/);

  await userEvent.click(screen.getByRole('button', { name: '快捷预约上门喂猫' }));
  expect(onQuoteChange).toHaveBeenCalledWith({ serviceType: 'CAT_FEEDING', district: '建邺区' });
  expect(onQuoteStartOrder).toHaveBeenCalledWith({ serviceType: 'CAT_FEEDING', district: '建邺区' });
  await userEvent.click(screen.getAllByRole('button', { name: '我的订单' })[0]!);
  expect(onViewOrders).toHaveBeenCalledOnce();
});
```

Keep the existing availability/price/district/announcement test and change only selectors invalidated by the new markup.

- [ ] **Step 2: Run the landing test and verify RED**

Run:

```powershell
pnpm --filter @pet/admin exec vitest run src/demo/PublicLanding.test.tsx
```

Expected: FAIL because the heading `熟悉的家，安心的照护` and navigation `服务快捷入口` do not exist.

- [ ] **Step 3: Add one consistent icon vocabulary**

Create `CommerceIcon.tsx` with a single 24×24 outline SVG interface:

```tsx
export type CommerceIconName = 'cat' | 'dog' | 'verified' | 'orders' | 'arrow';

export function CommerceIcon({ name }: { name: CommerceIconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'verified' && <><path d="m12 3 7 3v5c0 4.7-2.8 8.1-7 10-4.2-1.9-7-5.3-7-10V6l7-3Z"/><path d="m9 12 2 2 4-5"/></>}
    {name === 'orders' && <><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></>}
    {name === 'arrow' && <><path d="M5 12h14M14 7l5 5-5 5"/></>}
    {name === 'cat' && <><path d="m5 10-1-6 5 3a10 10 0 0 1 6 0l5-3-1 6v3a7 7 0 0 1-14 0v-3Z"/><path d="M9 13h.01M15 13h.01M10 16h4"/></>}
    {name === 'dog' && <><path d="M7 8a7 7 0 0 1 10 0v7a5 5 0 0 1-10 0V8Z"/><path d="M7 9 3 6v7l4 2m10-6 4-3v7l-4 2M10 13h.01M14 13h.01M10 17h4"/></>}
  </svg>;
}
```

- [ ] **Step 4: Rebuild `PublicLanding` without changing its interface**

Import the local AVIF/WebP assets and `CommerceIcon`. Replace the current hero and price-card markup with these bounded sections:

```tsx
<section id="top" className="store-hero">
  <div className="store-hero-copy">
    <span className="store-kicker">PREMIUM PET CARE · NANJING</span>
    <h1>熟悉的家，安心的照护</h1>
    <p>南京上门喂猫与遛狗服务。提交需求后，由平台匹配经过资料审核的服务人员。</p>
    <button className="store-primary" disabled={!bookingAvailable} onClick={onStartOrder}>
      探索上门服务 <CommerceIcon name="arrow"/>
    </button>
    <ul className="store-trust"><li>身份资料审核</li><li>平台统一匹配</li><li>服务过程留痕</li></ul>
  </div>
  <picture className="store-hero-media">
    <source srcSet={heroAvif} type="image/avif"/>
    <img src={heroWebp} width="1600" height="1000" alt="猫和狗在明亮整洁的家中休息"/>
  </picture>
</section>
```

Add a `nav aria-label="服务快捷入口"` with four items. Cat and dog items call a local `startService(type)` helper that builds `{ ...quoteSelection, serviceType: type }`, calls `onQuoteChange(selection)`, then `onQuoteStartOrder(selection)`. Verified is an anchor to `#safeguards`; orders calls `onViewOrders ?? onStartOrder`.

Render service product cards only from `availableServices`. Each uses the correct local service image, `startingPrice`, 25/30-minute truthful duration, three existing service details, and a button named `预约上门喂猫` or `预约上门遛狗`. Keep `PublicQuote`, `children`, process, safeguards, FAQ, and `customer-quick-nav` in the same semantic order.

- [ ] **Step 5: Run the landing tests and verify GREEN**

Run:

```powershell
pnpm --filter @pet/admin exec vitest run src/demo/PublicLanding.test.tsx
```

Expected: all `PublicLanding` tests pass, including live availability and callback assertions.

- [ ] **Step 6: Commit the commerce structure**

```powershell
git add apps/admin/src/demo/PublicLanding.tsx apps/admin/src/demo/PublicLanding.test.tsx apps/admin/src/demo/CommerceIcon.tsx
git commit -m "feat: rebuild public landing as premium service commerce"
```

---

### Task 3: Bounded Hero Depth Interaction

**Files:**
- Create: `apps/admin/src/demo/heroMotion.test.ts`
- Create: `apps/admin/src/demo/heroMotion.ts`
- Modify: `apps/admin/src/demo/PublicLanding.tsx`

**Interfaces:**
- Produces: `calculateHeroParallax(pointerX, pointerY, bounds): { x: number; y: number }` where both axes are finite integers from -8 through 8.
- Consumes: `.store-hero-media` CSS custom properties `--hero-shift-x` and `--hero-shift-y`.

- [ ] **Step 1: Write the failing pure motion tests**

```ts
import { describe, expect, it } from 'vitest';
import { calculateHeroParallax } from './heroMotion.js';

describe('calculateHeroParallax', () => {
  const bounds = { left: 100, top: 50, width: 400, height: 200 };
  it('keeps the center still', () => expect(calculateHeroParallax(300, 150, bounds)).toEqual({ x: 0, y: 0 }));
  it('clamps both edges to eight pixels', () => {
    expect(calculateHeroParallax(-100, -100, bounds)).toEqual({ x: -8, y: -8 });
    expect(calculateHeroParallax(900, 900, bounds)).toEqual({ x: 8, y: 8 });
  });
  it('fails closed for zero-sized bounds', () => {
    expect(calculateHeroParallax(1, 1, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
pnpm --filter @pet/admin exec vitest run src/demo/heroMotion.test.ts
```

Expected: FAIL because `heroMotion.ts` is missing.

- [ ] **Step 3: Implement the pure clamp**

```ts
type Bounds = { left: number; top: number; width: number; height: number };
const clamp = (value: number) => Math.max(-8, Math.min(8, Math.round(value)));

export function calculateHeroParallax(pointerX: number, pointerY: number, bounds: Bounds) {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp((((pointerX - bounds.left) / bounds.width) - 0.5) * 16),
    y: clamp((((pointerY - bounds.top) / bounds.height) - 0.5) * 16),
  };
}
```

- [ ] **Step 4: Wire progressive enhancement into the hero**

In `PublicLanding`, add pointer move/leave handlers to the hero media wrapper. Use `event.currentTarget.getBoundingClientRect()`, call `calculateHeroParallax`, and set only `--hero-shift-x`/`--hero-shift-y` on that element. Do not use state or cause React rerenders. Ignore non-fine pointers using `window.matchMedia('(pointer: fine)').matches`.

- [ ] **Step 5: Run focused tests and commit**

```powershell
pnpm --filter @pet/admin exec vitest run src/demo/heroMotion.test.ts src/demo/PublicLanding.test.tsx
git add apps/admin/src/demo/heroMotion.ts apps/admin/src/demo/heroMotion.test.ts apps/admin/src/demo/PublicLanding.tsx
git commit -m "feat: add restrained hero depth motion"
```

Expected: motion and landing tests pass.

---

### Task 4: Unified White Commerce Design System

**Files:**
- Modify: `apps/admin/src/demo/PublicLanding.test.tsx`
- Replace: `apps/admin/src/demo/customer-web.css`

**Interfaces:**
- Consumes: Task 2 class names and the existing `.customer-owner` booking markup.
- Produces: scoped desktop/tablet/mobile layout with consistent tokens and reduced-motion behavior.

- [ ] **Step 1: Write the failing style-contract test**

Add to `PublicLanding.test.tsx`:

```ts
it('locks the customer website to one premium white commerce system', () => {
  const css = readFileSync('src/demo/customer-web.css', 'utf8').toLowerCase();
  for (const token of [
    '--store-canvas: #f6f6f1', '--store-surface: #ffffff', '--store-ink: #17231d',
    '--store-brand: #1f4b3a', '--store-brand-deep: #143428', '--store-gold: #b79a63',
  ]) expect(css).toContain(token);
  expect(css).toContain('@media (max-width: 760px)');
  expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  expect(css).toContain('min-height: 44px');
  expect(css).not.toMatch(/#f47672|#b94f43|#463831|#4e3b33|#925044/);
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
pnpm --filter @pet/admin exec vitest run src/demo/PublicLanding.test.tsx
```

Expected: FAIL because the old file contains coral/brown colors and lacks the new design tokens.

- [ ] **Step 3: Replace `customer-web.css` with the scoped token system**

Start the replacement with:

```css
.customer-web {
  --store-canvas: #f6f6f1;
  --store-surface: #ffffff;
  --store-ink: #17231d;
  --store-brand: #1f4b3a;
  --store-brand-deep: #143428;
  --store-muted: #6d746f;
  --store-line: #e4e5df;
  --store-gold: #b79a63;
  color: var(--store-ink);
  background: var(--store-canvas);
}
```

Implement these exact layout rules:

- `.public-nav`: sticky white 1200px navigation, 72px desktop height, subtle border and blur.
- `.store-hero`: max-width 1200px, two-column 54/46 split, 28px radius, white surface, minimum 560px desktop.
- `.store-hero-media`: clipped 28px media with image filling the frame and CSS translate using both hero custom properties.
- `.store-categories`: four equal category tiles desktop, two columns tablet/mobile; unified 56px icon circles.
- `.store-product-grid`: two cards desktop, one card below 760px; media ratio 4:3; product actions remain visible.
- `.demo-intro`, `.role-tabs`, `.notice`, `.demo-main`, `.customer-owner` form cards, receipts, orders, process, safeguards, FAQ: white surfaces, forest-green active state, warm-grey borders, identical radii and shadows.
- `.customer-quick-nav`: fixed only below 760px, white/blurred, three equal 48px targets; booking uses forest green.
- focus rings: `3px solid #b79a63` with 3px offset.
- `@media (prefers-reduced-motion: reduce)`: zero animation/transition and remove hero transforms.

Do not change global `styles.css` in this task; override customer-facing legacy rules with higher-scoped selectors in the later imported file.

- [ ] **Step 4: Run style and component tests**

```powershell
pnpm --filter @pet/admin exec vitest run src/demo/PublicLanding.test.tsx src/demo/DemoApp.test.tsx src/demo/OwnerWorkspace.test.tsx
```

Expected: all selected suites pass.

- [ ] **Step 5: Commit the unified visual system**

```powershell
git add apps/admin/src/demo/customer-web.css apps/admin/src/demo/PublicLanding.test.tsx
git commit -m "style: unify customer web as premium white commerce"
```

---

### Task 5: Full Verification, Visual QA, and Public Deployment

**Files:**
- Modify only if verification reveals a regression: files already owned by Tasks 1–4.
- Update: `01-Projects/pet-home-service-platform/2026-09-01-premium-white-commerce-redesign.md` in the shared Vault after delivery.

**Interfaces:**
- Consumes: the completed redesign branch.
- Produces: reviewed `main`, passing GitHub Actions, and an HTTP-200 public demo at the existing URL.

- [ ] **Step 1: Run complete automated verification**

```powershell
pnpm lint
pnpm typecheck
pnpm --filter @pet/admin test
pnpm pilot:build
pnpm test:deploy
git diff --check
```

Expected: zero lint/type errors, all admin and deployment tests pass, build succeeds, and diff check emits no errors.

- [ ] **Step 2: Perform three-viewport browser QA**

Run a local production-like preview:

```powershell
pnpm --filter @pet/admin build
pnpm --filter @pet/admin exec vite preview --host 127.0.0.1 --port 43210 --strictPort
```

Use the in-app browser at `http://127.0.0.1:43210/` with these exact viewports:

- Desktop: 1440×1000.
- Tablet: 900×1100.
- Mobile: 390×844.

At each viewport verify: navigation, hero crop, truthful trust labels, four quick categories, both service prices, service availability, three-step booking, order access, process, safeguards, FAQ, keyboard focus, no horizontal overflow, and no overlap with mobile bottom navigation.

Capture desktop and mobile screenshots. Inspect console errors and confirm no remote image requests or font requests.

- [ ] **Step 3: Verify reduced motion and unavailable catalog states**

Use browser emulation or the existing unit fixtures to verify reduced-motion removes parallax/transitions. Run the catalog test where dog walking is disabled and confirm its card and booking button are absent while the cat price and district remain live.

- [ ] **Step 4: Request read-only code review**

Review from base `8e6cbc9` through branch HEAD against `docs/superpowers/specs/2026-09-01-premium-white-commerce-redesign.md`. Fix all Critical and Important findings with a failing regression test first, then rerun Step 1.

- [ ] **Step 5: Merge, push, and watch deployment**

Fast-forward `main`, rerun `pnpm test:deploy`, push to `origin/main`, and wait for both `Deploy public demo` and `Validate production image` GitHub Actions to complete successfully.

- [ ] **Step 6: Verify the public result and record the durable summary**

Verify `https://wk19910907-debug.github.io/nanjing-pet-care-marketplace/` returns HTTP 200, the title remains `南京安心宠｜南京上门喂猫与遛狗预约平台`, and the rendered H1 is `熟悉的家，安心的照护`.

Write the final commit, test counts, screenshots, public URL, and remaining real-infrastructure gate to the Vault summary. Store no credentials or user data.
