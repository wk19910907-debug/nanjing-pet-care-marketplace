# Pilot Final Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final DNS-rebinding, proxy-spoofing, and direct-entry boundary-copy findings without changing production route absence or invitation compatibility.

**Architecture:** Keep the local-session endpoint registered only in development/test, but place a fail-closed request guard before body parsing and session creation. The guard derives one canonical HTTP authority/origin from the configured literal loopback `PILOT_HOST` and `PILOT_PORT`, then requires the raw socket peer, Fastify effective client IP, raw Host header, and optional browser Origin to match the local-only policy. Update the existing direct-entry component and browser coverage with the exact operating-boundary copy.

**Tech Stack:** Node.js 22, TypeScript, Fastify 5, Vitest, React, Testing Library, Playwright, pnpm 10.

## Global Constraints

- Allowed direct roles remain exactly `OWNER`, `PROVIDER`, and `ADMIN`.
- Production must continue returning 404 because the direct-session route is absent.
- Invitation APIs, secure production cookies, exactly three live Playwright contexts, and secret-handling boundaries must remain unchanged.
- Every denial must return 403 before invoking `createLocalSession`.
- The configured direct host must be one of `127.0.0.1`, `::1`, or `::ffff:127.0.0.1` as a literal address.
- The UI must state `仅限本机试运营；仅记录线下费用，不收集联系方式`.

---

### Task 1: Fail-closed direct-session request guard

**Files:**
- Modify: `apps/api/tests/pilot-auth-routes.test.ts`
- Modify: `apps/api/src/auth/pilot-routes.ts`

**Interfaces:**
- Consumes: `AppConfig.pilot.host`, `AppConfig.pilot.port`, `request.raw.socket.remoteAddress`, `request.ip`, `request.raw.headers.host`, and `request.headers.origin`.
- Produces: local-session authorization that returns 403 unless all local-only predicates pass.

- [x] **Step 1: Write failing route tests**

Add exact-host and matching-origin success coverage, attacker/mismatched Host and Origin denial coverage, non-literal configured-host denial coverage, and a trusted external transport peer with `X-Forwarded-For: 127.0.0.1`. Every denial asserts `localSessionRoles` stays empty. Update existing local-session injection fixtures to send `Host: 127.0.0.1:3000` and, where modeling a browser, `Origin: http://127.0.0.1:3000`.

- [x] **Step 2: Run the focused route test and verify RED**

Run: `pnpm --filter @pet/api exec vitest run tests/pilot-auth-routes.test.ts`

Expected: the new hostile Host/Origin, non-literal host, and trusted-external-peer cases fail because the current route trusts `request.ip` alone.

- [x] **Step 3: Implement the minimal guard**

Add a helper in `pilot-routes.ts` that returns no local origin unless the configured host is in the literal loopback allowlist; brackets IPv6 literals when constructing `${host}:${port}`; requires both transport and effective IP in the loopback allowlist; compares the raw Host header to the exact authority; and, when Origin exists, compares it to `http://${authority}`. Call it before parsing the body or invoking the service.

- [x] **Step 4: Run the focused route test and verify GREEN**

Run: `pnpm --filter @pet/api exec vitest run tests/pilot-auth-routes.test.ts`

Expected: all route tests pass, including production 404 and secure-cookie assertions.

### Task 2: Explicit direct-entry operating boundary

**Files:**
- Modify: `apps/admin/src/pilot/PilotApp.test.tsx`
- Modify: `apps/admin/e2e/pilot-auth-ui.spec.ts`
- Modify: `apps/admin/src/pilot/LoginPanel.tsx`

**Interfaces:**
- Consumes: unauthenticated `PilotApp` rendering.
- Produces: exact visible text `仅限本机试运营；仅记录线下费用，不收集联系方式`.

- [x] **Step 1: Write failing component and browser assertions**

Assert the exact boundary sentence is visible before direct role entry in both Testing Library and pilot Playwright coverage.

- [x] **Step 2: Run focused admin tests and verify RED**

Run: `pnpm --filter @pet/admin exec vitest run src/pilot/PilotApp.test.tsx`

Expected: the exact boundary-copy assertion fails because the current panel only says it does not require contact details or a real name.

- [x] **Step 3: Implement the minimal copy change**

Render one paragraph containing the exact required sentence in `LoginPanel` while retaining the display-nickname explanation.

- [x] **Step 4: Run focused admin tests and verify GREEN**

Run: `pnpm --filter @pet/admin exec vitest run src/pilot/PilotApp.test.tsx`

Expected: all component tests pass.

### Task 3: Verification, evidence, and commit

**Files:**
- Modify: `.superpowers/sdd/final-fixes-report.md`

**Interfaces:**
- Consumes: fresh command output from all required verification.
- Produces: a committed, reviewable evidence report with status, counts, concerns, and exact commands.

- [x] **Step 1: Run the required verification matrix under Node 22**

Run API/admin typechecks, relevant API/admin Vitest suites, `pnpm --filter @pet/admin test:e2e:pilot`, `pnpm test:e2e:live`, and `git diff --check`. Confirm the live scenario still uses exactly three contexts and completes cleanup.

- [x] **Step 2: Self-review the complete diff**

Check every review finding against code and tests; confirm invitation routes/cookies are untouched, production direct-route absence still has explicit coverage, and no secret values or unrelated files entered the diff.

- [x] **Step 3: Write the evidence report**

Record RED and GREEN observations, final command exit codes and test counts, the final diff summary, and any residual concern in `.superpowers/sdd/final-fixes-report.md`.

- [x] **Step 4: Commit**

Run: `git add apps/api/src/auth/pilot-routes.ts apps/api/tests/pilot-auth-routes.test.ts apps/admin/src/pilot/LoginPanel.tsx apps/admin/src/pilot/PilotApp.test.tsx apps/admin/e2e/pilot-auth-ui.spec.ts docs/superpowers/plans/2026-08-28-pilot-final-security-fixes.md && git add -f .superpowers/sdd/final-fixes-report.md && git commit -m "fix: harden local pilot entry"`

Expected: commit succeeds and the worktree is clean.
