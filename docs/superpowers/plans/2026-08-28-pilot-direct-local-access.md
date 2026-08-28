# Pilot Direct Local Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the user-facing invitation login with a loopback-only local role selector that creates persistent role-scoped pilot sessions.

**Architecture:** Extend `PilotSessionService` with a stable local-user session factory, expose it through a route that exists only outside production and only accepts loopback requests, then replace the login and admin invite UI with direct role entry. Keep invitation persistence and APIs for backward compatibility and hidden isolation tests.

**Tech Stack:** Node.js 22, TypeScript, Fastify 5, Prisma/PostgreSQL 16, React 19, Vitest, Testing Library, Playwright.

## Global Constraints

- Direct access is registered only for `development` and `test`; production must not expose it.
- Direct access must reject non-loopback request addresses.
- Allowed direct roles are exactly `OWNER`, `PROVIDER`, and `ADMIN`.
- One stable local user per role must be reused across logout/login and concurrent requests.
- Session tokens remain random, hashed at rest, and delivered only through the existing HttpOnly SameSite cookie.
- Do not add or persist phone numbers, WeChat IDs, passwords, real names, payment data, invitation codes, or secrets.
- Preserve invitation schema and backend compatibility, but remove invitation login and management from the rendered product UI.

---

### Task 1: Stable local role sessions

**Files:**
- Modify: `apps/api/src/auth/pilot-session-service.ts`
- Test: `apps/api/tests/pilot-session-service.test.ts`

**Interfaces:**
- Consumes: existing `PilotSessionOptions`, Prisma `User` and `PilotSession` models.
- Produces: `createLocalSession(role: 'OWNER' | 'PROVIDER' | 'ADMIN'): Promise<{ token: string; expiresAt: Date }>`.

- [ ] **Step 1: Write failing service tests**

Add tests that call `createLocalSession('OWNER')` twice and assert both sessions authenticate to the same `userId`, call all three roles and assert distinct users/roles, and run two independent service instances concurrently while asserting only one user exists for the role marker.

- [ ] **Step 2: Run the focused service test and verify RED**

Run: `pnpm --filter @pet/api test -- pilot-session-service.test.ts`

Expected: TypeScript/Vitest failure because `createLocalSession` does not exist.

- [ ] **Step 3: Implement the minimal service method**

Add the exact role type and stable marker helper:

```ts
export const LOCAL_PILOT_ROLES = ['OWNER', 'PROVIDER', 'ADMIN'] as const;
export type LocalPilotRole = (typeof LOCAL_PILOT_ROLES)[number];

function localUserMarker(role: LocalPilotRole): string {
  return createHash('sha256').update(`pilot-local-direct-v1\0${role}`, 'utf8').digest('hex');
}
```

Inside a Serializable transaction, upsert the user by `phoneHash`, verify its role, create a random hashed session with the existing expiry policy, and normalize `P2034` retries without exposing the marker.

- [ ] **Step 4: Run the focused service test and verify GREEN**

Run: `pnpm --filter @pet/api test -- pilot-session-service.test.ts`

Expected: all service tests pass and the concurrent user count is one.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/auth/pilot-session-service.ts apps/api/tests/pilot-session-service.test.ts
git commit -m "feat: add stable local pilot sessions"
```

### Task 2: Loopback-only direct session route and client contract

**Files:**
- Modify: `apps/api/src/auth/pilot-routes.ts`
- Modify: `apps/admin/src/pilot/api.ts`
- Modify: `apps/admin/src/pilot/models.ts`
- Test: `apps/api/tests/pilot-auth-routes.test.ts`
- Test: `apps/admin/src/pilot/api.test.ts`

**Interfaces:**
- Consumes: `PilotSessionService.createLocalSession` from Task 1 and existing cookie writer.
- Produces: `POST /api/v1/pilot/local-sessions` and `PilotApi.createLocalSession(role)`.

- [ ] **Step 1: Write failing route and client tests**

Cover loopback success for all roles, exact 201 response and cookie flags, invalid role 400, non-loopback 403 without service invocation, production 404, and client request/response allowlists.

- [ ] **Step 2: Run focused route/client tests and verify RED**

Run: `pnpm --filter @pet/api test -- pilot-auth-routes.test.ts` and `pnpm --filter @pet/admin test -- src/pilot/api.test.ts`.

Expected: failures because the route and client method do not exist.

- [ ] **Step 3: Implement the route and client**

Use a strict body schema:

```ts
const LocalSessionSchema = z.object({
  role: z.enum(['OWNER', 'PROVIDER', 'ADMIN']),
}).strict();
```

Register the route only when `config.nodeEnv !== 'production'`. Accept only `127.0.0.1`, `::1`, or `::ffff:127.0.0.1`; write the existing secure cookie and return only `expiresAt`. Add `createLocalSession(role)` to `PilotApi` and validate the response with the existing session-created parser.

- [ ] **Step 4: Run focused route/client tests and verify GREEN**

Run both focused commands from Step 2.

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/auth/pilot-routes.ts apps/api/tests/pilot-auth-routes.test.ts apps/admin/src/pilot/api.ts apps/admin/src/pilot/api.test.ts apps/admin/src/pilot/models.ts
git commit -m "feat: expose loopback pilot role entry"
```

