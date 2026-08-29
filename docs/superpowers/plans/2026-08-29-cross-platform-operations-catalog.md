# Cross-platform Operations Catalog Implementation Plan

> **For Codex:** Execute this plan task-by-task with test-driven development. Run the focused red test before each implementation, then the focused green test, and commit each coherent slice.

**Goal:** Give operators one audited database-backed configuration for service availability, base prices, Nanjing districts, and announcement, consumed consistently by the website and WeChat mini program.

**Architecture:** Add a versioned `OperationsCatalog` aggregate in PostgreSQL, expose a public read endpoint and administrator-only compare-and-swap update endpoint, then inject the catalog into quoting. Add strict clients and UI consumers in the React pilot and mini program. Existing order state transitions remain unchanged; orders continue retaining their quote snapshots.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Fastify, Zod, React/Vite, WeChat mini program APIs, Vitest, Testing Library, Playwright.

---

## Task 1: Define the shared operations-catalog contract

**Files:**

- Create: `packages/contracts/src/operations-catalog.ts`
- Create: `packages/contracts/src/operations-catalog.test.ts`
- Modify: `packages/contracts/src/index.ts`

1. Write failing contract tests for the two service entries, stable Nanjing district codes, integer-fen prices, public/admin shapes, update command, and validation limits.
2. Run `pnpm --filter @pet/contracts test -- operations-catalog.test.ts` and confirm the new module is missing or tests fail.
3. Implement the minimal constants, types, and Zod-free validation helpers required by all runtimes.
4. Re-run the focused test and `pnpm --filter @pet/contracts typecheck`.
5. Commit: `feat: define operations catalog contract`.

