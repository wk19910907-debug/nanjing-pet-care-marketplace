# Local development

## Fastest usable experience

On Windows, double-click `start-local.cmd`, then open `http://127.0.0.1:43123`.
This starts the browser-based owner, platform and provider workflow without external infrastructure.
Data is stored in browser local storage and can be reset from the page.

To experience the mini program, import `apps/miniprogram` in WeChat Developer Tools. The included
`project.config.json` uses the tourist AppID and disables domain checks for local development.

## Requirements

- Node.js 22 LTS and pnpm 10.
- Docker with PostgreSQL 16. Docker Compose is optional; individual containers work too.
- Never commit `.env`, credentials, payment certificates or field-encryption keys.

## Start infrastructure

Set `POSTGRES_PASSWORD`, `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` in the shell, then run `docker compose up -d`. If the Compose plugin is unavailable, start PostgreSQL directly and point `DATABASE_URL` at it.

Apply the schema with `pnpm exec prisma migrate deploy --schema prisma/schema.prisma` and generate the client with `pnpm exec prisma generate --schema prisma/schema.prisma`.

## Verify

Run `pnpm install`, `pnpm typecheck`, `pnpm test`, the admin Playwright flow, and `git diff --check`. API integration tests require `DATABASE_URL`.

Development may use the fake payment and object-storage adapters. Production must provide every variable checked by `loadConfig`; there are deliberately no production credential defaults.

## Run the controlled pilot locally

The local pilot is separate from the browser-only demo. It uses PostgreSQL for shared state,
encrypts address fields, and stores evidence only in an explicitly configured private absolute
directory. In PowerShell, generate fresh local secrets in the current terminal:

```powershell
$env:PILOT_MODE='enabled'
$env:NODE_ENV='development'
if ([string]::IsNullOrWhiteSpace($env:POSTGRES_PASSWORD)) { throw 'Set a fresh POSTGRES_PASSWORD first' }
$env:DATABASE_URL="postgresql://petcare:$([Uri]::EscapeDataString($env:POSTGRES_PASSWORD))@127.0.0.1:54329/petcare"
$env:PILOT_AUTH_PEPPER=node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
$env:FIELD_ENCRYPTION_KEY_V1=node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
$pilotRunId=[Guid]::NewGuid().ToString('N').Substring(0,12)
$pilotEvidence=Join-Path $env:TEMP "petcare-pilot-evidence-$pilotRunId"
New-Item -ItemType Directory -Force $pilotEvidence | Out-Null
$env:PILOT_EVIDENCE_DIR=(Resolve-Path $pilotEvidence).Path
pnpm exec prisma migrate deploy --schema prisma/schema.prisma
pnpm pilot:start
```

`pilot:start` builds the pilot web bundle and listens on `127.0.0.1:3000` by default. Open
`http://127.0.0.1:3000`, then select `OWNER` (宠主), `PROVIDER` (服务人员), or `ADMIN`
(平台管理员) on the page. The direct local session route is registered only when
`NODE_ENV` is `development` or `test`, accepts only requests whose network address is loopback,
and is not registered in production.

Do not set `PILOT_HOST` to a LAN or external address as a substitute for authentication. External
or LAN operation requires a reviewed production deployment and a real production authentication
design, including TLS, exact-origin enforcement, secure cookies, private object storage, and the
other production controls. The local evidence directory must have private host ACLs and is not a
production storage option.

Do not save either generated secret, database credentials, cookies, tokens, compatibility
invitation codes, addresses, or evidence in the repository, this Vault, shell history files, or
logs. Stop the pilot with `Ctrl+C`; clean up only the exact database container and resolved evidence
directory created for that run. The validated PowerShell ownership and path checks are documented
in [`pilot-quickstart.md`](pilot-quickstart.md).

Production pilot startup requires a separate reviewed authentication/deployment design,
`NODE_ENV=production`, `PILOT_PUBLIC_ORIGIN`, the existing S3 configuration fields, and an
application-provided `S3Signer`. The direct local session route is absent. Startup fails before
listening when the signer is unavailable and never falls back to local disk.
