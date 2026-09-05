# Task 10 report — production web acceptance and operations

## Delivered

- Added `production-web-access.spec.ts`, selected by the live Playwright config. It drives real Chrome against the built Fastify website and temporary PostgreSQL 16 through guest recovery, CAT/DOG bookings in Nanjing, staff first-login password changes, provider approval, owner/admin conversation, 403 isolation, fee confirmation, dispatch, local upload-adapter fulfillment, restart persistence, and logout.
- The live runner bootstraps the first admin through an in-process TTY-shaped service call. Generated passwords stay in process memory and are exposed only to the running Playwright process over a random loopback-only control URL; traces, video, and screenshots remain disabled.
- Added deployment assertions (8 total) and runbook/template coverage for interactive administrator bootstrap, migrations/readiness, HTTPS same-origin/Secure cookies, private S3, encryption-key rotation, session pepper, shared ingress limiter boundary, backups, and GitHub Pages’ demo-only boundary.

## Evidence

- RED: the new acceptance spec initially failed under the old runner because `PILOT_ACCEPTANCE_CREDENTIALS_URL` was absent.
- Node 22.22.2: `node --test scripts/production-deployment-files.test.mjs` — 8/8 passed.
- Node 22.22.2: `node --test scripts/pilot-live-state.test.mjs scripts/pilot-live-children.test.mjs` — 6/6 passed.
- Node 22.22.2: `tsc -p apps/admin/tsconfig.json --noEmit` passed.
- `git diff --check` passed.

## Residual

- This host’s default `pnpm` resolves Node 26.3.0, so it correctly refuses `pnpm test:e2e:live`; use Node 22 on PATH. A full live run was started with Node 22 and reached PostgreSQL migration, built UI, real Fastify readiness, and Chrome test launch. It was stopped while debugging the runner’s control-server close behavior; an exact stale-run marker/container remains and the runner will safely reclaim it on the next `pnpm test:e2e:live`. No credentials were logged.

## Debug follow-up

- Reproduced the first CTA failure with bounded browser diagnostics. The navigation was `200`, the real session endpoint was expected `401 UNAUTHENTICATED`, and the built pilot landing rendered without page errors. At the configured 390px mobile viewport, the CSS hides the header CTA: its HTML text was present but it was absent from Playwright's visible role tree; the visible mobile alternatives were the service-specific booking controls.
- The acceptance now sets the owner/attacker viewport to desktop before asserting the required visible `立即预约` path, while all remaining contexts retain the configured mobile viewport. Clipboard extraction was replaced by an authenticated, browser-origin recovery-rotation response after exercising copy/download, avoiding an unbounded browser clipboard read.

## Final live acceptance

- Root-agent debugging aligned stale test selectors and flow assumptions with the shipped UI: the credential acknowledgement is `我已保存`, the initial booking is already open after credential acknowledgement, later bookings use the service-specific action, existing addresses are selected on the second booking, staff form labels use exact matching, conversation updates are explicitly refreshed, and dispatch/provider refreshes wait for their real HTTP responses.
- The Playwright live config now bounds individual actions to 10 seconds and navigation to 15 seconds, so selector drift fails promptly instead of consuming the five-minute scenario timeout.
- Node `v22.22.2`: `pnpm test:e2e:live` passed the complete production web scenario (`1 passed`, 15.3 seconds) against a fresh disposable PostgreSQL 16 database and real Chrome. The run restarted the Fastify process, verified persisted completion state, then removed the API process, database container, and temporary browser artifacts.

## Review-fix follow-up

- Regression-first readiness coverage now proves a production pilot with only a validated `FIELD_ENCRYPTION_KEYRING` and active version is encryption-ready. `readinessSnapshot` accepts that validated configuration; the focused configuration/readiness suite passed 60 tests.
- The deployment file gate now asserts the executable Compose bootstrap order: external PostgreSQL is reachable, build the API image, use the Compose environment for one-shot `prisma migrate deploy`, run `staff:create-admin` with `-it`, start `app caddy`, then curl same-origin readiness. The runbook also states that Caddy has no shared cross-replica limiter state, requires managed WAF/Redis-capable enforcement, includes a two-source curl/429 validation, and leaves the declaration blank until validation.
- The recovery browser flow now captures the actual Playwright download and reads it only in memory, proves the downloaded link is same-origin and contains no unrelated configuration secret, and uses an init-script write-only clipboard spy rather than reading the host clipboard. It proves the initial credential recovers the same owner/order in a second context; repeated concurrent owner-session calls preserve the same `userId`; a duplicate initial issue is exactly `409 RECOVERY_ALREADY_ISSUED`; rotation makes the old credential exactly `403 FORBIDDEN`; and the new credential recovers the order in a new context.
- A route regression changed stale/invalid recovery credentials from a distinguishable `401 RECOVERY_INVALID` to normalized `403 FORBIDDEN`. Staff bad-login behavior remains `401 STAFF_LOGIN_INVALID`.

## Review-fix evidence

- RED observed first: keyring-only readiness returned `ready: false, encryption: false`; deployment assertions failed before the Compose/bootstrap and ingress documentation existed; recovery-route contract failed as `401` before normalization.
- Node `v22.22.2`: `vitest run apps/api/tests/production-readiness.test.ts apps/api/tests/config.test.ts` — 60/60 passed.
- Node `v22.22.2`: `vitest run apps/api/tests/production-access-routes.test.ts` — 7/7 passed.
- Node `v22.22.2`: `node --test scripts/production-deployment-files.test.mjs` — 8/8 passed.
- Node `v22.22.2`: `node --test scripts/pilot-live-state.test.mjs scripts/pilot-live-children.test.mjs` — 6/6 passed.
- Node `v22.22.2`: `node scripts/run-pilot-live-acceptance.mjs` — 1 real Chrome test passed in 16.1 seconds against a fresh PostgreSQL 16 container; Fastify restart persistence also passed.
- Node `v22.22.2` pinned on `PATH`: `pnpm lint` and `pnpm typecheck` passed. `git diff --check` passed.
- After the live run, no `petcare-live-*` temporary directory and no Docker container carrying `com.petcare.live-acceptance=true` remained. Playwright trace/video/screenshot are disabled and the runner removes its temporary download/output directory.
