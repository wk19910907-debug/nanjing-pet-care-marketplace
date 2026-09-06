# Local Production Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before claiming success.

**Goal:** Provide a one-command, locally hosted production rehearsal with persistent PostgreSQL, private S3-compatible evidence storage, generated production secrets, and a Coraza/OWASP CRS WAF, then prove the complete browser workflow survives restarts.

**Architecture:** Keep the existing public-production deployment unchanged and add an isolated `local-production` Compose project. A custom Caddy image terminates local HTTPS and runs Coraza with OWASP CRS before routing the application hostname to the private API container and the storage hostname to private MinIO. PostgreSQL, MinIO, and Caddy state use named volumes. A PowerShell controller creates secrets outside the repository under `%LOCALAPPDATA%\NanjingPetCare`, initializes the private bucket and first administrator, starts services in dependency order, and runs acceptance checks without printing secret values.

**Tech Stack:** Docker Compose, PostgreSQL 16, MinIO, Caddy 2.11.4, Coraza Caddy v2, OWASP Core Rule Set, PowerShell 7, Node.js 22, TypeScript, Vitest, Playwright.

## Global Constraints

- Do not modify the semantics of `deploy/compose.production.yml` or weaken its current fail-closed public-production controls.
- Never write credentials, signed URLs, cookies, payment data, or generated `.env` contents inside the repository or Obsidian Vault.
- The generated local-production secret directory must be restricted to the current Windows user and `SYSTEM`; scripts must redact values from normal output.
- Publish only WAF ports to the host. PostgreSQL may bind a loopback-only maintenance port; MinIO API and console must not bind host ports.
- The bucket must remain private. Browser access is only through short-lived signed capabilities.
- Ordinary stop/restart operations must preserve named volumes. Volume deletion must be a separate, explicitly named destructive command and is not part of automated tests.
- Pin all production-rehearsal container images and the Coraza plugin version; do not use floating `latest` tags.
- WAF blocking must reject representative SQL injection, path traversal, and reflected-XSS probes while allowing the normal API and evidence upload workflow.
- Local rate limiting is explicitly single-instance rehearsal behavior, not a claim of distributed production protection.

---

### Task 1: Support separate internal and browser-facing S3 endpoints

