# Task 6 report — local production lifecycle

## Implementation

- Added `scripts/local-production.ps1` with exactly `start`, `status`, `stop`, and `verify` actions and the four requested package commands.
- The subprocess adapter uses `ProcessStartInfo.ArgumentList`, captured stdout/stderr, per-process environment, and bounded timeouts. It never prints raw process diagnostics. Docker Compose detection tries `docker compose` before standalone `docker-compose`.
- `start` generates/validates secrets, checks the daemon, builds both images using Docker directly (no Compose buildx requirement), starts healthy dependencies, runs each one-shot job with its exit code enforced, starts the healthy application and WAF, and checks exact HTTPS 200 readiness with bounded loopback-only TLS probes.
- `status` displays only allowlisted service/state/health and numeric exit codes plus fixed public origins. `stop` invokes Compose `stop`, preserving all volumes and secrets. No action runs `down -v` or installs a system root certificate.
- Secret selection is shared with the generator. An absent or safely owned application root retains the previous path; an existing application parent containing unrelated runtime/backups uses its dedicated `local-production-secrets` child. Existing secret artifacts with damaged ownership fail closed instead of silently creating replacement secrets. Explicit overrides still require an absolute path outside the repository/Vault and retain ownership and reparse-point checks.
- Compose uses `LOCAL_PRODUCTION_SECRET_DIR` for the administrator host-file mount and the stable `nanjing-petcare-waf:local` tag for the controller's WAF build.
- The verify interface is `node scripts/verify-local-production.mjs` with child-only `LOCAL_PRODUCTION_SECRET_DIR`; missing Task 7 acceptance code fails clearly.

## Strict RED → GREEN evidence

1. Wrote the controller test before its implementation. `pwsh -NoProfile -File scripts/local-production.test.ps1` failed with `Lifecycle controller is missing`.
2. Added a real-generator fixture whose application parent already contains runtime/backups. `pwsh -NoProfile -File scripts/local-production-secrets.test.ps1` failed because the generator rejected that unowned parent. Implemented protected-child default selection; the suite passed, including unchanged parent/runtime/backups ACLs and repeated-run byte preservation.
3. Added WAF image-tag and configurable administrator-mount assertions before editing Compose. Node 22 deployment tests failed 2/4 on the missing image tag and the hardcoded mount. Implemented both contracts; all 4/4 passed.
4. Added a readiness regression returning HTTP 302 from a successful transport. Controller tests failed with `HTTPS redirect must not count as readiness`. Required exact HTTP 200; next run reached the new status regression and failed with `Status exposes a failed init exit code safely`. Added allowlisted numeric exit status; the suite passed.
5. Added a damaged-owner-marker default-directory regression. The generator suite failed with `A damaged existing default secret directory must fail closed instead of creating replacement secrets in a child`. Added a refusal when an unowned default parent contains any secret artifacts; the suite passed.
6. Live storage initialization exposed the existing `mc` default configuration directory (`/root/.mc`) as unwritable under the service's hardening. Added a deployment assertion for `MC_CONFIG_DIR: /config`; the suite failed 1/4. Set that variable to the already mounted writable tmpfs; deployment tests returned to 4/4 and controller tests remained 71/71.
7. The pinned MinIO server rejected bucket-level CORS as unimplemented. With parent authorization, required the exact single server setting `MINIO_API_CORS_ALLOW_ORIGIN: https://petcare.localhost` and absence of the unsupported bucket CORS generation/command. The deployment suite failed 1/4 before the change and passed 4/4 after it. Real OPTIONS probes returned the exact origin, PUT method and requested headers for the application origin, and no Allow-Origin for an unrelated origin.
8. The pinned MinIO client image lacks `grep`. Required a built-in shell `case` private-policy check and no grep dependency; deployment tests failed 1/4, then passed after implementation. Executed the actual extracted shell check in the pinned client image with four supplied `mc` responses: private/none succeeded and public/misleading text failed.
9. Real MinIO service-account creation rejected the generator's 32-character access key (MinIO allows 3–20) and 43-character secret key (MinIO allows 8–40). Added separate RED tests requiring exact 20/40 generation and separate RED legacy-migration assertions. Generation uses independent random URL-safe values with 120/240 bits. The parent authorized migration of exactly the legacy generator formats in safely owned directories. Full-file validation precedes an atomic Windows file replacement; only recognized legacy fields change. Tests assert byte-for-byte preservation of every other environment field, administrator-password bytes, unchanged restricted ACLs, repeat-run idempotence, no printed old/new values, and failure without mutation for neighboring invalid lengths or invalid alphabets. A PowerShell null-string interop issue in `File.Replace` was caught by the migration test and fixed with `[NullString]::Value`.
10. Real `admin-init` showed pnpm forwarding an extra `--` into the strict command parser. Added a deployment assertion requiring direct `bootstrap:local-production-admin --password-file ...` forwarding; it failed 1/4. Removed only the extra separator; deployment tests passed 4/4 and the actual hardened administrator job exited 0.
11. Real app startup found dynamic MinIO/PostgreSQL allocations occupying fixed WAF/app addresses `.2`/`.3`. Added a RED deployment assertion for upper-half dynamic allocation (`172.31.0.128/25`) and no fixed addresses on dynamic infrastructure services; the suite failed 1/4. Added that IPAM range under the existing `/24` subnet; all 4/4 passed. The parent explicitly authorized one manual Compose `down` **without `-v`** for this exact rehearsal project to recreate its network. The before/after inventory confirmed the existing MinIO and PostgreSQL named volumes were retained. This repair is not a controller action; `stop` continues to use only Compose `stop`.
12. The real application then failed readiness because the existing `HeadBucket` probe returned HTTP 403 with the object-only application policy. Parent authorization added exactly `s3:ListBucket` on the one bucket ARN, preserving exactly GetObject/PutObject on that bucket's object ARN. The policy deep-equality test failed before the new statement and passed after it. The same application's AWS SDK `HeadBucket` then succeeded, and application container health passed. This runtime evidence supersedes Task 3's earlier assumption that no bucket-level action was needed.
13. WAF publication encountered Windows HTTP.sys/PID 4 on TCP80. Those Windows services were left untouched. The parent approved loopback-only HTTP8080 and HTTPS443 bindings. RED tests covered the new defaults, exact loopback Compose mappings, legacy-port migration, HTTP range/collisions and fixed HTTPS origin consistency. Existing owned environments missing both port fields are upgraded atomically without changing prior bytes or ACL restrictions; custom valid HTTP ports are retained. HTTPS remains 443, preserving all application/storage origins and readiness/CORS contracts.

