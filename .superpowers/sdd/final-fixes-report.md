# Final Review Fixes Report

Date: 2026-08-28

Branch: `feature/pilot-no-invite`

Starting HEAD: `9a1ac9e`

Runtime used for RED/GREEN and final verification: Node.js `v22.22.2`, pnpm `10.15.0`

## Status

All three final-review findings and the independent request-lifecycle follow-up are fixed and covered. The direct local-session endpoint is still absent in production; invitation compatibility and the existing cookie contract are unchanged. No secrets or authentication material were added to source, tests, logs, or this report.

## Finding closure

1. DNS rebinding / local authority binding
   - The development/test-only direct-session handler now fails closed unless configured `PILOT_HOST` is exactly one of `127.0.0.1`, `::1`, or `::ffff:127.0.0.1`.
   - It derives the one permitted HTTP authority from the configured literal host and `PILOT_PORT` (with IPv6 brackets), requires the raw Host header to equal it exactly, and requires an existing Origin header to equal the exact derived local HTTP origin.
   - The route-level `onRequest` guard runs before body parsing. Tests cover matching Host plus Origin success, absent Origin success, test mode, both configured IPv6 loopbacks with bracketed authorities, attacker Host, attacker Origin, wrong local Host port, wrong local Origin port, a non-literal configured host, and hostile-authority malformed/unsupported bodies. Every denial returns 403 and asserts the session service was not invoked.

2. Proxy spoofing
   - The guard now independently requires both `request.raw.socket.remoteAddress` (transport peer) and `request.ip` (Fastify effective client) to be in the exact loopback allowlist.
   - New coverage rejects a configured trusted external peer that forwards `X-Forwarded-For: 127.0.0.1` without invoking the service.
   - Existing trusted-loopback/forwarded-external and untrusted-spoof cases remain present and passing.

3. Direct-entry operating boundary
   - The unauthenticated direct-entry panel now states exactly: `仅限本机试运营；仅记录线下费用，不收集联系方式`.
   - Both the React component suite and pilot Playwright assert the exact visible sentence.

## TDD evidence

### API RED

Command:

`pnpm --filter @pet/api exec vitest run tests/pilot-auth-routes.test.ts`

Observed before production code changed: 6 expected failures and 29 passes. The trusted-external-peer, attacker/wrong Host and Origin, and non-literal configured-host cases all received 201 instead of the required 403, proving that the tests reproduced the findings.

### API GREEN (initial findings)

Same focused command after the minimal route guard: 1 file passed, 35/35 tests passed.

### Independent-review lifecycle RED

The read-only reviewer identified that a handler-level guard ran after Fastify parsing. Two new focused tests sent an attacker Host with malformed JSON and unsupported media. Before changing production code, they failed exactly as predicted: received 400 and 415 instead of the required 403; the other 39 tests passed and the service remained uncalled.

### Independent-review lifecycle GREEN

After moving the same guard to route-level `onRequest`, the focused command passed 41/41 tests. The same cycle also added successful coverage for `NODE_ENV=test`, configured `::1` and `::ffff:127.0.0.1` authorities, and a non-browser request with exact Host and no Origin.

### Admin RED

Command:

`pnpm --filter @pet/admin exec vitest run src/pilot/PilotApp.test.tsx`

Observed before component code changed: 1 expected failure and 14 passes because the exact boundary sentence was absent.

### Admin GREEN

Same focused command after the copy change: 1 file passed, 15/15 tests passed.

## Final verification evidence

All successful commands below ran with the Node 22 installation prepended to `PATH` and printed `v22.22.2`.

| Verification | Result |
| --- | --- |
| `pnpm --filter @pet/api typecheck` | exit 0 |
| `pnpm --filter @pet/admin typecheck` | exit 0 |
| `pnpm --filter @pet/api test -- tests/pilot-auth-routes.test.ts tests/config.test.ts tests/production-readiness.test.ts tests/pilot-composition.test.ts tests/pilot-session-service.test.ts tests/pilot-business-routes.test.ts` | final rerun after lifecycle fix: 6 files, 123/123 tests passed |
| `pnpm --filter @pet/admin test` | 13 files, 154/154 tests passed |
| `pnpm --filter @pet/admin test:e2e:pilot` | 4/4 Playwright tests passed, including the direct-entry browser assertion |
| `pnpm test:e2e:live` | final rerun after lifecycle fix: 1/1 real PostgreSQL 16 acceptance passed in 14.8 seconds; server restart succeeded; API process, database container, and temporary evidence artifacts were removed |
| `git diff --check` and `git diff --cached --check` | exit 0 |

