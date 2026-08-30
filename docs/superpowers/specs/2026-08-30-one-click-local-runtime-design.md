# One-click Local Runtime Design

## Goal

Make `start-local.cmd` launch the real website, API, PostgreSQL-backed data, and local evidence storage with one double-click on this Windows machine. The existing owner, provider, admin, catalog, pricing, and order behavior must not change.

## User experience

- The user double-clicks `start-local.cmd` and keeps that window open.
- The launcher checks Node.js 22, pnpm, Docker, and the repository dependencies.
- It reuses one named PostgreSQL 16 container and one named Docker volume so local orders and operations configuration survive restarts.
- It chooses the first bindable application port from `51800` through `51899`, avoiding Windows excluded ports and active listeners.
- It applies Prisma migrations, builds the pilot frontend, starts the API, waits for `/health/ready`, and opens the resulting URL.
- Failures are shown in plain language and the window remains open for diagnosis.

## Security and storage

- No password, encryption key, authentication pepper, cookie, or token is written anywhere inside the repository or Obsidian Vault.
- Generated local secrets are encrypted for the current Windows user with DPAPI and stored below `%LOCALAPPDATA%\NanjingPetCare`.
- Evidence files are stored below the same local application directory. The authentication pepper remains stable so the evidence manifest remains readable after restart.
- The local database binds only to `127.0.0.1`; the web server binds only to `127.0.0.1`.
- If protected state and the named database container disagree or are unavailable, the launcher stops without deleting or replacing either resource.

## Components

- `scripts/start-local-preview.ps1`: validation, protected local state, container lifecycle, port selection, migrations/build, server health wait, and browser launch.
- `scripts/start-local-preview.test.ps1`: dependency-free PowerShell assertions for pure port selection and protected-state path guards.
- `start-local.cmd`: thin double-click wrapper that invokes the PowerShell launcher.
- `docs/operations/pilot-quickstart.md`: documents the one-click path and preserves the existing isolated manual path for engineering acceptance.

## Error handling and testing

Pure helpers accept injected probes so tests do not bind ports or mutate Docker. Integration verification runs the helper tests, the repository check, pilot build, and a live `/health/ready` request. The launcher never performs recursive deletion and never removes an existing container or volume.
