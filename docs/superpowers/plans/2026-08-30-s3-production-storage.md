# S3 Compatible Production Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production pilot CLI construct a private S3-compatible signer from validated environment configuration.

**Architecture:** Add one AWS SDK v3 adapter that implements the existing `S3Signer` interface. Keep composition injection unchanged and wire the concrete adapter only in `runPilotServer`, preserving local filesystem behavior in development.

**Tech Stack:** Node.js 22, TypeScript 5.9, AWS SDK for JavaScript v3, Vitest, Fastify, pnpm 10.

## Global Constraints

- No credentials, signed URLs, cookies, tokens, or object contents may be logged or committed.
- Production object storage must fail closed; it may never fall back to local disk.
- PUT signatures bind content type and hoisted SHA-256 metadata; HEAD verifies type, length, and SHA-256 metadata.
- Existing dependency injection remains available for tests.

---

### Task 1: Validate S3 client configuration

**Files:**
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/tests/config.test.ts`
- Test: `apps/api/tests/production-readiness.test.ts`

**Interfaces:**
- Produces: `production.objectStorage.region: string` and `production.objectStorage.forcePathStyle: boolean`.

- [ ] Add failing tests proving production requires `S3_REGION`, validates `S3_FORCE_PATH_STYLE`, and defaults path style to false.
- [ ] Run `pnpm --filter @pet/api test -- tests/config.test.ts tests/production-readiness.test.ts` and confirm the new assertions fail because the fields do not exist.
- [ ] Add `S3_REGION` and strict boolean parsing to `EnvironmentSchema`, then expose both normalized values in `ObjectStorageConfig`.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: Implement the AWS SDK v3 signer

**Files:**
- Create: `apps/api/src/adapters/aws-s3-signer.ts`
- Create: `apps/api/tests/aws-s3-signer.test.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `ObjectStorageConfig`.
- Produces: `createAwsS3Signer(config): S3Signer`.

- [ ] Add `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` to `@pet/api`.
- [ ] Write failing adapter tests using injected `send` and `presign` functions to assert command inputs, signed checksum headers, HEAD normalization, and 404 handling.
- [ ] Run `pnpm --filter @pet/api test -- tests/aws-s3-signer.test.ts` and confirm failure because the adapter does not exist.
- [ ] Implement `createAwsS3Signer` with `PutObjectCommand`, `GetObjectCommand`, `HeadObjectCommand`, checksum Base64 conversion, and narrowly scoped not-found handling.
- [ ] Re-run the adapter test and confirm it passes.

### Task 3: Wire the production server

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/tests/pilot-composition.test.ts`
- Modify: `docs/operations/LOCAL.md`

**Interfaces:**
- Consumes: `createAwsS3Signer(config.production.objectStorage)`.
- Produces: production `runPilotServer` override with `s3Signer`, while explicit overrides win.

- [ ] Add a failing server-level test proving production configuration no longer reaches `PILOT_S3_SIGNER_REQUIRED` when the default adapter factory is supplied.
- [ ] Run the focused test and confirm it fails at the missing default wiring.
- [ ] Merge the default signer into `runPilotServer` only when `NODE_ENV=production` and no explicit signer override exists.
- [ ] Add failing admin API-client tests for safe absolute HTTPS upload URLs and unsafe HTTP, credentialed, fragmented, and malformed URLs.
- [ ] Generalize the local upload validator to accept those safe HTTPS URLs while continuing to send uploads with `credentials: omit`.
- [ ] Document `S3_REGION`, `S3_FORCE_PATH_STYLE`, private bucket CORS requirements, and credential handling without example secrets.
- [ ] Run API lint, typecheck, tests, `pnpm pilot:build`, and `git diff --check`.
- [ ] Commit the implementation and push the fast-forwarded `main` branch.
