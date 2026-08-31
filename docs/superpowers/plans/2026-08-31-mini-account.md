# Mini Account Implementation Plan

> Use executing-plans inline under the user's standing instruction to deliver without repeated choices.

**Goal:** Let native users supply one nickname and safely continue to their existing role-specific workflow.
**Architecture:** validated API session DTO, shared serialized access service, inline nickname gates in two pages.
**Tech Stack:** existing TypeScript, Vitest, native WXML. No dependencies or database migration.

## Global constraints

Do not implement fake WeChat sessions, change permissions, or invent profile values. Production exchange endpoint remains a separately recorded gap. No secrets in files. Preserve existing worktree.

## Task 1 — API and session access

Files: services/api.ts, services/account-access.ts, app.ts, tests/account-access.test.ts.

- [x] Add failing API tests for `getSession()` GET `/api/v1/pilot/session`, invalid responses, and `saveDisplayName(name)` POST `/api/v1/pilot/me` sending `{ displayName: name.trim() }` only. POST replaces the initial PATCH plan because native RequestOption does not support PATCH; backend uses one handler for both verbs.
- [x] Add failing access tests for `load(role: 'OWNER' | 'PROVIDER')`: read session first, one login on typed HTTP401, throw on wrong production role, never login on network error, same-role in-flight deduplication, different-role busy rejection.
- [x] Implement `ApiError(status, code)` and `AccountSession { userId, role, displayName, expiresAt }` strict projection. `load` resolves an authenticated matching-role account with valid expiry; missing nickname is returned for UI gating, not fabricated.
- [x] In app, disable Bearer token getter in develop; expose access created with existing local/real login adapters. Test a compiled/development app request does not use stored production token.
- [x] Run `pnpm --filter @pet/miniprogram test` and typecheck; tests must fail before code and pass afterward.

## Task 2 — Inline nickname gate

Files: pages/provider/invitations/index.ts/.wxml, pages/owner/order-create/index.ts/.wxml, tests/account-pages.test.ts, existing provider-tasks-page.test.ts fixtures.

- [x] Test actual Page handlers: null nickname shows profile form without task/catalog/pet/address reads; failed save retains form and text; successful save reloads backend session before loading business data; duplicate saves and post-unload UI updates are blocked.
- [x] Page load uses `access.load(role)` instead of testing token presence. Form state is `{ needsProfile, displayName }`; nickname input has max length30 and required non-whitespace validation.
- [x] `saveProfile` acquires busy lock, calls serialized `access.save(role, name)` (which checks identity, calls `api.saveDisplayName`, rereads identity/name), unlocks then reloads using access. Do not show success until the next session read verifies profile; copy explains no phone/WeChat number needed. Disable business submit when profile incomplete.
- [x] Update existing provider fixtures to supply valid access results, preserving invitation failure tests.
- [ ] Run focused tests, full mini lint/typecheck/build and full `pnpm check`; request independent review, resolve blocking findings, fast-forward existing main workflow and write Vault summary with exact limits.
