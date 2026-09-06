# Task 1 report: browser-facing S3 signing endpoint

## Implementation

- Added optional `S3_PUBLIC_ENDPOINT`, restricted to an exact `http` or `https` origin with no path or query string.
- Added `publicEndpoint?: string` to `ObjectStorageConfig` without making it required, preserving existing production configurations that only set `S3_ENDPOINT`.
- The signer now creates an internal S3 client for `HeadBucket` and `HeadObject`, and a separate signing client only when `publicEndpoint` is present and differs from the internal endpoint. Both clients use the same region, path-style setting, and credentials.
- Documented the optional public endpoint in the production environment template and asserted that contract in deployment tests.

## TDD evidence

### RED

1. `pnpm --filter @pet/api test -- production-readiness.test.ts server.test.ts` (with Node 22.22.2 on `PATH`)
   - Expected configuration failure observed: `publicEndpoint` was absent from parsed object storage configuration.
   - `server.test.ts` additionally could not load due to the pre-existing Prisma package-import error recorded under Concerns.
2. `pnpm --filter @pet/api test -- aws-s3-signer.test.ts` (with Node 22.22.2 on `PATH`)
   - Expected routing failure observed: PUT presigning returned `http://minio:9000/internal-signed-url` rather than `https://storage.petcare.localhost/browser-signed-url`.

### GREEN

- `pnpm --filter @pet/api test -- aws-s3-signer.test.ts production-readiness.test.ts`
  - Passed: 44 tests across 2 files.
- `pnpm test:deploy`
  - Passed: 8 tests, 0 failures.
- `pnpm --filter @pet/api typecheck`
  - Passed: exit 0.
- `git diff --check`
  - Passed: exit 0.

All commands used `C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64` first on `PATH`.

## Changed files

- `apps/api/src/config.ts`
- `apps/api/src/adapters/aws-s3-signer.ts`
- `apps/api/tests/aws-s3-signer.test.ts`
- `apps/api/tests/production-readiness.test.ts`
- `apps/api/tests/server.test.ts`
- `apps/api/src/server.ts`
- `deploy/.env.production.example`
- `scripts/production-deployment-files.test.mjs`

## Self-review

- Public endpoints are not required in production validation, preserving current deployments.
- Internal probe/head commands and public PUT/GET signing are exercised through separate injected clients.
- Commands do not serialize S3 credentials or the optional configuration field.
- Existing checksum handling, expiration inputs, credentials, region, and path-style semantics are unchanged.

## Concerns

At initial implementation, `server.test.ts` could not collect because eagerly importing Pilot composition caused Vitest to transform Prisma's generated `#main-entry-point` wrapper. This is resolved in the review follow-up below.

## Review follow-up: 2026-09-06

### RED

```powershell
$env:PATH = 'C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64;' + $env:PATH
pnpm --filter @pet/api test -- aws-s3-signer.test.ts
```

Result: 1 expected failure, 8 passes. The new default/no-dependency signing test received `http://minio:9000` instead of `https://storage.petcare.localhost`, proving the production path incorrectly selected the internal client.

### Fixes and GREEN

- Default presigning now binds `signingClient.presign`; probes and heads remain bound to `internalClient`.
- Added a no-dependency regression test that locally generates actual PUT and GET signed URLs and asserts their public origin.
- Added a console spy assertion that construction and PUT/GET signing emit neither `S3_PUBLIC_ENDPOINT` nor S3 credentials. No production logging was added.
- Moved the composition runtime import inside `runPilotServer`. `resolvePilotServerOverrides` can now be tested without eagerly loading Prisma through Vitest; the composition still loads when the server actually starts.

```powershell
$env:PATH = 'C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64;' + $env:PATH
pnpm exec prisma generate --schema prisma/schema.prisma
pnpm --filter @pet/api test -- server.test.ts
```

Result: Prisma Client 6.19.3 generated successfully; `server.test.ts` passed (2 tests).

```powershell
$env:PATH = 'C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64;' + $env:PATH
pnpm --filter @pet/api test -- aws-s3-signer.test.ts production-readiness.test.ts server.test.ts
pnpm --filter @pet/api typecheck
pnpm test:deploy
git diff --check
```

Result: 48 API tests across 3 files passed; API typecheck passed; deployment tests passed (8/8); `git diff --check` passed.

The earlier Prisma/Vitest concern is resolved for `server.test.ts` by deferring the unused composition runtime import during override-resolution tests.