**Files:**
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/adapters/aws-s3-signer.ts`
- Modify: `apps/api/tests/aws-s3-signer.test.ts`
- Modify: `apps/api/tests/production-readiness.test.ts`
- Modify: `apps/api/tests/server.test.ts`
- Modify: `deploy/.env.production.example`
- Modify: `scripts/production-deployment-files.test.mjs`

**Step 1: Write failing configuration tests**

Add `S3_PUBLIC_ENDPOINT` as an optional exact HTTP(S) origin. Assert that:

```ts
const config = loadConfig({
  ...pilotProductionEnvironment,
  S3_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'https://storage.petcare.localhost',
});
expect(config.production?.objectStorage).toMatchObject({
  endpoint: 'http://minio:9000',
  publicEndpoint: 'https://storage.petcare.localhost',
});
```

Also assert malformed paths, query strings, and non-HTTP protocols fail parsing. Run:

```powershell
pnpm --filter @pet/api test -- production-readiness.test.ts server.test.ts
```

Expected: FAIL because the public endpoint is not parsed.

**Step 2: Write failing signer routing test**

Refactor the signer dependency seam so tests can distinguish commands sent to an internal client from URLs presigned by a public-endpoint client. Assert bucket probes and object heads use `S3_ENDPOINT`, while PUT/GET presigning uses `S3_PUBLIC_ENDPOINT` when provided. Also assert the optional field is absent from logs and command serialization containing credentials.

Run:

```powershell
pnpm --filter @pet/api test -- aws-s3-signer.test.ts
```

Expected: FAIL because only one client exists.

**Step 3: Implement minimal dual-client signing**

Extend `ObjectStorageConfig`:

```ts
export type ObjectStorageConfig = {
  endpoint: string;
  publicEndpoint?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  forcePathStyle: boolean;
};
```

Create one internal client for `HeadBucket`/`HeadObject` and a second signing client only when `publicEndpoint` differs. Keep the same credentials and path-style setting so MinIO signatures remain valid. Preserve all current checksum and expiration behavior.

**Step 4: Update production configuration contract and tests**

Document `S3_PUBLIC_ENDPOINT` in `deploy/.env.production.example` as optional and useful only when the application reaches storage through a private address but browsers require a public origin. Update the deployment-file assertions without making it required for existing production deployments.

**Step 5: Verify and commit**

```powershell
pnpm --filter @pet/api test -- aws-s3-signer.test.ts production-readiness.test.ts server.test.ts
pnpm --filter @pet/api typecheck
pnpm test:deploy
git add apps/api/src/config.ts apps/api/src/adapters/aws-s3-signer.ts apps/api/tests/aws-s3-signer.test.ts apps/api/tests/production-readiness.test.ts apps/api/tests/server.test.ts deploy/.env.production.example scripts/production-deployment-files.test.mjs
git commit -m "feat: support browser-facing S3 signing endpoint"
```

---

### Task 2: Generate and protect local production secrets

**Files:**
- Create: `scripts/local-production-secrets.ps1`
- Create: `scripts/local-production-secrets.test.ps1`
- Modify: `.gitignore`
- Modify: `package.json`

**Step 1: Write failing PowerShell tests**

The tests must use an isolated temporary `LOCALAPPDATA`, then assert:

- the default target resolves to `%LOCALAPPDATA%\NanjingPetCare` and is outside the repository;
- first run creates `local-production.env` plus `admin-password` using cryptographic randomness;
- generated Base64 pepper and encryption key decode to exactly 32 bytes;
- PostgreSQL, MinIO root, MinIO app, and administrator passwords meet length requirements;
- second run is idempotent and does not rotate existing values;
- standard output contains paths and status only, never any generated value;
- ACL inheritance is removed and access is limited to the current user and `SYSTEM`;
- a target inside the repository or Vault is rejected.

Run:

```powershell
pwsh -NoProfile -File scripts/local-production-secrets.test.ps1
```

Expected: FAIL because the generator does not exist.

**Step 2: Implement the generator**

Use `System.Security.Cryptography.RandomNumberGenerator` directly. Write files with UTF-8 without BOM and fail if an existing file is malformed rather than silently replacing it. Include only local-rehearsal values, such as:

```text
NODE_ENV=production
PILOT_MODE=enabled
PILOT_SHARED_INGRESS_RATE_LIMITING=enabled
SITE_DOMAIN=petcare.localhost
STORAGE_DOMAIN=storage.petcare.localhost
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=https://storage.petcare.localhost
S3_BUCKET=pet-evidence
```

Generate secret fields without echoing the completed lines. Write the initial administrator password only to `admin-password`; do not put it in the env file.

**Step 3: Add a safe package entry point**

Add:

```json
"local-production:secrets": "pwsh -NoProfile -File scripts/local-production-secrets.ps1"
```

Ignore only defensive in-repository fallbacks such as `.local-production/`; the normal secret location remains outside the repository.

**Step 4: Verify and commit**

```powershell
pwsh -NoProfile -File scripts/local-production-secrets.test.ps1
git diff --check
git add .gitignore package.json scripts/local-production-secrets.ps1 scripts/local-production-secrets.test.ps1
git commit -m "feat: generate protected local production secrets"
```

---

### Task 3: Add persistent PostgreSQL and private MinIO services

**Files:**
- Create: `deploy/compose.local-production.yml`
- Create: `deploy/local-production/minio-init.sh`
- Create: `scripts/local-production-deployment-files.test.mjs`
- Modify: `package.json`

**Step 1: Write failing static infrastructure tests**

Parse or inspect the Compose configuration and assert:

- pinned PostgreSQL 16 and MinIO images;
- named `postgres_data` and `minio_data` volumes;
- PostgreSQL binds only `127.0.0.1:${POSTGRES_MAINTENANCE_PORT}:5432`;
- MinIO API and console have no host `ports`;
- health checks exist for both services;
- application and init jobs depend on healthy services;
- separate `edge` and `backend` networks exist, with fixed WAF/app addresses matching the application's trusted-proxy value;
- app, database, and MinIO drop capabilities and use `no-new-privileges` where compatible;
- JSON logs are bounded;
- no secret literal is present.

Run:

```powershell
node --test scripts/local-production-deployment-files.test.mjs
```

Expected: FAIL because the Compose file does not exist.

**Step 2: Implement the Compose foundation**

Use the external env file through the controller's `docker compose --env-file` option. Define `postgres`, `minio`, and a one-shot `minio-init` service. `minio-init.sh` must:

```sh
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing "local/$S3_BUCKET"
mc anonymous set none "local/$S3_BUCKET"
mc version enable "local/$S3_BUCKET"
mc cors set "local/$S3_BUCKET" /config/cors.json
```

Create the application service skeleton in this task; Tasks 4 and 5 add its WAF image and ordered bootstrap dependencies. Map only the exact variables the app needs instead of attaching the whole env file, so it receives the scoped MinIO application credentials and never the MinIO root credentials.

**Step 3: Provision scoped MinIO credentials**

Have `minio-init` create a policy restricted to the single bucket and the operations required for signed PUT/GET/HEAD. Create or update the app service account idempotently, attach the policy, and verify anonymous access remains disabled. Mount generated policy/CORS templates read-only or generate them in the init container without writing secrets.

Allowed CORS origins are exactly `https://petcare.localhost`; methods are `GET`, `PUT`, and `HEAD`; expose only checksum and ETag headers.