### Task 3: Replace invitation UI with direct role entry

**Files:**
- Modify: `apps/admin/src/pilot/LoginPanel.tsx`
- Modify: `apps/admin/src/pilot/PilotApp.tsx`
- Test: `apps/admin/src/pilot/PilotApp.test.tsx`
- Test: `apps/admin/e2e/pilot-auth-ui.spec.ts`

**Interfaces:**
- Consumes: `PilotApi.createLocalSession(role)` from Task 2.
- Produces: three direct-entry buttons and no rendered invitation management UI.

- [ ] **Step 1: Write failing component and browser tests**

Assert exact buttons “以宠主身份进入”“以服务人员身份进入”“以平台管理员身份进入”, absence of invitation input/management text, one API call under repeated clicks, existing nickname flow after entry, and no contact/payment fields.

- [ ] **Step 2: Run focused UI tests and verify RED**

Run: `pnpm --filter @pet/admin test -- src/pilot/PilotApp.test.tsx`.

Expected: failures because the current panel requires an invitation code and renders `AdminInvitePanel`.

- [ ] **Step 3: Implement direct role entry**

Replace input state with pending-role state, render the three buttons from a fixed role label map, call `createLocalSession(role)`, and reload the existing session. Remove `AdminInvitePanel` from `PilotApp` and change the shell subtitle from “邀请制试运营” to “本地试运营”.

- [ ] **Step 4: Run focused UI tests and verify GREEN**

Run the focused Vitest test and `pnpm --filter @pet/admin test:e2e:pilot`.

Expected: component tests and four pilot browser tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src/pilot/LoginPanel.tsx apps/admin/src/pilot/PilotApp.tsx apps/admin/src/pilot/PilotApp.test.tsx apps/admin/e2e/pilot-auth-ui.spec.ts
git commit -m "feat: replace invitation login with role entry"
```

### Task 4: Update live acceptance and operator documentation

**Files:**
- Modify: `apps/admin/e2e/pilot-live.spec.ts`
- Modify: `scripts/run-pilot-live-acceptance.mjs`
- Modify: `docs/operations/pilot-quickstart.md`
- Modify: `docs/testing/pilot-live-acceptance.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: direct role endpoint and role-entry UI from Tasks 2-3.
- Produces: end-to-end proof and invitation-free local startup instructions.

- [ ] **Step 1: Update live acceptance expectations**

Enter the primary ADMIN, OWNER, and PROVIDER through direct local sessions. Keep hidden invitation API use only for the secondary OWNER/PROVIDER same-role isolation checks. Assert visible page text contains no invitation login or invitation management controls.

- [ ] **Step 2: Update documentation**

Remove `pnpm pilot:bootstrap` from local startup, instruct the operator to open the page and select a role, state that direct access is loopback-only and absent in production, and keep all secret-handling warnings.

- [ ] **Step 3: Run complete verification**

Run on Node.js 22 with a fresh PostgreSQL 16 database:

```powershell
pnpm check
pnpm build
pnpm pilot:build
pnpm --filter @pet/admin test:e2e
pnpm --filter @pet/admin test:e2e:pilot
pnpm test:e2e:live
```

Expected: all commands exit 0; live runner removes its container and temporary evidence directory.

- [ ] **Step 4: Commit**

```powershell
git add apps/admin/e2e/pilot-live.spec.ts scripts/run-pilot-live-acceptance.mjs docs/operations/pilot-quickstart.md docs/testing/pilot-live-acceptance.md README.md
git commit -m "docs: operate invitation-free local pilot"
```

### Task 5: Review and integration

**Files:**
- Review: all changes from `3139f33` to feature HEAD.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: reviewed, merged, deployable `main` and a restarted local acceptance environment.

- [ ] **Step 1: Request independent code review**

Require Critical/Important/Minor findings with special attention to production route absence, loopback parsing, stable-user concurrency, cookie security, and hidden invitation compatibility.

- [ ] **Step 2: Fix every Critical and Important finding with TDD**

Run each focused regression test RED then GREEN and repeat full verification if production code changes.

- [ ] **Step 3: Push, create PR, merge, and clean up**

Use the repository's established PR workflow, wait for deployment, fast-forward local `main`, and remove only the owned `.worktrees/pilot-no-invite` worktree after merge.

- [ ] **Step 4: Restart local acceptance environment**

Stop the old invitation-based process and its exact labeled container, start the merged direct-access server with fresh in-memory secrets, verify `/health/live` and `/health/ready`, and open the role selector for user acceptance.
