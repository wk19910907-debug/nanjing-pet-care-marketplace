# One-click Local Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the frontend-only double-click launcher with a safe one-click launcher for the real PostgreSQL-backed pilot application.

**Architecture:** A PowerShell orchestrator keeps protected machine-local state outside the Vault, reuses a named PostgreSQL container/volume, selects a bindable loopback port, builds and migrates the app, then runs the API in the foreground. The CMD file remains a small user-facing entry point.

**Tech Stack:** PowerShell 7/Windows DPAPI, Docker PostgreSQL 16, Node.js 22, pnpm 10, Prisma, Fastify/Vite pilot build.

## Global Constraints

- Do not change owner, provider, admin, catalog, pricing, or order behavior.
- Do not write secrets, cookies, tokens, `.env` contents, or payment data inside the repository or Obsidian Vault.
- Bind database and application ports to `127.0.0.1` only.
- Never delete or replace an existing container, volume, evidence directory, or protected state automatically.

---

### Task 1: Testable launcher helpers

**Files:**
- Create: `scripts/start-local-preview.test.ps1`
- Create: `scripts/start-local-preview.ps1`

**Interfaces:**
- Produces: `Get-FirstAvailablePort -StartPort <int> -EndPort <int> -Probe <scriptblock>` returning the first port for which the probe returns true.
- Produces: `Assert-LocalStatePath -Path <string> -LocalAppData <string>` returning the resolved path only when it is below the exact `NanjingPetCare` directory.

- [ ] **Step 1: Write failing dependency-free PowerShell tests**

Test preferred-port selection, fallback selection, exhaustion failure, accepted application-state path, and rejected sibling path.

- [ ] **Step 2: Run the test and verify RED**

Run: `pwsh -NoProfile -File scripts/start-local-preview.test.ps1`

Expected: failure because `scripts/start-local-preview.ps1` does not exist.

- [ ] **Step 3: Implement the minimal pure helpers**

Define the two functions without executing the launcher when the file is dot-sourced.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `pwsh -NoProfile -File scripts/start-local-preview.test.ps1`

Expected: `5 launcher helper tests passed` and exit code 0.

### Task 2: One-click orchestration and documentation

**Files:**
- Modify: `scripts/start-local-preview.ps1`
- Modify: `start-local.cmd`
- Modify: `package.json`
- Modify: `docs/operations/pilot-quickstart.md`

**Interfaces:**
- Consumes: `Get-FirstAvailablePort` and `Assert-LocalStatePath` from Task 1.
- Produces: `Start-LocalPreview`, invoked by `start-local.cmd`.

- [ ] **Step 1: Add orchestration behavior**

Generate or load DPAPI-protected local secrets, validate/reuse the named PostgreSQL 16 container, wait for SQL readiness, export process-only variables, install dependencies when missing, deploy migrations, build pilot assets, start the server, wait for readiness, and open the selected URL.

- [ ] **Step 2: Replace the CMD wrapper**

Resolve PowerShell 7 and call `scripts/start-local-preview.ps1`; preserve the process exit code and pause only on failure.

- [ ] **Step 3: Add the helper test to repository checks and document usage**

Add `test:local-start` and include it in `check`. Add a one-click section to the operations quickstart while retaining the isolated manual-run instructions.

- [ ] **Step 4: Run focused and full verification**

Run:

```powershell
pwsh -NoProfile -File scripts/start-local-preview.test.ps1
pnpm check
pnpm pilot:build
Invoke-RestMethod http://127.0.0.1:51800/health/ready
```

Expected: five helper tests pass, all repository checks pass, the pilot build exits 0, and readiness returns `ready: true` with `database: true`.

- [ ] **Step 5: Commit the implementation**

Commit only the launcher, tests, documentation, package script, design, and plan with message `feat: add safe one-click local runtime`.