**Step 4: Verify and commit**

```powershell
node --test scripts/local-production-deployment-files.test.mjs
docker compose --env-file "$env:LOCALAPPDATA\NanjingPetCare\local-production.env" -f deploy/compose.local-production.yml config --quiet
git add deploy/compose.local-production.yml deploy/local-production/minio-init.sh scripts/local-production-deployment-files.test.mjs package.json
git commit -m "feat: add persistent local Postgres and private MinIO"
```

---

### Task 4: Build the Coraza and OWASP CRS WAF edge

**Files:**
- Create: `deploy/local-production/Dockerfile.waf`
- Create: `deploy/local-production/Caddyfile`
- Create: `deploy/local-production/coraza.conf`
- Modify: `deploy/compose.local-production.yml`
- Modify: `scripts/local-production-deployment-files.test.mjs`

**Step 1: Extend failing deployment tests**

Assert the WAF image is built with pinned Caddy and `github.com/corazawaf/coraza-caddy/v2@v2.5.0`, the Caddy global order contains `order coraza_waf first`, OWASP CRS is loaded, the WAF is in blocking mode, and only WAF binds host ports 80/443. Assert routing:

```caddyfile
https://petcare.localhost {
  coraza_waf {
    directives `Include /etc/caddy/coraza.conf`
  }
  reverse_proxy app:3000
}

https://storage.petcare.localhost {
  reverse_proxy minio:9000
}
```

The storage host must not expose the MinIO console or apply request-body transformations that invalidate AWS signatures.

Run the static test and expect failure before implementation.

**Step 2: Build a pinned WAF image**

Use a pinned `caddy:<version>-builder` stage with `xcaddy build --with github.com/corazawaf/coraza-caddy/v2@v2.5.0`, then copy the binary into a matching Alpine Caddy runtime. Run as a non-root user where Caddy's local ports/capabilities allow it, keep the root filesystem read-only, and persist `/data` and `/config`.

**Step 3: Configure conservative blocking**

Set Coraza to blocking mode and load the bundled OWASP CRS through `load_owasp_crs`. Start with a conservative paranoia level and explicit request body limits suitable for small JSON API requests. Preserve Caddy's canonical single-value client IP forwarding to the app, which trusts only the fixed WAF address.

Keep the storage virtual host outside CRS inspection so signed upload bodies and query parameters are not mutated, while still terminating TLS and refusing console paths.

**Step 4: Validate the image and commit**

```powershell
node --test scripts/local-production-deployment-files.test.mjs
docker compose --env-file "$env:LOCALAPPDATA\NanjingPetCare\local-production.env" -f deploy/compose.local-production.yml build waf
docker compose --env-file "$env:LOCALAPPDATA\NanjingPetCare\local-production.env" -f deploy/compose.local-production.yml run --rm --no-deps waf caddy validate --config /etc/caddy/Caddyfile
git add deploy/local-production/Dockerfile.waf deploy/local-production/Caddyfile deploy/local-production/coraza.conf deploy/compose.local-production.yml scripts/local-production-deployment-files.test.mjs
git commit -m "feat: add local Coraza WAF edge"
```

---

### Task 5: Automate migrations, private-bucket setup, and initial administrator creation

**Files:**
- Create: `apps/api/src/pilot/bootstrap-local-production-admin.ts`
- Create: `apps/api/tests/bootstrap-local-production-admin.test.ts`
- Modify: `apps/api/package.json`
- Modify: `deploy/compose.local-production.yml`
- Modify: `scripts/local-production-deployment-files.test.mjs`