## Automated verification

All Node/pnpm invocations used `C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64` prepended to PATH.

- `pwsh -NoProfile -File scripts/local-production.test.ps1` — 71 assertions passed. Includes actual native argument/metacharacter handling, child-only environment, exit 17 preservation, missing executable sanitization, and killing a timed-out process, plus isolated Docker/Compose/network lifecycle tests.
- `pwsh -NoProfile -File scripts/local-production-secrets.test.ps1` — passed, including first/repeated generation, ACL restrictions, secret non-disclosure, override rejection, malformed/incomplete secret rejection, filesystem-root/reparse rejection, shared-parent preservation, and damaged-ownership refusal.
- `node --test scripts/local-production-deployment-files.test.mjs` — 4/4 passed.
- `pnpm --filter @pet/api test -- bootstrap-local-production-admin.test.ts` — 6/6 passed under Node 22.
- `pnpm local-production:status` — exited 0 both before initialization and after secret initialization with no project containers; output contained only initialization guidance/service status and fixed public origins.
- `pnpm local-production:verify` — intentionally exited 1 with the explicit missing `verify-local-production.mjs` explanation; Task 7 has not supplied it yet.
- `git diff --check` — passed (existing checkout CRLF normalization warnings only).

## Live rehearsal

- First real `pnpm local-production:start` generated the protected child secret set and successfully built `nanjing-petcare:local` and `nanjing-petcare-waf:local` using this host's Docker/standalone Compose setup.
- Dependencies failed safely with exit 1 because the temporary Task 3 review network occupied `172.31.0.0/24`. No later initialization/app/WAF step ran. The parent agent verified and removed the stopped temporary review containers and their empty network, preserving all volumes.
- Second start reached healthy PostgreSQL/MinIO, then correctly returned exit 1 for failed `minio-init`; no later job or application service ran. A redacted diagnostic identified `mc`'s unwritable default configuration directory. The parent authorized the focused `MC_CONFIG_DIR` regression and fix above.
- Subsequent direct initializer checks exposed unsupported bucket CORS, the missing grep binary, and unsupported generated service-account lengths. Each was diagnosed without exposing secret values and repaired through the RED/GREEN changes above. No failure was swallowed in the deployed initializer or controller.
- Both unused legacy application credential fields in the real secret leaf have been atomically migrated without printing values. The real `minio-init`, `migrate`, and corrected `admin-init` jobs each exited 0, preserving the existing volumes and other secrets.
- A later full-start build exited 1. A read-only `docker system df` probe reported a missing writable-layer snapshot for a failed build container; the parent inspected the daemon, confirmed the container was already gone and the existing application image intact, and authorized one retry without pruning/resetting Docker. That build retry succeeded and all initialization jobs exited 0; application startup then exposed the dynamic/static IP collision repaired above.
- After the authorized project-only network recreation, initialization was rerun successfully against the retained database/storage volumes.
- The application subsequently became healthy after the bucket-level HeadBucket permission fix. Windows HTTP.sys on port80 blocked WAF publication; its listener and W3SVC/WAS were not stopped or reconfigured. HTTP8080/TCP443/UDP443 were confirmed free before the loopback binding adjustment.

