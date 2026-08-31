# Mini Fulfillment Implementation Plan

**Goal:** Replace false upload success with verified evidence and a server-driven service page.
**Architecture:** API adapter + native media adapter + testable service controller + thin pages.
**Tech stack:** TypeScript, Vitest, native WeChat API, noble-hashes, esbuild.

## Task 1 — Transport and media

Files: services/api.ts, services/evidence.ts, platform.d.ts, tests/evidence.test.ts,
tests/services.test.ts. Expose `getServiceOrder(id)`, `uploadEvidence(capability, bytes, mime)`
and `chooseEvidence()` returning `{ bytes, media } | null`.

- Write failing tests: issued headers propagate, upload PUT contains ArrayBuffer but no token,
  invalid URLs/headers and byte mismatches fail, media magic and 20 MiB bound, cancel returns null.
- Run `pnpm --filter @pet/miniprogram test` and observe failures.
- Implement strict capability parsing, raw PUT, SHA-256 on selected bytes; change check-in/report
  routes to `/api/v1/pilot/orders/:id/...` and omit client service timestamps.
- Re-run tests/typecheck. No schema or server security changes.

## Task 2 — Real service page

Files: services/provider-service.ts, pages/provider/service/index.ts/.wxml/.wxss,
pages/provider/invitations/index.ts/.wxml, pages/home/index.ts/.wxml,
tests/provider-service.test.ts, tests/provider-page.test.ts.

- Test failed uploads, ambiguous attach retry, busy lock, loaded server identity/status,
  refresh restoring evidence, cat/dog checklists, confirmation gates and server-only timestamps.
- Implement controller factory using API/media dependencies, state notification and stable
  pending attachment. Page binds controller; no successful-count increment on click.
- Load server task list and link to the service page. All failures show retryable generic copy.
- Verify controller and actual Page handlers, including no mutation after failed initial load.

## Task 3 — Importable bundle and release checks

Files: apps/miniprogram/scripts/build.mjs, package.json, project.config.json,
tests/build.test.ts, docs/operations/miniprogram.md.

- Write build smoke test for app + all pages in an isolated VM without Node globals. Test
  output assets and no unresolved workspace imports. Observe missing build failure first.
- Bundle entries to `apps/miniprogram/dist`, copy only declared assets, point project root to
  dist; no recursive deletion, no secrets or generated local endpoints committed.
- Run mini tests, full `pnpm check`, build, independent review, fix findings with regression tests.
- Sync verified changes through existing feature worktree/main workflow and write Vault summary.
