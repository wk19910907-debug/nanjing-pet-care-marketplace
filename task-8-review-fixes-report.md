# Task 8 Review Hardening Report

Date: 2026-08-28
Base: `6ef05a70199d5859be8824e221e8e5952380a95c`

## Delivered

- Replaced legacy admin/provider mutation responses with explicit allowlisted DTOs. Provider acceptance, provider application/review/availability, dispatch start/expiry, fulfillment check-in, upload issuance, evidence attachment, report submission, and evidence read URL no longer serialize raw Prisma records.
- Restricted local pilot upload capabilities to one-slash, same-origin absolute paths. Protocol-relative URLs, external schemes, backslashes, fragments, spaces/control characters, and percent-encoded bypasses fail before `fetch`.
- Bound the local upload request `Content-Type` to the MIME recorded in the signed capability before any object mutation. A mismatch returns the fixed pilot 400 error and writes nothing; existing magic-byte validation remains active.
- Added distinct provider confirmations for the before-service and after-service pet states. Check-in and report submission remain disabled until their corresponding per-order checkbox is selected, and confirmation state is pruned on lifecycle transitions and reset with the workspace session.
- Added ambiguous-response reconciliation for invitation acceptance, check-in, upload attachment, and report submission. The provider read model exposes only safe evidence IDs, allowing refresh to recover attachment state without leaking object keys or storage metadata.
- Made attachment replay idempotent by the already-unique object key. An identical replay returns the existing evidence without a second row or audit event; conflicting metadata or report ownership fails closed.

## TDD Evidence

- Safe DTO tests first failed because raw `userId`, coordinates, provider IDs, lifecycle versions, dispatch internals, and fulfillment state objects crossed HTTP boundaries; focused API tests then passed 14/14.
- Upload URL tests first showed five malicious paths accepted, and the signed-MIME test first accepted a mismatched request with 204. After the fix, client URL tests passed 8/8 and local storage tests passed 49/49.
- Provider component tests first showed check-in/report actions enabled without explicit confirmation. After the fix, focused confirmation tests passed 6/6.
- Reconciliation tests first showed no refetch after four ambiguous mutations; evidence replay first raised Prisma `P2002`, and the read model exposed no recoverable attachment state. After the fix, focused backend tests passed 14/14 and provider/API client tests passed 19/19.
- The Task 8 Playwright scenario was made RED by the new confirmation gate, then updated to perform the explicit confirmation and passed 2/2.

## Fresh Verification (Node.js 22.23.0)

- Admin unit/component: 13 files, 142 tests passed.
- API integration/unit on migrated disposable PostgreSQL database: 19 files, 180 tests passed.
- Public Playwright: 16 tests passed.
- Pilot Playwright at 390×844: 4 tests passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed across Admin, API, Mini Program, contracts, and domain packages.
- `pnpm build`: passed.
- `pnpm pilot:build`: passed.
- `git diff --check`: passed (only Git's informational LF-to-CRLF notices).
- Disposable database `petcare_task8_review_20260828_0216` was migrated for the API suite, dropped afterward, and verified absent.

## Review Notes

- No schema migration was required: `MediaEvidence.objectKey` is already unique and provides the replay key.
- The local pilot deliberately rejects all external upload URLs. A future S3/browser-direct implementation must introduce an explicitly authenticated and allowlisted upload adapter instead of weakening this local path rule.
- No payment data, phone/WeChat data, browser tokens, local-storage authentication, coordinates, raw user/provider IDs, dispatch wave/version fields, object keys in read models, or other internal Prisma fields were added to the role workspaces.
