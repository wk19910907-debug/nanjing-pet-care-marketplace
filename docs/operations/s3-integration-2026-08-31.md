# S3 integrity integration — 2026-08-31

## Reproduced fault

The previous adapter signed `x-amz-meta-sha256` and trusted the same metadata on HEAD.
A different payload with the same length was accepted, and a privileged test upload with
forged metadata passed `verifyUpload`. Real MinIO tests reproduced both failures.

## Fix and compatibility finding

Use `ChecksumSHA256` for PUT and `ChecksumMode=ENABLED` for HEAD. Reject missing/malformed/
composite checksums; never fall back to user metadata. An intermediate test proved that the
tested MinIO release ignores a checksum supplied only in the signed URL query string.
Therefore sign an **unhoisted, required request header**, return it in `uploadHeaders`, and
forward only that allowlisted header from the web client. Omitting it on replay is rejected.
There are no additional customer fields and no changes to local disk storage.
The API already accepts uppercase or mixed-case SHA-256 hex strings. Verification normalizes
hex case to preserve that contract; both unit and live roundtrip checks cover uppercase input.

## Scope

- Isolated local MinIO image digest: `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`.
- Real network PUT / HEAD / GET, no SDK mocks in the seven opt-in integration cases.
- Separate DTO, adapter and web tests cover checksum propagation and fail-closed parsing.
- `pnpm test:s3` repeats the real storage checks; `pnpm check` is still required separately.
- Credentials, signed URLs and object contents are not written to the repository or Vault.
- AWS/R2 accounts, HTTPS/CORS on a real domain, and WeChat device flows remain unverified.
- The mini program service-page upload handler is still a placeholder; do not call the mini
  program production-ready. Replacing that placeholder is separate follow-up work.

## Deployment requirements

Private bucket; HTTPS endpoint; allowlisted origin; CORS allows `Content-Type` and
`x-amz-checksum-sha256`; actual provider enforces SHA-256 and returns full-object checksums.
Existing metadata-only evidence needs explicit re-upload, not silent trust or automatic deletion.

Protocol reference: [AWS PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)
and [AWS HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html).

## Verification result

Node.js 22.22.2: `pnpm check` passed (494 unit/integration tests, plus 5 Windows launcher
tests; 7 opt-in S3 cases skipped here). Separately `pnpm test:s3` passed all 7 real-storage
cases. Public Playwright passed 16/16. Both public and pilot builds passed. Independent code
review found the uppercase-hash regression; after its test-first fix, the final review had
no remaining findings. No test containers with the `petcare.test=s3-live` label remain.
