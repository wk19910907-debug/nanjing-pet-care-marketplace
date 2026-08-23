# Local development

## Fastest usable experience

On Windows, double-click `start-local.cmd`, then open `http://127.0.0.1:4173`.
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