**Step 1: Write failing bootstrap tests**

Test a narrow local-production bootstrap command that:

- refuses to run unless `LOCAL_PRODUCTION_REHEARSAL=enabled`;
- reads the password only from an explicitly supplied file path;
- requires a regular file with restrictive permissions where the platform supports checking them;
- creates only the initial `admin` credential;
- is idempotent when that same administrator already exists;
- does not print or return the password;
- refuses arbitrary username/password CLI arguments.

Use injected file/database dependencies so unit tests never touch real secrets. Run:

```powershell
pnpm --filter @pet/api test -- bootstrap-local-production-admin.test.ts
```

Expected: FAIL because the local bootstrap command does not exist.

**Step 2: Implement the guarded bootstrap command**

Reuse `StaffCredentialService.bootstrapInitialAdmin`; do not duplicate password hashing or database writes. The command receives `/run/secrets/admin-password` from a read-only bind mount, trims one final newline, validates the password policy, creates `admin`, and emits only a status code/message. It must refuse all non-local-rehearsal invocations.

**Step 3: Add one-shot migration and bootstrap services**

In Compose, add ordered jobs:

1. `postgres` and `minio` healthy;
2. `minio-init` completes successfully;
3. `migrate` runs `prisma migrate deploy`;
4. `admin-init` creates the initial admin from the mounted password file;
5. `app` starts and becomes healthy;
6. `waf` starts.

All one-shot jobs must fail closed. None may publish ports or log secrets.

**Step 4: Verify and commit**

```powershell
pnpm --filter @pet/api test -- bootstrap-local-production-admin.test.ts
pnpm --filter @pet/api typecheck
node --test scripts/local-production-deployment-files.test.mjs
git add apps/api/src/pilot/bootstrap-local-production-admin.ts apps/api/tests/bootstrap-local-production-admin.test.ts apps/api/package.json deploy/compose.local-production.yml scripts/local-production-deployment-files.test.mjs
git commit -m "feat: automate guarded local production bootstrap"
```

---

### Task 6: Add lifecycle controller and non-secret status output

**Files:**
- Create: `scripts/local-production.ps1`
- Create: `scripts/local-production.test.ps1`
- Modify: `package.json`

**Step 1: Write failing controller tests**

Mock the external processes and assert the controller supports only these actions:

```text
start   generate/validate secrets, build, initialize, and start
status  show container health and public origins without values
stop    stop containers and preserve volumes
verify  run security and browser acceptance
```

Assert there is no implicit `down -v`, no secret content in output, Docker absence produces an actionable error, Compose failures propagate a nonzero exit, and the secret directory can be overridden only to another absolute path outside the repository.

Run:

```powershell
pwsh -NoProfile -File scripts/local-production.test.ps1
```

Expected: FAIL because the controller does not exist.

**Step 2: Implement the controller**

Use argument arrays rather than shell-composed command strings. Always call Compose with an explicit project name, env file, and compose file. `start` should run the secret generator, preflight Docker, build images, start dependencies/jobs/application, then wait on `https://petcare.localhost/health/ready` using a bounded retry. Do not bypass a failed init job.

Because the local Caddy CA is not a publicly trusted certificate, print one concise note that browser automation trusts it only for this rehearsal. Do not install a system root certificate automatically.

**Step 3: Add package commands**

```json
"local-production:start": "pwsh -NoProfile -File scripts/local-production.ps1 start",
"local-production:status": "pwsh -NoProfile -File scripts/local-production.ps1 status",
"local-production:stop": "pwsh -NoProfile -File scripts/local-production.ps1 stop",
"local-production:verify": "pwsh -NoProfile -File scripts/local-production.ps1 verify"
```

**Step 4: Verify and commit**

```powershell
pwsh -NoProfile -File scripts/local-production.test.ps1
pnpm local-production:status
git add scripts/local-production.ps1 scripts/local-production.test.ps1 package.json
git commit -m "feat: automate local production lifecycle"
```

---

### Task 7: Prove WAF blocking, private storage, restart persistence, and the browser workflow

**Files:**
- Create: `scripts/verify-local-production.mjs`
- Create: `scripts/verify-local-production.test.mjs`
- Create: `apps/admin/e2e/local-production.spec.ts`
- Modify: `scripts/local-production.ps1`
- Modify: `package.json`

