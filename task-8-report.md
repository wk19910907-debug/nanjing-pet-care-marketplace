# Task 8 — Admin dispatch and provider fulfillment UI

Date: 2026-08-28
Base: `b0ae77a41a89a9df5812d64431921b56d0a9c4eb`

## Delivered

- Added a session-bound admin workspace with separate provider-review, offline-fee, dispatch, dispatch-failure, and read-only order-timeline sections.
- Added target-scoped confirmations and per-action in-flight locks. Manual fee confirmation keeps one caller idempotency key across a lost-response retry.
- Added a session-bound provider workspace for application, bounded experience values, order-covering availability, own invitations, and assigned tasks only.
- Kept exact addresses behind the assigned-order API and rendered them only for allowed service states.
- Added server-timed check-in and report flows, exhaustive cat/dog checklists, and no provider-side owner confirmation.
- Added local image hashing, signed-capability upload with the exact MIME type and no credentials, evidence attachment, loading/error/retry states, and upload MIME handling in the pilot API server.
- Added runtime allowlists and fail-closed response parsers for roles, statuses, districts, timestamps, reviews, provider orders, addresses, and upload capabilities.
- Preserved the owner workspace and public demo; both modes retain separate Playwright suites.
- Added responsive mobile styles and Playwright assertions for 390×844, no horizontal overflow, and interactive targets at least 44 px high.

## TDD evidence

- Admin/provider workspace tests first failed because the workspace modules did not exist, then passed after implementation.
- Task 8 API transport tests first failed because the methods did not exist, then passed after same-origin API wiring and runtime parsing.
- Pilot role integration tests first failed on the provider placeholder, then passed after real workspace routing.
- Exact-MIME upload route test first failed under the previous octet-stream-only parser, then passed after the parser was safely allowlisted.
- Mobile Playwright first failed because the file input was 13 px high, then passed after the 44 px control fix.
- Explicit experience-bound and unsupported-upload tests each reproduced the fail-open/error-copy behavior before the corresponding fix.

## Verification (Node 22.23.0)

- `pnpm --filter @pet/admin test`: 13 files, 131 tests passed.
- `DATABASE_URL=postgresql://…@127.0.0.1:54329/petcare pnpm --filter @pet/api test`: 19 files, 178 tests passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed across all workspace packages.
- `pnpm build`: passed.
- `pnpm pilot:build`: passed.
- `pnpm --filter @pet/admin test:e2e`: 16 public-demo tests passed.
- `pnpm --filter @pet/admin test:e2e:pilot`: 4 pilot tests passed, including 2 admin/provider tests.
- `git diff --check`: passed.

## Security and operational notes

- The UI uses cookie-backed same-origin APIs; it stores no session token or workflow state in local storage.
- Signed upload URLs are treated as short-lived capabilities and uploaded with `credentials: 'omit'`.
- Admin lists expose only safe area summaries, not exact addresses or contact fields.
- The required copy `本系统未处理在线支付` is present; no payment collection workflow was added.
- Check-in and report timestamps remain server-owned.
- The local regression database required the already-committed `202608250002_manual_fee_key` migration before the full API suite could run; no new schema migration was introduced by Task 8.

## Remaining concerns

No known Task 8 blocker. The provider application can be resubmitted because the backend currently exposes no dedicated “read my provider profile” endpoint; server validation remains authoritative and the UI reports any conflict safely.
