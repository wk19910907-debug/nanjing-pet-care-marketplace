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
  assert.ok(ignored.split(/\r?\n/).includes('**/.env*'), 'nested environment files must be excluded');
  assert.match(ignored, /!deploy\/\.env\.production\.example/);
});

test('Compose publishes only Caddy and waits for the private application healthcheck', async () => {
  const compose = await source('deploy/compose.production.yml');

  assert.match(compose, /image: caddy:2\.11\.4-alpine/);
  assert.match(compose, /- "80:80"/);
  assert.match(compose, /- "443:443"/);
  assert.match(compose, /- "443:443\/udp"/);
  const appService = compose.match(/\r?\n  app:\r?\n[\s\S]*?\r?\nnetworks:/)?.[0];
  assert.ok(appService, 'app service block missing');
  assert.match(appService, /expose:\s*\n\s*- "3000"/);
  assert.doesNotMatch(appService, /\n\s+ports:/);
  assert.match(compose, /env_file:\s*\n\s*- \.env\.production/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /restart: unless-stopped/g);
  assert.match(compose, /max-size: "10m"/);
  assert.doesNotMatch(compose, /internal: true/);
});

test('Caddy terminates HTTPS without weakening browser origin protections', async () => {
  const caddy = await source('deploy/Caddyfile');

  assert.match(caddy, /\{\$SITE_DOMAIN\}/);
  assert.match(caddy, /reverse_proxy app:3000/);
  assert.match(caddy, /encode zstd gzip/);
  assert.match(caddy, /Strict-Transport-Security "max-age=31536000; includeSubDomains"/);
  assert.match(caddy, /X-Content-Type-Options "nosniff"/);
  assert.doesNotMatch(caddy, /Access-Control-Allow-Origin/);
});

test('production environment template is complete but contains no usable secrets', async () => {
  const environment = await source('deploy/.env.production.example');
  const required = [
    'SITE_DOMAIN', 'NODE_ENV', 'DATABASE_URL', 'FIELD_ENCRYPTION_KEY_V1',
    'PILOT_MODE', 'PILOT_HOST', 'PILOT_PORT', 'PILOT_PUBLIC_ORIGIN',
    'PILOT_AUTH_PEPPER', 'PILOT_SESSION_DAYS', 'PILOT_INVITE_HOURS',
    'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
    'S3_REGION', 'S3_FORCE_PATH_STYLE', 'WECHAT_LOGIN_ENABLED',
  ];
  for (const key of required) assert.match(environment, new RegExp(`^${key}=`, 'm'), `missing ${key}`);
  assert.match(environment, /^NODE_ENV=production$/m);
  assert.match(environment, /^PILOT_MODE=enabled$/m);
  assert.match(environment, /^PILOT_HOST=0\.0\.0\.0$/m);
  assert.match(environment, /^PILOT_PORT=3000$/m);
  assert.match(environment, /^WECHAT_LOGIN_ENABLED=false$/m);
  assert.doesNotMatch(environment, /BEGIN (?:RSA )?PRIVATE KEY|AKIA[0-9A-Z]{16}|postgresql:\/\/[^:\s]+:[^@\s]+@/);
});

test('CI validates the deployment image without publishing it', async () => {
  const workflow = await source('.github/workflows/production-image.yml');
  assert.match(workflow, /pnpm test:deploy/);
  assert.match(workflow, /docker compose[\s\S]*config --quiet/);
  assert.match(workflow, /caddy validate/);
  assert.match(workflow, /docker build --tag nanjing-petcare:ci \./);
  assert.doesNotMatch(workflow, /docker push|push:\s*true|kubectl|ssh-action/);
});

test('runbook covers prerequisites, secure deployment, recovery and acceptance', async () => {
  const runbook = await source('deploy/README.md');
  for (const topic of [
    'DNS', 'PostgreSQL', 'S3', 'TLS', 'migrate deploy', '/health/ready',
    '备份', '恢复演练', '回滚', '测试账号', '人工收款', 'ICP备案',
  ]) assert.ok(runbook.includes(topic), `runbook missing topic: ${topic}`);
  assert.match(runbook, /docker compose[\s\S]*up -d --build/);
  assert.match(runbook, /docker compose[\s\S]*logs/);
  assert.match(runbook, /不得把密钥、密码.*提交到 Git/);
});
