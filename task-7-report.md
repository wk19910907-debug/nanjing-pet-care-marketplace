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

An independent review was requested but did not return within the parent task's bounded review window. Local diff review found no known Critical or Important issue. This timing limitation and the deferred Task 9 database loop are the only current concerns.