## Task 2: Persist a versioned catalog and audit updates

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608290001_operations_catalog/migration.sql`
- Create: `apps/api/src/catalog/operations-catalog-repository.ts`
- Create: `apps/api/src/catalog/operations-catalog-service.ts`
- Create: `apps/api/tests/operations-catalog-service.test.ts`
- Modify: `apps/api/src/audit/audit-repository.ts` only if the existing API cannot express the catalog audit event

1. Write failing service tests for default read, valid update, invalid input, administrator authorization, optimistic concurrency conflict, and audit metadata.
2. Run `pnpm --filter @pet/api test -- operations-catalog-service.test.ts` and confirm failure.
3. Add the singleton/versioned schema and an idempotent default row in the migration.
4. Implement repository compare-and-swap and the service validation/update transaction boundary.
5. Re-run the focused test, API typecheck, and `npx prisma validate` with the repository's configured database URL.
6. Commit: `feat: persist audited operations catalog`.

## Task 3: Expose public and administrator catalog APIs

**Files:**

- Create: `apps/api/src/catalog/routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/pilot/composition.ts`
- Create: `apps/api/tests/operations-catalog-routes.test.ts`
- Modify: `apps/api/tests/pilot-composition.test.ts`

1. Write failing route tests for public redaction, administrator read/update, role rejection, validation errors, and HTTP 409 version conflicts.
2. Run `pnpm --filter @pet/api test -- operations-catalog-routes.test.ts` and confirm the routes return 404.
3. Register `GET /api/v1/catalog`, `GET /api/v1/pilot/admin/catalog`, and `PUT /api/v1/pilot/admin/catalog` using the existing pilot authentication and origin protections.
4. Wire the Prisma repository/service in pilot composition and map catalog conflicts in the central error handler.
5. Re-run route/composition tests and API typecheck.
6. Commit: `feat: expose operations catalog api`.

## Task 4: Enforce the catalog during quote and order creation

**Files:**

- Modify: `apps/api/src/catalog/quote-service.ts`
- Modify: `apps/api/src/pilot/composition.ts`
- Modify: `apps/api/tests/order-payment.test.ts`
- Modify: `apps/api/tests/pilot-business-routes.test.ts`
- Modify: `apps/api/tests/pilot-composition.test.ts`

1. Add failing tests proving a disabled service and closed district cannot be quoted, changed base prices affect only new quotes, and existing order snapshots/totals remain unchanged.
2. Run the focused API tests and confirm they fail for the missing catalog enforcement.
3. Inject current catalog reads into quoting, construct the domain pricing policy from the current base prices, and return stable business error codes for unavailable service/area.
4. Preserve the current quote snapshot in order creation; do not add any order mutation path.
5. Re-run focused API tests and typecheck.
6. Commit: `feat: enforce live catalog in quotes`.

## Task 5: Add strict browser clients for catalog APIs

**Files:**

- Modify: `apps/admin/src/pilot/models.ts`
- Modify: `apps/admin/src/pilot/api.ts`
- Modify: `apps/admin/src/pilot/api.test.ts`

1. Write failing tests for public/admin catalog parsing, unexpected field/value rejection, GET behavior, PUT expected-version payload, and conflict error propagation.
2. Run `pnpm --filter @pet/admin test -- src/pilot/api.test.ts` and confirm the new methods are absent.
3. Implement strict response parsers plus `getCatalog`, `getAdminCatalog`, and `updateAdminCatalog` methods.
4. Re-run the focused test and admin typecheck.
5. Commit: `feat: add catalog web api client`.

## Task 6: Build the safe operations-settings panel

**Files:**

- Create: `apps/admin/src/pilot/OperationsSettingsPanel.tsx`
- Create: `apps/admin/src/pilot/OperationsSettingsPanel.test.tsx`
- Modify: `apps/admin/src/pilot/AdminPilotWorkspace.tsx`
- Modify: `apps/admin/src/pilot/AdminPilotWorkspace.test.tsx`
- Modify: `apps/admin/src/styles.css`

1. Write failing component tests for initial loading, both service switches, price input, district selection, announcement, successful save, validation, and version-conflict refresh guidance.
2. Run the focused admin tests and confirm failure.
3. Implement a compact formal-operation card and connect it only for administrator sessions.
4. Ensure order progress remains read-only except for existing domain actions.
5. Re-run focused tests, admin typecheck, and build.
6. Commit: `feat: add operations settings panel`.

## Task 7: Make the website owner/public experience consume the catalog

**Files:**

- Modify: `apps/admin/src/demo/PublicLanding.tsx`
- Modify: `apps/admin/src/demo/PublicLanding.test.tsx`
- Modify: `apps/admin/src/pilot/PilotApp.tsx`
- Modify: `apps/admin/src/pilot/OwnerPilotWorkspace.tsx`
- Modify: `apps/admin/src/pilot/OwnerPilotWorkspace.test.tsx`
- Modify: `apps/admin/src/pilot/owner/OwnerHome.tsx`
- Modify: `apps/admin/src/pilot/owner/OwnerHome.test.tsx`
- Modify: `apps/admin/src/pilot/owner/BookingFlow.tsx`
- Modify: `apps/admin/src/pilot/owner/BookingFlow.test.tsx`
- Modify: `apps/admin/src/pilot/owner/booking.ts`

1. Add failing tests for dynamic price/announcement rendering, hidden disabled services, open-district filtering, unavailable-catalog blocking, and server-quote authority.
2. Run focused owner/public tests and confirm current hard-coded content fails them.
3. Load the catalog once at the appropriate app boundary and pass validated data into presentation components.
4. Remove duplicated price and district choices from the booking UI; keep coordinate lookup as a separate stable district metadata map.
5. Re-run focused tests, typecheck, and pilot build.
6. Commit: `feat: use live catalog in web booking`.

## Task 8: Add a production-safe mini-program catalog/session layer

**Files:**

- Modify: `apps/miniprogram/app.ts`
- Modify: `apps/miniprogram/platform.d.ts`
- Modify: `apps/miniprogram/services/api.ts`
- Modify: `apps/miniprogram/services/session.ts`
- Create: `apps/miniprogram/services/environment.ts`
- Modify: `apps/miniprogram/tests/services.test.ts`
- Create: `apps/miniprogram/tests/environment.test.ts`

1. Write failing tests for catalog GET, environment-specific base URL validation, bearer-session behavior, and a `wx.login` production adapter that sends only the temporary code to the API.
2. Run focused mini-program tests and confirm the missing methods/configuration fail.
3. Implement strict catalog parsing, HTTPS production URL enforcement, development override, and the session adapter boundary without embedding credentials.
4. Re-run focused tests and mini-program typecheck.
5. Commit: `feat: add mini program live api foundation`.

## Task 9: Replace the mini-program home demo with the live owner flow

**Files:**

- Modify: `apps/miniprogram/pages/home/index.ts`
- Modify: `apps/miniprogram/pages/home/index.wxml`
- Modify: `apps/miniprogram/pages/home/index.wxss`
- Modify: `apps/miniprogram/pages/owner/order-create/index.ts`
- Modify: `apps/miniprogram/pages/owner/order-create/index.wxml`
- Create: `apps/miniprogram/presenters/catalog-presenter.ts`
- Create: `apps/miniprogram/tests/catalog-presenter.test.ts`
- Modify: `apps/miniprogram/tests/demo-workflow.test.ts` or remove only the obsolete home-demo assertions after live-flow coverage exists

1. Write failing presenter/page-state tests for service cards, dynamic prices, announcement, open districts, disabled services, retry state, and “提交订单” wording.
2. Run focused mini-program tests and confirm current hard-coded/demo behavior fails.
3. Implement a lightweight live home and order form that fetch the catalog and uses the existing API client for quote/order creation.
4. Remove the false “确认并支付” claim and prevent submission when catalog/session/quote is unavailable.
5. Re-run mini-program tests and typecheck.
6. Commit: `feat: connect mini program owner flow`.

## Task 10: End-to-end migration and regression verification

**Files:**

- Modify: `apps/admin/e2e/pilot-live.spec.ts`
- Modify: `scripts/run-pilot-live-acceptance.mjs` if migration setup needs the new schema
- Modify: `README.md`
- Modify: `docs/pilot-operations.md` if present
- Modify: `01-Projects/pet-home-service-platform/2026-08-23-implementation-progress.md` in the Vault after verification

1. Extend live acceptance to edit the operations catalog as admin, verify website changes, create a new owner quote/order, and prove existing order totals remain stable.
2. Run the new E2E test first and confirm it fails before final wiring/documentation.
3. Apply/generate Prisma client in the isolated test database and complete only the wiring required by the failing acceptance.
4. Run `pnpm check`.
5. Run `pnpm pilot:build`.
6. Run `pnpm test:e2e:live`.
7. Run mini-program tests/typecheck explicitly and inspect the generated/source pages for WeChat-supported APIs and absence of embedded secrets.
8. Update operator documentation and the durable Obsidian project summary with configuration, validation, external WeChat prerequisites, exact verification evidence, and rollback notes.
9. Run `git diff --check`, review the complete diff for secret leakage and unintended order mutation paths, then commit: `docs: hand off cross-platform operations catalog`.

## Completion constraints

- Never report production WeChat login as active without real AppID, legal HTTPS domains, and server-side secret configuration.
- Never expose an arbitrary order-status editor.
- Never trust prices sent from either frontend.
- Do not claim completion unless all focused tests plus `pnpm check`, `pnpm pilot:build`, and `pnpm test:e2e:live` pass on the final tree.
