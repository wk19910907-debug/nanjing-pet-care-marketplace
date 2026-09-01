#!/bin/sh
set -eu

pnpm exec prisma migrate deploy --schema prisma/schema.prisma
exec pnpm --filter @pet/api start:pilot