**Step 1: Write failing acceptance-runner tests**

The runner must report only named checks and status codes. Unit-test that it never logs cookies, authorization headers, signed query strings, or secret environment values. Test bounded retries and cleanup behavior.

Run:

```powershell
node --test scripts/verify-local-production.test.mjs
```

Expected: FAIL because the verifier does not exist.

**Step 2: Implement infrastructure security probes**

Against the running stack, verify:

- `/health/ready` reports database, object storage, encryption, and administrator readiness;
- anonymous bucket listing, anonymous known-object GET, and MinIO console paths are denied;
- a valid short-lived signed PUT with checksum succeeds, a signed GET succeeds, and a tampered key/signature fails;
- WAF returns a blocking response for representative SQL injection, path traversal, and XSS payloads;
- a normal booking/API request is not blocked;
- direct host access to app, MinIO API, and MinIO console is unavailable;
- app logs do not contain probe secrets or full signed URLs.

**Step 3: Implement the real Chrome workflow**

Launch Playwright Chromium with HTTPS errors ignored only in this isolated test context. Use the generated administrator password by reading the external file in the runner without printing it. Exercise the existing owner/admin/provider/evidence flow against `https://petcare.localhost`, including a real signed image upload to MinIO and a signed evidence read through `https://storage.petcare.localhost`.

Reuse stable helpers from `apps/admin/e2e/production-web-access.spec.ts` where practical, but keep this test capable of running against the already-started Compose stack.

**Step 4: Prove restart persistence**

Record non-secret identifiers and object checksum, run an ordinary Compose stop/start without `-v`, then assert:

- the administrator can still sign in;
- the created order still exists;
- the evidence object still returns the same checksum;
- readiness and WAF blocking still pass.

**Step 5: Verify and commit**

```powershell
node --test scripts/verify-local-production.test.mjs
pnpm local-production:start
pnpm local-production:verify
pnpm local-production:stop
git add scripts/verify-local-production.mjs scripts/verify-local-production.test.mjs apps/admin/e2e/local-production.spec.ts scripts/local-production.ps1 package.json
git commit -m "test: verify local production infrastructure closed loop"
```

---

### Task 8: Document operation and perform final regression verification

**Files:**
- Create: `deploy/LOCAL_PRODUCTION.md`
- Modify: `README.md`
- Modify: `scripts/local-production-deployment-files.test.mjs`
- Create: `01-Projects/pet-home-service-platform/2026-09-06-local-production-infrastructure.md` (Obsidian durable summary, outside repository if the repo is under `00-Inbox`)

**Step 1: Add failing documentation assertions**

Require the runbook to document prerequisites, exact start/status/verify/stop commands, both local origins, the external secret path, how to retrieve the initial administrator password without copying it into chat/logs, backup/restore commands, certificate limitations, preserved-volume behavior, and the remaining differences from real public production.

It must explicitly state that public deployment still requires a real domain, public certificate/DNS, managed or separately operated WAF, off-host backups, distributed/shared rate limiting, monitoring/alerting, and production account credentials.

**Step 2: Write the runbook and top-level entry point**

Keep the happy path to four commands:

```powershell
pnpm local-production:start
pnpm local-production:status
pnpm local-production:verify
pnpm local-production:stop
```

Document volume backups using non-destructive archive/export commands. Document destructive reset separately with a prominent warning, but do not provide an automatically invoked reset script.

**Step 3: Run complete verification**

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:deploy
node --test scripts/local-production-deployment-files.test.mjs scripts/verify-local-production.test.mjs
pwsh -NoProfile -File scripts/local-production-secrets.test.ps1
pwsh -NoProfile -File scripts/local-production.test.ps1
pnpm local-production:start
pnpm local-production:verify
pnpm local-production:stop
git diff --check
git status --short
```

Expected: all automated checks pass; live verification confirms the closed loop; stop leaves all persistent volumes intact.

**Step 4: Review and commit**

Perform a requirements review against `docs/superpowers/specs/2026-09-06-local-production-infrastructure-design.md` and a separate code-quality/security review. Resolve every finding and rerun affected checks. Then:

```powershell
git add README.md deploy/LOCAL_PRODUCTION.md scripts/local-production-deployment-files.test.mjs
git commit -m "docs: add local production operations runbook"
```

Write the durable Obsidian summary with no secret values, noting commit ids, verification evidence, service origins, and remaining public-production prerequisites.
