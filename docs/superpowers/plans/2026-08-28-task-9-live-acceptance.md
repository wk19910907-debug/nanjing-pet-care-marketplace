# Task 9 Live Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the complete pilot service loop against the built UI, the real Fastify pilot server, and a fresh disposable PostgreSQL 16 database with three independent browser sessions.

**Architecture:** A Node 22-only acceptance runner owns the disposable PostgreSQL container, migrations, one-time bootstrap, pilot build, API process, restart control, and cleanup. One Playwright scenario drives exactly three isolated contexts through the real UI and uses same-origin browser requests only for privacy assertions that the UI does not expose directly. No application route is mocked.

**Tech Stack:** Node.js 22, pnpm 10, Docker, PostgreSQL 16, Prisma, Fastify, React/Vite, Playwright.

## Global Constraints

- Use the real Task 5 server and a pilot-mode production build; no route interception or mocked application responses.
- Use exactly three isolated browser contexts: `ADMIN`, `OWNER`, and `PROVIDER`.
- Session credentials remain only in real HttpOnly cookies; no authentication data may enter browser storage or committed files.
- The runner must clean the API process, PostgreSQL container, and temporary evidence directory on success or failure.
- Address and evidence checks must exercise backend authorization, not only DOM hiding.
- Mobile acceptance uses a 390×844 viewport, at least 44px visible controls, and no horizontal overflow.

---

### Task 1: Disposable live acceptance environment

**Files:**
- Create: `scripts/run-pilot-live-acceptance.mjs`
- Create: `apps/admin/playwright.live.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Docker with a `postgres:16-alpine` image and an installed Chrome channel.
- Produces: `pnpm test:e2e:live`, a Node 22-guarded command that exports only ephemeral values to its child process and always tears them down.

- [x] **Step 1: Add a package script that invokes the not-yet-created runner, then run it and verify RED**

  Run: `pnpm test:e2e:live`
  Expected: FAIL because `scripts/run-pilot-live-acceptance.mjs` does not exist.

- [x] **Step 2: Implement the minimal runner and Playwright configuration**

  The runner must allocate loopback ports, start PostgreSQL 16, verify `server_version`, deploy Prisma migrations, build pilot assets, bootstrap one admin invite without logging it, start/restart the actual API process, invoke Playwright, and clean all owned resources in `finally`.

- [x] **Step 3: Run the command and verify the environment reaches Playwright GREEN**

  Run: `pnpm test:e2e:live`
  Expected: the runner reaches Playwright; the scenario may still fail until Task 2 is complete, while teardown reports no retained container or temporary directory.

### Task 2: Real three-role browser journey

**Files:**
- Create: `apps/admin/e2e/pilot-live.spec.ts`

**Interfaces:**
- Consumes: `PILOT_ACCEPTANCE_BASE_URL`, `PILOT_ACCEPTANCE_ADMIN_INVITE`, and `PILOT_ACCEPTANCE_CONTROL_URL` from Task 1.
- Produces: one serial scenario covering bootstrap login, nicknames, owner/provider invitations, provider review, pet/address/order creation, fee confirmation, dispatch, invitation acceptance, address window, check-in state, evidence, checklist/report, owner confirmation, restart persistence, role privacy, and mobile boundaries.

- [x] **Step 1: Write the scenario through owner order creation and run RED**

  Run: `pnpm test:e2e:live`
  Expected: FAIL at the first unimplemented or incorrectly selected live behavior, with no mocked routes.

- [x] **Step 2: Complete the minimal scenario and fix only gaps demonstrated by live failures**

  Collect response IDs from real network responses, assert cookies are HttpOnly/Lax, assert storage is empty, and use same-origin `fetch` from each authenticated page for address/evidence authorization boundaries.

- [x] **Step 3: Run the scenario GREEN and inspect cleanup**

  Run: `pnpm test:e2e:live`
  Expected: 1 passed; the runner confirms PostgreSQL 16, one API restart, and cleanup without printing secrets.

### Task 3: Operator and acceptance documentation

**Files:**
- Create: `docs/operations/pilot-quickstart.md`
- Create: `docs/testing/pilot-live-acceptance.md`
- Modify: `README.md`
- Create: `task-9-report.md`
- Modify: `01-Projects/pet-home-service-platform/2026-08-23-implementation-progress.md` outside the repository, as required by the Vault instructions.

**Interfaces:**
- Produces: safe operator commands, environment generation methods without values, acceptance scope and troubleshooting, and an evidence-backed Task 9 report.

- [x] **Step 1: Write the operator quickstart and test contract without secret examples**

- [x] **Step 2: Run secret-pattern and prohibited-feature scans**

  Run: `rg -n "(PILOT_AUTH_PEPPER|FIELD_ENCRYPTION_KEY_V1)=.+|BEGIN PRIVATE KEY|postgresql://[^<]" README.md docs task-9-report.md`
  Expected: no committed real values.

- [x] **Step 3: Run complete verification and write the report from fresh output**

  Run under Node 22: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm pilot:build && pnpm --filter @pet/admin test:e2e && pnpm test:e2e:pilot && pnpm test:e2e:live`
  Expected: all commands exit 0.

- [x] **Step 4: Confirm cleanup and commit**

  Verify no `petcare-live-*` container/process/temp artifact remains, update the durable Vault summary, then commit the repository changes.
