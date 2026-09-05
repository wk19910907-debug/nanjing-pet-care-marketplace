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
  assert.match(
    compose,
    /WAF_TRUSTED_PROXY_CIDRS:\s*\$\{WAF_TRUSTED_PROXY_CIDRS:\?[^}]+\}/,
    'Caddy must fail closed until the operator supplies the actual WAF IP/CIDR allow-list',
  );
});

test('Caddy terminates HTTPS and forwards only a client IP derived from trusted WAF CIDRs', async () => {
  const caddy = await source('deploy/Caddyfile');

  assert.match(caddy, /servers\s*\{[\s\S]*trusted_proxies static \{\$WAF_TRUSTED_PROXY_CIDRS\}/);
  assert.match(caddy, /trusted_proxies_strict/);
  assert.match(caddy, /client_ip_headers X-Forwarded-For/);
  assert.match(caddy, /header_up X-Forwarded-For \{client_ip\}/);
  assert.doesNotMatch(caddy, /trusted_proxies static private_ranges/);
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
    'SITE_DOMAIN', 'WAF_TRUSTED_PROXY_CIDRS', 'NODE_ENV', 'DATABASE_URL', 'FIELD_ENCRYPTION_KEY_V1',
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
  assert.match(environment, /^WAF_TRUSTED_PROXY_CIDRS=$/m);
  assert.doesNotMatch(environment, /BEGIN (?:RSA )?PRIVATE KEY|AKIA[0-9A-Z]{16}|postgresql:\/\/[^:\s]+:[^@\s]+@/);
});

test('CI validates the deployment image without publishing it', async () => {
  const workflow = await source('.github/workflows/production-image.yml');
  assert.match(workflow, /pnpm test:deploy/);
  assert.match(workflow, /WAF_TRUSTED_PROXY_CIDRS:\s*192\.0\.2\.0\/24/);
  assert.match(workflow, /docker compose[\s\S]*config --quiet/);
  assert.match(workflow, /--env WAF_TRUSTED_PROXY_CIDRS[\s\S]*caddy validate/);
  assert.match(workflow, /docker build --tag nanjing-petcare:ci \./);
  assert.doesNotMatch(workflow, /docker push|push:\s*true|kubectl|ssh-action/);
});

test('runbook covers prerequisites, secure deployment, recovery and acceptance', async () => {
  const runbook = await source('deploy/README.md');
  for (const topic of [
    'DNS', 'PostgreSQL', 'S3', 'TLS', 'migrate deploy', '/health/ready',
    '备份', '恢复演练', '回滚', '测试账号', '人工收款', 'ICP备案',
  ]) assert.ok(runbook.includes(topic), `runbook missing topic: ${topic}`);
  assert.match(runbook, /docker compose[\s\S]*--env-file deploy\/.env\.production[\s\S]*run --rm --no-deps --entrypoint pnpm app exec prisma migrate deploy --schema prisma\/schema\.prisma/);
  assert.match(runbook, /docker compose[\s\S]*--env-file deploy\/.env\.production[\s\S]*run --rm --no-deps -it --entrypoint pnpm app --filter @pet\/api staff:create-admin -- --username <管理员用户名>/);
  assert.match(runbook, /docker compose[\s\S]*up -d app caddy/);
  assert.match(runbook, /curl --fail[\s\S]*https:\/\/\$\{SITE_DOMAIN\}\/health\/ready/);
  assert.match(runbook, /SITE_DOMAIN='pet\.example\.com'/);
  assert.match(runbook, /export SITE_DOMAIN/);
  assert.match(runbook, /\$SITE_DOMAIN = 'pet\.example\.com'/);
  assert.match(runbook, /--env-file.*不会.*导出.*宿主机/);
  assert.doesNotMatch(runbook, /^pnpm staff:create-admin/m);
  assert.match(runbook, /docker compose[\s\S]*logs/);
  assert.match(runbook, /不得把密钥、密码.*提交到 Git/);
});

test('production operations state the non-negotiable web boundary and operator controls', async () => {
  const [runbook, quickstart, environment, readme] = await Promise.all([
    source('deploy/README.md'), source('docs/operations/pilot-quickstart.md'),
    source('deploy/.env.production.example'), source('README.md'),
  ]);
  for (const topic of [
    'staff:create-admin', 'migrate deploy', '/health/ready', 'Secure', '同一 `https://` Origin',
    '私有 S3', 'FIELD_ENCRYPTION_KEYRING', 'PILOT_AUTH_PEPPER', 'PILOT_SHARED_INGRESS_RATE_LIMITING', '备份',
  ]) assert.ok(runbook.includes(topic) || quickstart.includes(topic) || environment.includes(topic), `missing ${topic}`);
  assert.match(environment, /^PILOT_SHARED_INGRESS_RATE_LIMITING=$/m);
  assert.match(environment, /^FIELD_ENCRYPTION_KEYRING=$/m);
  assert.match(environment, /^FIELD_ENCRYPTION_ACTIVE_VERSION=$/m);
  assert.match(runbook, /GitHub Pages.*绝不能作为真实订单/);
  assert.match(runbook, /Caddy.*不提供跨实例共享限流状态/);
  assert.match(runbook, /Redis/);
  assert.match(runbook, /429/);
  assert.match(runbook, /curl/);
  assert.match(runbook, /验证得到聚合.*429.*之后.*PILOT_SHARED_INGRESS_RATE_LIMITING=enabled/);
  assert.match(runbook, /预生产|暂时隔离的非公网 Origin/);
  assert.match(runbook, /两个独立.*受控.*环境/);
  assert.match(runbook, /不得.*启动.*生产.*app caddy/);
  assert.match(runbook, /验证.*429.*之后.*PILOT_SHARED_INGRESS_RATE_LIMITING=enabled[\s\S]*第 4 节/);
  assert.match(runbook, /WAF_TRUSTED_PROXY_CIDRS/);
  assert.match(runbook, /实际.*WAF.*(?:IP|CIDR)|WAF.*实际.*(?:IP|CIDR)/);
  assert.match(runbook, /client_ip_headers|X-Forwarded-For/);
  assert.match(runbook, /request\.ip/);
  assert.match(runbook, /防火墙[\s\S]*(?:仅允许|只允许)[\s\S]*WAF/);
  assert.match(runbook, /禁止填写 `private_ranges`、`0\.0\.0\.0\/0`、`::\/0`/);
  assert.doesNotMatch(runbook, /本地角色直接入口/);
  assert.doesNotMatch(quickstart, /邀请码登录|邀请管理/);
  assert.match(readme, /未公开展示手机号、微信二维码、邀请码或邀请入口/);
});
