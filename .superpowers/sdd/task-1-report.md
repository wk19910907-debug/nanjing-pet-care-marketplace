# Task 1 backend report — booking profile idempotency

## Scope delivered

- Added nullable, owner-scoped `clientRequestId` columns and compound unique indexes for `Pet` and `ServiceAddress` in an additive Prisma migration.
- Added optional 1–100 character ASCII request identifiers (`A–Z`, `a–z`, digits, `_`, `-`) to both create endpoints.
- Implemented owner-scoped idempotent pet and address creates. The original stored record is returned with HTTP 201 for the same normalized payload; a differing payload returns `PROFILE_REQUEST_CONFLICT` (HTTP 409) without modifying it.
- Payload comparison decrypts stored pet notes, address detail, and access instructions in memory. No plaintext sensitive-content hashes were added.
- Owner address creates and lists return the safe address view: `id`, `city`, `district`, `serviceZone`, and decrypted `detail`. They never expose access instructions or encrypted columns. `GET /v1/addresses` is `Cache-Control: no-store`.
- Existing no-request-id callers continue to create independent records. OWNER authorization remains required.

## RED

Created `apps/api/tests/booking-details-idempotency.test.ts` against a uniquely named disposable PostgreSQL database. Before implementation it failed as expected: concurrent same-key pet/address creates produced two records, same-key conflicts resolved, and invalid request identifiers were ignored by the route.

## GREEN / verification

- `pnpm --filter @pet/api test tests/booking-details-idempotency.test.ts` — 8 passed, using a database created and dropped by the test.
- `pnpm --filter @pet/api lint` — passed.
- `pnpm --filter @pet/api typecheck` — passed.

The dedicated test covers concurrent same-key convergence, conflicting replay preservation, owner isolation, no-key compatibility, encryption and owner-only decrypted detail, role gates, strict request-key validation, 409 mapping, POST safe detail output, and no-store address lists.

## Concerns / handoff

- The migration is intentionally not deployed to the runtime database; deployment belongs to the integration owner.
- Existing `accessInstructions` persistence and provider-access flows remain untouched for backward compatibility. The owner create/list views introduced here do not expose it.
