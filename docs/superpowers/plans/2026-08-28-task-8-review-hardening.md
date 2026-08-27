# Task 8 Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Task 8 review findings at every server, signed-capability, client parser, and provider workflow boundary without weakening existing pilot privacy or lifecycle rules.

**Architecture:** Legacy mutation routes map service/Prisma records to narrow response DTOs before serialization. Local upload capabilities bind the signed MIME to the request header, while the browser accepts only one-slash same-origin absolute paths. Provider reconciliation uses the existing role-filtered order read model, extended only with safe evidence IDs, and evidence attachment replays by unique object key.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Prisma/PostgreSQL, React, Vitest, Testing Library, Playwright.

## Global Constraints

- Use strict RED → GREEN → REFACTOR for every behavior change.
- Preserve cookie-backed same-origin authentication and server-owned lifecycle timestamps.
- Never return raw Prisma objects from Task 8 routes.
- Never expose payment keys, idempotency keys, coordinates, provider/user IDs, dispatch wave/version, or object keys beyond explicitly authorized capability issuance/attachment input.
- Preserve the owner workspace and public demo.
- Keep 390×844 layout free of horizontal overflow and interactive controls at least 44 px.

---

### Task 1: Safe server response DTOs

**Files:**
- Modify: `apps/api/src/dispatch/routes.ts`
- Modify: `apps/api/src/fulfillment/routes.ts`
- Modify: `apps/api/src/pilot/pilot-routes.ts`
- Test: `apps/api/tests/dispatch-routes.test.ts`
- Test: `apps/api/tests/fulfillment.test.ts`
- Test: `apps/api/tests/pilot-business-routes.test.ts`

**Interfaces:**
- Consumes service records from provider, dispatch, and fulfillment services.
- Produces narrow application `{ id, reviewStatus }`, availability `{ id, startsAt, endsAt }`, review `{ id, reviewStatus }`, invitation `{ id, status, expiresAt }`, accepted order `{ id, status }`, evidence `{ id }`, check-in `{ id, orderId, checkedInAt }`, and report `{ id, orderId, submittedAt }` DTOs.

- [x] Add HTTP tests that seed or return records containing raw internal fields and assert exact safe JSON bodies.
- [x] Run the focused API tests and verify raw fields currently make them RED.
- [x] Add explicit route-level mapping functions and no extra serialization fields.
- [x] Run focused tests and verify GREEN.

### Task 2: Upload capability origin and MIME binding

**Files:**
- Modify: `apps/admin/src/pilot/api.ts`
- Modify: `apps/api/src/adapters/local-pilot-object-storage.ts`
- Modify: `apps/api/src/pilot/local-upload-routes.ts`
- Test: `apps/admin/src/pilot/api.task8.test.ts`
- Test: `apps/api/tests/local-pilot-object-storage.test.ts`

**Interfaces:**
- Consumes local upload URL strings and signed capability tokens.
- Produces client acceptance only for `^/(?!/)` paths with no backslash, percent escape, fragment, control/space, or scheme; `acceptUpload(token, bytes, requestMimeType)` verifies signed MIME equality before storage mutation.

- [x] Add client tests for `//evil`, backslash, external schemes, percent-encoded bypasses, and zero fetch calls.
- [x] Add route/storage test issuing PNG but sending JPEG bytes/header and assert fixed 400 plus no stored object.
- [x] Run focused tests and verify RED.
- [x] Implement the path predicate and signed MIME/header comparison.
- [x] Run focused tests and verify GREEN.

### Task 3: Explicit provider state confirmations

**Files:**
- Modify: `apps/admin/src/pilot/ProviderPilotWorkspace.tsx`
- Test: `apps/admin/src/pilot/ProviderPilotWorkspace.test.tsx`
- Test: `apps/admin/e2e/pilot-admin-provider-ui.spec.ts`

**Interfaces:**
- Produces explicit per-order `beforeStateConfirmed` and `afterStateConfirmed` booleans.
- Sends `{ petStateConfirmed: true }` only after the corresponding provider checkbox is selected.

- [x] Add component tests proving check-in and report remain disabled before explicit confirmation and no API call occurs.
- [x] Run the focused component test and verify RED.
- [x] Add distinct controls/copy for arrival-state and completion-state confirmation, reset through session-keyed workspace lifecycle.
- [x] Run focused tests and verify GREEN; update pilot E2E to make the explicit selections.

### Task 4: Ambiguous mutation reconciliation and idempotent evidence

**Files:**
- Modify: `apps/api/src/fulfillment/fulfillment-service.ts`
- Modify: `apps/api/src/pilot/pilot-read-model.ts`
- Modify: `apps/admin/src/pilot/models.ts`
- Modify: `apps/admin/src/pilot/api.ts`
- Modify: `apps/admin/src/pilot/ProviderPilotWorkspace.tsx`
- Test: `apps/api/tests/fulfillment.test.ts`
- Test: `apps/api/tests/pilot-business-routes.test.ts`
- Test: `apps/admin/src/pilot/ProviderPilotWorkspace.test.tsx`
- Test: `apps/admin/src/pilot/api.task8.test.ts`

**Interfaces:**
- Produces provider order `evidence: Array<{ id: string }>` without object keys or storage metadata.
- `attachEvidence` returns the existing evidence on an identical object-key replay, otherwise fails closed on metadata/report mismatch.
- Provider mutations accept a reconciliation flag that reloads the server read model after ambiguous accept/check-in/upload-attach/report failures.

- [x] Add service/read-model tests for safe evidence state and identical replay without duplicate rows/audits.
- [x] Add component tests where mutation rejects after server state advances and assert the refreshed state replaces the stale action.
- [x] Run focused tests and verify RED.
- [x] Implement safe evidence projection, replay lookup, and error-path reload.
- [x] Run focused tests and verify GREEN.

### Task 5: Full verification and handoff

**Files:**
- Create: `task-8-review-fixes-report.md`

**Interfaces:**
- Produces a clean follow-up commit and durable review report.

- [x] Run Node 22 API and Admin full tests against a disposable migrated PostgreSQL database and remove it afterward.
- [x] Run full lint, typecheck, normal/pilot builds, public/pilot Playwright, and `git diff --check`.
- [x] Review the final diff against all five findings and record remaining concerns.
- [x] Commit with a separate review-hardening message.