The live scenario still creates exactly three isolated browser contexts at `apps/admin/e2e/pilot-live.spec.ts:213-215`. It exercised the genuine configured `127.0.0.1:<dynamic-port>` Host/Origin path successfully.

The production route-absence assertion remains in the 41-test auth-route suite and passed with 404. The same suite also retained secure production cookie assertions (`HttpOnly`, `SameSite=Lax`, `Secure`, `Path=/`) and invitation login/session behavior. The composition/session suites preserve invitation compatibility.

## Non-regression attempt note

An exploratory full `pnpm --filter @pet/api test` invocation was not a valid repository-wide verification in this shell: 171 tests passed, then ten unrelated legacy database suites failed during collection because no external `DATABASE_URL` was configured. No changed-file assertion failed. The final explicit 123-test pilot/config/security suite above is the relevant self-contained API verification, and the requested real-database coverage passed separately through `pnpm test:e2e:live` against a disposable PostgreSQL 16 instance.

A direct `pnpm --filter @pet/api exec vitest ...` composition run also exposed that `npm_execpath` is intentionally unavailable under `pnpm exec`; the final rerun of the same six files through the package `test` script supplied that documented command environment and passed 123/123.

## Self-review

- Direct-route registration condition remains development/test only; production behavior was not weakened.
- Security denials occur in route-level `onRequest`, before body parsing and before `createLocalSession`.
- Both network identities, raw Host, optional Origin, configured literal loopback host, and configured port are enforced together.
- Existing local injection fixtures now supply the configured Host/Origin only where the request is expected to reach body validation or session creation.
- Invitation routes, session service behavior, cookie options, and live-context count were not modified.
- UI change is limited to the requested boundary sentence plus component/browser assertions; Playwright uses exact text matching.
- No generated credentials, database passwords, tokens, cookies, or environment values are present in the diff.

## Concerns

No unresolved code concern. Operators must continue to use a literal loopback `PILOT_HOST`; aliases such as `localhost` now intentionally receive 403 on the direct-session endpoint even if DNS resolves them to loopback.

## Browser-canonical authority follow-up

Final review identified two valid browser-canonical spellings that the original exact comparison rejected: WHATWG URL parsing canonicalizes configured `::ffff:127.0.0.1` to `[::ffff:7f00:1]`, and omits default HTTP port 80 from both Host and Origin.

### RED

The focused tests construct request headers from `new URL(configuredOrigin).host` and `.origin` for both cases, while keeping the configured pilot host as the original allowed literal.

Command under Node.js `v22.22.2`:

`pnpm --filter @pet/api exec vitest run tests/pilot-auth-routes.test.ts`

Observed before production code changed: 2 expected failures and 40 passes. Both browser-canonical valid requests received 403 instead of 201, proving the manual authority/origin concatenation was the cause.

### GREEN

The guard now creates a WHATWG `URL` from the already-allowlisted literal loopback host and configured port, then compares raw Host with `URL.host` and optional Origin with `URL.origin`. The literal configured-host allowlist, raw/effective loopback IP checks, route-level pre-parser hook, exact comparisons, and denial behavior are unchanged.

Focused result: 1 file passed, 42/42 tests passed.

### Proportional verification after production change

All commands ran under Node.js `v22.22.2`:

| Verification | Result |
| --- | --- |
| `pnpm --filter @pet/api typecheck` | exit 0 |
| Six-file API pilot/config/security suite | 6 files, 124/124 tests passed |
| `pnpm --filter @pet/admin test:e2e:pilot` | 4/4 tests passed |
| `pnpm test:e2e:live` | 1/1 real PostgreSQL 16 acceptance passed in 14.4 seconds; server restart and cleanup succeeded |
| `git diff --check` and `git diff --cached --check` | exit 0 |

Self-review found no weakening of production route absence, invitation compatibility, secure cookie handling, three-context live isolation, or the fail-closed request boundary. No secrets or unrelated files were added.
