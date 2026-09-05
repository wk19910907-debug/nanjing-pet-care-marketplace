# Task 6 report — encrypted order conversations

## Delivered

- Added owner–ADMIN order conversations at `GET` and `POST /api/v1/pilot/orders/:orderId/messages`.
- `OrderConversationService` authorizes only the order owner and ADMIN; PROVIDER and other owners are denied before decryption.
- Message bodies are trimmed, limited to 1–500 Unicode code points, encrypted with the existing versioned AES-256-GCM `FieldCrypto`, and stored only as ciphertext, nonce, authentication tag, and key version.
- Listing is ascending and stable on `(createdAt, id)`, returns at most 50 items, and uses a strict canonical Base64URL JSON cursor.
- Sends write metadata-only `ORDER_MESSAGE_SENT` audit events containing `orderId`, `messageId`, and `bodyLength`; plaintext is excluded from storage, audit records, DTOs, and safe error responses.
- Composition routes messages through the existing onboarded/staff-action authentication boundary, so staff with `mustChangePassword` cannot reach the business route.

## TDD evidence

RED under Node `v22.22.2`:

```powershell
pnpm --filter @pet/api test -- order-conversation-service.test.ts
```

The test failed as intended with `Cannot find module '../src/conversations/order-conversation-service.js'` before the service existed.

GREEN and regression evidence, using a disposable Docker `postgres:16-alpine` instance on loopback and fresh migrations:

```powershell
pnpm exec prisma migrate deploy --schema prisma/schema.prisma
pnpm --filter @pet/api test -- order-conversation-service.test.ts order-conversation-routes.test.ts sensitive-access.test.ts
pnpm --filter @pet/api test -- pilot-composition.test.ts --testNamePattern "guards every production write"
pnpm --filter @pet/api typecheck
pnpm --filter @pet/api lint
git diff --check
```

Results: 11 focused tests passed across the conversation and sensitive-access suites; the selected pilot production guard passed; typecheck, lint, and whitespace validation passed.

The conversation test databases were uniquely named and verified absent after their `afterAll` cleanup. The disposable PostgreSQL container is stopped after final verification.

## Files

- `apps/api/src/conversations/order-conversation-service.ts`
- `apps/api/src/conversations/routes.ts`
- `apps/api/src/app.ts`
- `apps/api/src/pilot/composition.ts`
- `apps/api/tests/order-conversation-service.test.ts`
- `apps/api/tests/order-conversation-routes.test.ts`

## Residual

The approved API contract intentionally has no client message idempotency key and the existing `OrderMessage` schema has no such column; repeated valid sends therefore remain distinct conversation entries, with independently randomized AES-GCM nonces. No plaintext deduplication fingerprint was introduced.

## Security review follow-up

- Message UUIDs are allocated before encryption. Every message uses AES-GCM associated data serialized as the stable JSON tuple `['petcare.order-message', 1, orderId, messageId, authorRole]`. Decryption reconstructs the same tuple from persisted metadata, so cross-order, cross-row, role, authentication-tag, and unknown-key-version substitutions fail closed as `MESSAGE_DECRYPTION_FAILED`.
- `FieldCrypto` now supports optional AAD without changing existing address or packed-field callers. `fromKeyring` supports an explicit active key and decrypts by persisted version; the existing `fromBase64(..., 1)` configuration remains valid for legacy single-key deployments.
- Added `FIELD_ENCRYPTION_KEYRING` (strict JSON array of `{version,key}` entries) and `FIELD_ENCRYPTION_ACTIVE_VERSION`. Entries must be canonical Base64 32-byte values with unique positive versions; keyring/legacy-key ambiguity and unknown active versions are rejected without including key values in errors. Production accepts either the existing V1 key or a complete unambiguous keyring.
- Cursors now require the decoded JSON text to exactly equal the canonical serialization. Reordered keys, whitespace, duplicate keys, and extra keys are rejected.
- Added a production-composition integration test with real staff credentials: an ADMIN with `mustChangePassword` receives `PASSWORD_CHANGE_REQUIRED` for both message GET and POST; the newly rotated session can read and send.

Follow-up verification under Node `v22.22.2` and disposable PostgreSQL 16:

```powershell
pnpm --filter @pet/api test -- field-crypto.test.ts config.test.ts order-conversation-service.test.ts order-conversation-routes.test.ts sensitive-access.test.ts
pnpm --filter @pet/api test -- pilot-composition.test.ts --testNamePattern "must-change ADMIN sessions"
pnpm --filter @pet/api typecheck
pnpm --filter @pet/api lint
git diff --check
```

Results: 41 focused tests plus the real-auth production-composition test passed; typecheck, lint, and whitespace checks passed. The disposable PostgreSQL 16 container is stopped after commit.
