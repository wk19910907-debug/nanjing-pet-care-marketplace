import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('production image builds the pilot and runs migrations before a non-root server', async () => {
  const dockerfile = await source('Dockerfile');
  const entrypoint = await source('deploy/entrypoint.sh');

  assert.match(dockerfile, /FROM node:22\.23\.2-alpine3\.24 AS build/);
  assert.match(dockerfile, /corepack prepare pnpm@10\.15\.0 --activate/);
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /pnpm --filter @pet\/api exec prisma generate/);
  assert.match(dockerfile, /pnpm pilot:build/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /EXPOSE 3000/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /ENTRYPOINT \["\/app\/deploy\/entrypoint\.sh"\]/);

  const migrate = entrypoint.indexOf('prisma migrate deploy');
  const start = entrypoint.indexOf('start:pilot');
  assert.ok(migrate >= 0, 'entrypoint must deploy migrations');
  assert.ok(start > migrate, 'entrypoint must migrate before starting the server');
  assert.match(entrypoint, /exec pnpm --filter @pet\/api start:pilot/);
});

test('Docker build context excludes local secrets, data and generated files', async () => {
  const ignored = await source('.dockerignore');
  for (const required of [
    '.git', '.env*', 'node_modules', '**/dist', '*.dump', '*.backup',
    'evidence', 'backups', '.superpowers', '.obsidian',
  ]) assert.ok(ignored.includes(required), `missing Docker ignore rule: ${required}`);
  assert.match(ignored, /!deploy\/\.env\.production\.example/);
});