## Final verified result

- Final `pnpm local-production:start` exited 0: both Docker image builds completed, all three guarded jobs exited 0, the application became healthy, WAF started, and the controller printed HTTPS readiness success.
- Live `pnpm local-production:stop` exited 0 and preserved all four named volumes by before/after inventory comparison. A subsequent cached `pnpm local-production:start` also exited 0 and reached HTTPS readiness, confirming the complete repeat-start workflow against persisted data.
- `pnpm local-production:status` exited 0 with non-secret service health and init exit codes plus the two fixed HTTPS public origins.
- WAF publishes only `127.0.0.1:8080` to container TCP80 and `127.0.0.1:443` to container TCP/UDP443. Application/MinIO ports remain private; PostgreSQL maintenance remains loopback54329.
- HTTP8080 returned 308 with `Location: https://petcare.localhost/`. The storage HTTPS endpoint returned 204 for the application's OPTIONS request, with the exact application origin, PUT method, and requested Content-Type/checksum headers.
- Final source checks: secret-generator suite passed; lifecycle 71 assertions passed; deployment 4/4 passed; guarded-bootstrap unit tests 6/6 passed; `git diff --check` passed.
- Services are left running for Task 7. Full browser/security acceptance remains Task 7's responsibility; the verify action currently fails clearly because its script has not yet been added.

## Files

- `scripts/local-production.ps1`
- `scripts/local-production.test.ps1`
- `scripts/local-production-secrets.ps1`
- `scripts/local-production-secrets.test.ps1`
- `scripts/local-production-deployment-files.test.mjs`
- `deploy/compose.local-production.yml`
- `deploy/local-production/minio-init.sh`
- `deploy/local-production/admin-init.sh`
- `package.json`

## Self-review and concerns

- Job failure short-circuits startup; `--no-deps` is used only after the relevant preceding stages have explicitly succeeded. Re-running start deliberately re-runs guarded one-shot initialization.
- All Compose operations specify project name, env file, and Compose file. Explicit override paths remain individual arguments and the same directory reaches the admin mount.
- The only certificate-validation exception is the bounded curl probe against the fixed loopback resolution; browser acceptance must independently scope its TLS trust for the rehearsal.
- Raw subprocess output is captured and discarded rather than echoed. Status parses Compose JSON arrays or JSON lines, then emits only allowlisted values.
- The Task 7 security/browser acceptance implementation remains an expected dependency. Task 8 documentation should explain the dedicated-child default and `LOCAL_PRODUCTION_SECRET_DIR` Compose contract.
- Task 8 must also describe MinIO's server-level exact-origin CORS setting for the pinned release; Task 7 must exercise a real browser-origin OPTIONS/presigned PUT path (the direct HTTP origin probes here do not replace browser acceptance).
- Task 8 must document `LOCAL_HTTP_PORT` (default8080; valid 1–65535 except443/54329) and fixed `LOCAL_HTTPS_PORT=443`, loopback-only host publication, upper-half dynamic IPAM, and the narrow bucket-level ListBucket permission required by HeadBucket readiness.
