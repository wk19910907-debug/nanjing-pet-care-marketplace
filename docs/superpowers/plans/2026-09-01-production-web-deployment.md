# Production Web Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and verify a provider-neutral production deployment bundle for the existing HTTPS website/API, PostgreSQL and S3-backed controlled pilot.

**Architecture:** Build the existing React pilot frontend and Fastify/Prisma API into one Node 22 container. Run it behind Caddy automatic HTTPS; consume externally managed PostgreSQL and private S3-compatible storage through secrets stored only on the target host. The app migrates before starting and fails closed on missing production dependencies.

**Tech Stack:** Node.js 22.23.2 Alpine official image, pnpm 10.15.0, Fastify 5, React/Vite, Prisma 6/PostgreSQL, Docker Compose, Caddy 2.11.4.

## Global Constraints

- Website frontend and API remain same-origin; only Caddy publishes ports 80 and 443.
- Preserve manual payment, platform matching, all existing auth/role checks, database schema and S3 checksum rules.
- No API keys, passwords, certificates, connection strings, signed URLs, cookies, real addresses or payment data in Git, build context, image labels, logs, Vault notes or examples.
- Production missing configuration, failed migration, failed readiness, unavailable database or unavailable S3 must fail closed; never fall back to demo auth or filesystem evidence.
- Do not touch the currently running local database, object evidence, server PID or port 51800.
- Use Node 22 and pnpm 10.15.0; do not upgrade application dependencies.
- Initial infrastructure is a controlled pilot, not proof of payment, legal, insurance, ICP, notification or scale readiness.

---

### Task 1: Reproducible production application image

**Files:**
- Create: `.dockerignore`
- Create: `Dockerfile`
- Create: `deploy/entrypoint.sh`
- Create: `scripts/production-deployment-files.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `pnpm pilot:build`, `prisma/schema.prisma`, migrations, `pnpm --filter @pet/api start:pilot`, and `/health/ready`.
- Produces: image that accepts existing production environment variables, exposes internal port 3000, migrates once, then starts Fastify as non-root user.

- [ ] **Step 1: Write the failing static deployment test**

Create a Node test that reads the three deployment files and asserts: pinned Node 22.23.2 Alpine base, frozen pnpm install, pilot build, Prisma generation, non-root runtime, entrypoint `migrate deploy` before `start:pilot`, healthcheck, and `.dockerignore` exclusions for `.git`, `.env*`, `node_modules`, `dist`, backups, evidence and Vault scratch paths. Add root script `test:deploy` invoking `node --test scripts/production-deployment-files.test.mjs`.

- [ ] **Step 2: Run RED**

Run: `pnpm test:deploy`

Expected: FAIL because `.dockerignore`, `Dockerfile` and `deploy/entrypoint.sh` do not exist.

- [ ] **Step 3: Implement the image and entrypoint**

Use `node:22.23.2-alpine3.24`, Corepack pnpm 10.15.0, `pnpm install --frozen-lockfile`, copy workspace source, generate Prisma and build pilot. Runtime installs only Alpine `openssl`, copies the built workspace with `node:node` ownership, uses `USER node`, exposes 3000, runs an HTTP readiness healthcheck, and invokes `/app/deploy/entrypoint.sh`. Entrypoint is POSIX `set -eu`, runs `pnpm exec prisma migrate deploy --schema prisma/schema.prisma`, then `exec pnpm --filter @pet/api start:pilot`.

- [ ] **Step 4: Run GREEN and build the image**

Run:

```powershell
pnpm test:deploy
docker build --pull --tag nanjing-petcare:deployment-test .
docker image inspect nanjing-petcare:deployment-test --format '{{json .Config}}'
```

Expected: tests pass; build exits 0; config reports user `node`, port `3000/tcp`, healthcheck and entrypoint. Do not start the image against any existing database.

- [ ] **Step 5: Commit**

Commit only Task 1 files with subject `build: add production application image`.

### Task 2: HTTPS Compose bundle and operator runbook

**Files:**
- Create: `deploy/compose.production.yml`
- Create: `deploy/Caddyfile`
- Create: `deploy/.env.production.example`
- Create: `deploy/README.md`
- Modify: `scripts/production-deployment-files.test.mjs`
- Create: `.github/workflows/production-image.yml`

**Interfaces:**
- Consumes: Task 1 image/build context and all existing production variables parsed by `apps/api/src/config.ts`.
- Produces: `docker compose -f deploy/compose.production.yml --env-file <secret-file> up -d --build`, automatic HTTPS, persistent Caddy state, CI image smoke build, and exact preflight/rollback/backup steps.

- [ ] **Step 1: Extend tests for Compose, Caddy, env example and workflow**

Assert Compose has only `caddy` ports `80:80`, `443:443`, `443:443/udp`; app uses `expose: 3000`, `env_file`, healthcheck dependency, `restart: unless-stopped`, log rotation and a private network. Assert Caddy uses `{$SITE_DOMAIN}`, `reverse_proxy app:3000`, encoding, HSTS, nosniff and no wildcard CORS. Assert the env example lists all pilot production variables with empty/nonsecret values, fixes host/port, disables WeChat login by default and is force-included despite `.env*` ignore. Assert CI performs deployment tests and `docker build` but does not push/deploy. Assert the runbook names DNS, TLS, secret generation, managed PostgreSQL TLS, private S3 CORS/checksum, migration/readiness, isolated smoke account, backup restore drill, rollback and known non-goals.

- [ ] **Step 2: Run RED**

Run: `pnpm test:deploy`

Expected: FAIL because Compose/Caddy/env/workflow/runbook do not exist.

- [ ] **Step 3: Implement deployment bundle**

Pin `caddy:2.11.4-alpine`. Compose builds the app locally, loads `deploy/.env.production`, sets fixed host/port, waits for app health before Caddy, uses `caddy_data` and `caddy_config`, log rotation, read-only container filesystems where compatible, tmpfs for `/tmp`, and no direct app host port. The example uses placeholders such as `https://pet.example.com` but never usable secret values. Runbook provides PowerShell/OpenSSL Base64 generation without echoing output into the repository and references official Docker/Prisma/Caddy guidance.

- [ ] **Step 4: Validate Compose and CI-facing build**

Copy the example to a temporary directory outside the repository, substitute syntactically valid dummy values only in that temporary file, then run:

```powershell
docker compose --env-file <temporary-file> -f deploy/compose.production.yml config
pnpm test:deploy
docker build --tag nanjing-petcare:deployment-test .
```

Expected: Compose config exits 0 without revealing secrets; tests and image build pass. Remove only the specifically created temporary file afterward.

- [ ] **Step 5: Run repository regression and commit**

Run with Node 22:

```powershell
pnpm lint
pnpm typecheck
pnpm test:deploy
pnpm --filter @pet/admin test
pnpm --filter @pet/api test
pnpm pilot:build
git diff --check
```

Expected: all exit 0 with existing optional live S3/production-account checks explicitly not counted. Commit Task 2 with subject `ops: add HTTPS production deployment bundle`.

## Final controlled deployment gate

Do not claim real deployment from local image/Compose success. A real target additionally requires: one user-owned domain with DNS control, one Linux host with Docker, a production PostgreSQL URL, a private S3-compatible bucket and its restricted credentials. After those exist, deploy from the validated commit, verify HTTPS and `/health/ready`, create new smoke identities, run the website order lifecycle, complete database backup/restore and only then hand off the production URL. Purchasing, identity verification, legal agreements and secret entry remain user-controlled actions.
