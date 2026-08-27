# Task 7 — Owner Pilot Workspace

## Delivered

- Replaced the Task 6 owner placeholder with a real same-origin, cookie-session workspace.
- Added create/list flows for owner pets and encrypted service-address submissions.
- Limited location selection to 建邺区、鼓楼区、玄武区、秦淮区 with the approved deterministic centroids.
- Limited orders to 上门喂猫 (`CAT_FEEDING`) and 上门遛狗 (`DOG_WALKING`).
- Added server quote display, fixed-price order submission, and a stable idempotency key reused across retries.
- Added owner-scoped order reads, exhaustive status copy, offline fee state, service timeline, report/checklist display, and completion confirmation.
- Added fail-closed response parsing that strips unexpected owner IDs, exact addresses, access instructions, evidence metadata, and other server-only fields.
- Kept exact addresses and notes out of localStorage/sessionStorage and sent `accessInstructions: ''`.
- Added responsive owner layouts for 390×844 with 44px-or-larger visible controls and no horizontal overflow.
- Kept the public `DemoApp` build and its Playwright suite separate from pilot-only tests.

## TDD evidence

- Owner API tests failed first because the new methods did not exist, then passed after the typed transport and parsers were implemented.
- Owner component tests failed first because `OwnerPilotWorkspace` did not exist, then passed after the sequential workspace was implemented.
- PilotApp integration failed first while the Task 6 placeholder remained, then passed after owner-role integration.
- Mobile Playwright failed first on sub-44px controls, then passed after responsive owner styles were added.
- Replay coverage failed first when a `200 PENDING_DISPATCH` idempotent response was rejected, then passed after accepting all exhaustive order statuses.

## Verification

All commands ran with Node.js `v22.22.2` and pnpm `10.15.0`.

- `pnpm --filter @pet/admin test` — 108/108 passed.
- `pnpm --filter @pet/admin typecheck` — passed.
- `pnpm --filter @pet/admin build --mode pilot` — passed.
- `pnpm --filter @pet/admin build` — passed.
- `pnpm lint` — passed.
- `pnpm --filter @pet/admin test:e2e:pilot` — 2/2 passed at 390×844.
- `pnpm --filter @pet/admin test:e2e` — 16/16 public-demo tests passed.
- `git diff --check` — passed.

## Remaining integration boundary

The browser acceptance test uses same-origin HTTP route fixtures. It verifies the production client paths, request bodies, idempotency header, privacy boundary, and UI behavior, but does not start PostgreSQL. The real multi-role PostgreSQL browser loop remains Task 9 as approved. No local-data fallback or token-based client path was added.

The initial independent review did not return within the parent task's bounded window; its later findings are addressed in the hardening section below. The deferred Task 9 database loop remains the only current integration concern.

## Review hardening — 2026-08-28

- Added a mounted session generation to every owner load, mutation, quote, submit, and confirmation path. Late success and error results are ignored, including a previous owner's `401` after a later owner workspace has mounted.
- Added a quote-operation generation. Any quote input change invalidates the operation even when values change A → B → A, so an old response cannot restore a quote, request snapshot, or order key.
- Froze the complete first-submit payload and idempotency key, including notes. A failed attempt locks the quoted inputs and retries the identical request; the owner can explicitly abandon it only by invalidating the quote and starting a new order.
- Reused strict pilot-location parsing for owner order reads: city must be `南京市`, district must be one of the four pilot districts, and `serviceZone` must exactly equal the district. Invalid successful HTTP payloads fail closed as the fixed `503 SERVICE_UNAVAILABLE` response.
- Corrected normal timeline indices for fee review, provider matching, and service. Exceptional and stopped statuses now show explicit state copy without a misleading fresh linear timeline.
- Kept the owner component keyed to `session.userId`, ensuring a new authenticated owner always receives a fresh workspace lifecycle.

### Hardening TDD evidence

- RED: 7 expected failures covered strict order location validation (3 cases), lost-response payload mutation, stale quote restoration, stale mutation `401`, and incorrect timeline state.
- GREEN: focused owner workspace and API suites passed 66/66 after implementation, including the deferred A → B → A quote race and unmounted load/quote/mutation/submit/confirm cases.

### Hardening verification

All commands used Node.js `v22.22.2`.

- `pnpm --filter @pet/admin test` — 115/115 passed.
- `pnpm --filter @pet/admin typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm --filter @pet/admin build --mode pilot` — passed.
- `pnpm --filter @pet/admin build` — passed.
- `pnpm --filter @pet/admin test:e2e:pilot` — 2/2 passed at 390×844.
- `pnpm --filter @pet/admin test:e2e` — 16/16 public-demo tests passed.
- `git diff --check` — passed.

The Task 9 real PostgreSQL browser loop remains the only integration boundary; these changes add no local fallback, browser token, payment path, QR code, phone number, or exact-address rendering.
