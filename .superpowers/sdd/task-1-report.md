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
- `deploy/.env.production.example`
- `scripts/production-deployment-files.test.mjs`

## Self-review

- Public endpoints are not required in production validation, preserving current deployments.
- Internal probe/head commands and public PUT/GET signing are exercised through separate injected clients.
- Commands do not serialize S3 credentials or the optional configuration field.
- Existing checksum handling, expiration inputs, credentials, region, and path-style semantics are unchanged.

## Concerns

`apps/api/tests/server.test.ts` remains un-runnable in this worktree because `@prisma/client@6.19.3` resolves `default.js` through `#main-entry-point`, but Node/Vitest reports that package import is undefined. Running `pnpm exec prisma generate --schema prisma/schema.prisma` completed successfully but did not change that failure. The endpoint-related suites, typecheck, and deployment tests pass; this dependency-resolution problem appears unrelated to Task 1.
