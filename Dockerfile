# syntax=docker/dockerfile:1.7
FROM node:22.23.2-alpine3.24 AS build

ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/opt/corepack
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN mkdir -p "$COREPACK_HOME" \
  && corepack enable \
  && corepack prepare pnpm@10.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/miniprogram/package.json apps/miniprogram/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @pet/api exec prisma generate --schema ../../prisma/schema.prisma \
  && pnpm pilot:build \
  && sed -i 's/\r$//' /app/deploy/entrypoint.sh \
  && chmod 0555 /app/deploy/entrypoint.sh

FROM node:22.23.2-alpine3.24 AS runtime

ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/opt/corepack
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache openssl \
  && mkdir -p "$COREPACK_HOME" \
  && corepack enable \
  && corepack prepare pnpm@10.15.0 --activate

COPY --from=build --chown=node:node /app /app
RUN chown -R node:node /opt/corepack

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PILOT_PORT||3000)+'/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/deploy/entrypoint.sh"]
