import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const optionalSource = async (path) => source(path).catch((error) => {
  if (error?.code === 'ENOENT') return '';
  throw error;
});

test('local production Compose keeps stateful services private, hardened, and persistent', async () => {
  const compose = await source('deploy/compose.local-production.yml');
  const minioInit = await source('deploy/local-production/minio-init.sh');

  assert.match(compose, /image:\s+postgres:16(?:[\w.:-]+)?@sha256:[a-f0-9]{64}/);
  assert.match(compose, /image:\s+minio\/minio:[\w.-]+@sha256:[a-f0-9]{64}/);
  assert.match(compose, /postgres_data:\s*$/m);
  assert.match(compose, /minio_data:\s*$/m);

  const postgres = compose.match(/\n  postgres:\n[\s\S]*?(?=\n  \w[\w-]*:\n|\nnetworks:)/)?.[0] ?? '';
  const minio = compose.match(/\n  minio:\n[\s\S]*?(?=\n  \w[\w-]*:\n|\nnetworks:)/)?.[0] ?? '';
  const minioInitService = compose.match(/\n  minio-init:\n[\s\S]*?(?=\n  \w[\w-]*:\n|\nnetworks:)/)?.[0] ?? '';
  const app = compose.match(/\n  app:\n[\s\S]*?(?=\n  \w[\w-]*:\n|\nnetworks:)/)?.[0] ?? '';

  assert.match(postgres, /- "127\.0\.0\.1:\$\{POSTGRES_MAINTENANCE_PORT:\?set POSTGRES_MAINTENANCE_PORT in the local production environment file\}:5432"/);
  assert.doesNotMatch(minio, /^\s+ports:/m);
  assert.match(minio, /^      MINIO_API_CORS_ALLOW_ORIGIN: https:\/\/petcare\.localhost$/m);
  assert.equal([...minio.matchAll(/MINIO_API_CORS_ALLOW_ORIGIN:/g)].length, 1, 'MinIO must allow exactly the single application origin');
  assert.match(postgres, /healthcheck:/);
  assert.match(minio, /healthcheck:/);
  assert.match(minioInitService, /minio:\s*\n\s+condition: service_healthy/);
  assert.match(minioInitService, /MC_CONFIG_DIR: \/config/);
  assert.match(app, /postgres:\s*\n\s+condition: service_healthy/);
  assert.match(app, /minio:\s*\n\s+condition: service_healthy/);
  assert.match(app, /minio-init:\s*\n\s+condition: service_completed_successfully/);

  assert.match(compose, /edge:\s*\n\s+driver: bridge/);
  assert.match(compose, /backend:\s*\n\s+driver: bridge[\s\S]*?subnet: 172\.31\.0\.0\/24/);
  assert.match(compose, /subnet: 172\.31\.0\.0\/24\s*\n\s+ip_range: 172\.31\.0\.128\/25/);
  for (const dynamicService of [postgres, minio, minioInitService]) {
    assert.doesNotMatch(dynamicService, /ipv4_address:/, 'dynamic infrastructure services must use the upper-half pool, outside fixed app/WAF addresses');
  }
  assert.match(app, /ipv4_address: 172\.31\.0\.3/);
  assert.match(app, /PILOT_TRUST_PROXY: 172\.31\.0\.2/);
  assert.match(postgres, /security_opt:\s*\n\s+- no-new-privileges:true/);
  assert.match(postgres, /cap_drop:\s*\n\s+- ALL/);
  const postgresCapAdd = postgres.match(/cap_add:\s*\r?\n((?:\s+- \w+\r?\n?)+)/)?.[1] ?? '';
  assert.deepEqual([...postgresCapAdd.matchAll(/- (\w+)/g)].map((match) => match[1]), [
    'CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID',
  ]);
  for (const service of [postgres, minio, minioInitService, app]) {
    assert.match(service, /security_opt:\s*\n\s+- no-new-privileges:true/);
    assert.match(service, /logging:\s*\n\s+driver: json-file[\s\S]*?max-size: "10m"[\s\S]*?max-file: "3"/);
  }
  for (const service of [minio, minioInitService, app]) {
    assert.match(service, /cap_drop:\s*\n\s+- ALL/);
  }

  assert.doesNotMatch(app, /MINIO_ROOT_USER|MINIO_ROOT_PASSWORD/);
  assert.doesNotMatch(compose, /^\s*(?:POSTGRES_PASSWORD|MINIO_ROOT_PASSWORD|S3_SECRET_ACCESS_KEY):[ \t]+(?!\$\{)[^\r\n]+$/m);

  assert.match(minioInit, /mc alias set local http:\/\/minio:9000 "\$MINIO_ROOT_USER" "\$MINIO_ROOT_PASSWORD"/);
  assert.match(minioInit, /mc mb --ignore-existing "local\/\$S3_BUCKET"/);
  assert.match(minioInit, /mc anonymous set none "local\/\$S3_BUCKET"/);
  assert.match(minioInit, /mc version enable "local\/\$S3_BUCKET"/);
  assert.doesNotMatch(minioInit, /mc cors set|cors\.json|<CORSConfiguration/, 'the pinned MinIO release does not support bucket CORS; use its exact server origin control');
  assert.match(minioInit, /admin policy create local app-bucket-policy \/config\/app-bucket-policy\.json/);
  assert.match(minioInit, /admin user svcacct add local "\$MINIO_ROOT_USER"[\s\S]*?--access-key "\$S3_ACCESS_KEY_ID"[\s\S]*?--secret-key "\$S3_SECRET_ACCESS_KEY"/);
  assert.match(minioInit, /admin user svcacct edit local "\$S3_ACCESS_KEY_ID"[\s\S]*?--policy \/config\/app-bucket-policy\.json/);
  assert.match(minioInit, /anonymous_policy=\$\(mc anonymous get "local\/\$S3_BUCKET"\)/);
  assert.match(minioInit, /case "\$anonymous_policy" in/);
  assert.match(minioInit, /\*' is `private`'\|\*' is `none`'\) ;;/);
  assert.match(minioInit, /\*\) exit 1 ;;/);
  assert.doesNotMatch(minioInit, /\bgrep\b/);
  const policy = minioInit.match(/cat > \/config\/app-bucket-policy\.json <<EOF\r?\n([\s\S]*?)\r?\nEOF/)?.[1];
  assert.ok(policy, 'the bucket policy is generated as JSON');
  assert.deepEqual(JSON.parse(policy), {
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Action: ['s3:GetObject', 's3:PutObject'],
      Resource: ['arn:aws:s3:::$S3_BUCKET/*'],
    }, {
      Effect: 'Allow',
      Action: ['s3:ListBucket'],
      Resource: ['arn:aws:s3:::$S3_BUCKET'],
    }],
  });

});

test('local production WAF is the sole TLS edge and protects only the application host', async () => {
  const compose = await source('deploy/compose.local-production.yml');
  const dockerfile = await optionalSource('deploy/local-production/Dockerfile.waf');
  const caddyfile = await optionalSource('deploy/local-production/Caddyfile');
  const coraza = await optionalSource('deploy/local-production/coraza.conf');

  const waf = compose.match(/\n  waf:\n[\s\S]*?(?=\n  \w[\w-]*:\n|\nnetworks:)/)?.[0] ?? '';
  const app = compose.match(/\n  app:\n[\s\S]*?(?=\n  \w[\w-]*:\n|\nnetworks:)/)?.[0] ?? '';
  const minio = compose.match(/\n  minio:\n[\s\S]*?(?=\n  \w[\w-]*:\n|\nnetworks:)/)?.[0] ?? '';

  assert.match(dockerfile, /^FROM caddy:2\.11\.4-builder AS builder$/m);
  assert.match(dockerfile, /xcaddy build --with github\.com\/corazawaf\/coraza-caddy\/v2@v2\.5\.0/);
  assert.match(dockerfile, /^FROM caddy:2\.11\.4-alpine$/m);
  assert.match(dockerfile, /addgroup -S -g 1000 waf/);
  assert.match(dockerfile, /adduser -S -D -H -u 1000 -G waf waf/);
  assert.match(dockerfile, /chown -R waf:waf \/data \/config/);
  assert.match(dockerfile, /USER 1000:1000/);

  assert.match(waf, /build:\s*\n\s+context: \.\n\s+dockerfile: local-production\/Dockerfile\.waf/);
  assert.match(waf, /image: nanjing-petcare-waf:local/);
  assert.match(waf, /- "127\.0\.0\.1:\$\{LOCAL_HTTP_PORT:\?[^}]+\}:80"/);
  assert.match(waf, /- "127\.0\.0\.1:\$\{LOCAL_HTTPS_PORT:\?[^}]+\}:443"/);
  assert.match(waf, /- "127\.0\.0\.1:\$\{LOCAL_HTTPS_PORT:\?[^}]+\}:443\/udp"/);
  assert.doesNotMatch(waf, /- "(?:80:80|443:443|0\.0\.0\.0:)/);
  assert.match(waf, /ipv4_address: 172\.31\.0\.2/);
  assert.match(waf, /edge:/);
  assert.match(waf, /backend:/);
  assert.match(waf, /read_only: true/);
  assert.match(waf, /cap_drop:\s*\n\s+- ALL/);
  assert.match(waf, /cap_add:\s*\n\s+- NET_BIND_SERVICE/);
  assert.match(waf, /user: "1000:1000"/);
  assert.match(waf, /caddy_data:\/data/);
  assert.match(waf, /caddy_config:\/config/);
  assert.doesNotMatch(app, /^\s+ports:/m);
  assert.doesNotMatch(minio, /^\s+ports:/m);
  assert.equal([...compose.matchAll(/\}:80"/g)].length, 1, 'only WAF may publish container TCP port 80');
  assert.equal([...compose.matchAll(/\}:443"/g)].length, 1, 'only WAF may publish container TCP port 443');

  assert.match(caddyfile, /order coraza_waf first/);
  assert.match(caddyfile, /https:\/\/petcare\.localhost\s*\{[\s\S]*?coraza_waf\s*\{[\s\S]*?load_owasp_crs[\s\S]*?directives `Include \/etc\/caddy\/coraza\.conf`[\s\S]*?\}[\s\S]*?reverse_proxy app:3000\s*\{[\s\S]*?header_up X-Forwarded-For \{client_ip\}/);
  assert.match(caddyfile, /https:\/\/storage\.petcare\.localhost\s*\{[\s\S]*?reverse_proxy minio:9000/);
  const storage = caddyfile.match(/https:\/\/storage\.petcare\.localhost\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(storage, /respond @minio_console 404/);
  assert.doesNotMatch(storage, /coraza_waf|request_body|uri replace|header_up.*(?:X-Amz|Authorization)/i);

  assert.match(coraza, /SecRuleEngine On/);
  assert.match(coraza, /tx\.paranoia_level=1/);
  const allowedMethods = coraza.match(/setvar:'tx\.allowed_methods=([^']+)'/)?.[1];
  assert.equal(allowedMethods, 'GET HEAD POST PUT PATCH DELETE OPTIONS', 'password change, catalog updates and logout must reach their application handlers');
  assert.ok(coraza.indexOf('tx.allowed_methods=') < coraza.indexOf('Include @owasp_crs/*.conf'));
  assert.doesNotMatch(coraza, /SecRuleRemoveById\s+911100|TRACE|CONNECT/);
  assert.match(coraza, /SecRequestBodyLimit 1048576/);
  assert.match(coraza, /SecRequestBodyNoFilesLimit 1048576/);
  assert.match(coraza, /Include @owasp_crs\/\*\.conf/);
});

test('local production initializes storage, schema, and the guarded administrator before serving traffic', async () => {
  const compose = await source('deploy/compose.local-production.yml');
  const apiPackage = JSON.parse(await source('apps/api/package.json'));
  const adminInitScript = await optionalSource('deploy/local-production/admin-init.sh');
  const dockerfile = await source('Dockerfile');

  const service = (name) => compose.match(new RegExp(`\\n  ${name}:\\n[\\s\\S]*?(?=\\n  \\w[\\w-]*:\\n|\\nnetworks:)`))?.[0] ?? '';
  const migrate = service('migrate');
  const adminInit = service('admin-init');
  const app = service('app');
  const waf = service('waf');

  assert.equal(apiPackage.scripts['bootstrap:local-production-admin'], 'tsx src/pilot/bootstrap-local-production-admin.ts');
  assert.match(migrate, /restart: "no"/);
  assert.match(migrate, /prisma", "migrate", "deploy"/);
  assert.match(migrate, /postgres:\s*\n\s+condition: service_healthy/);
  assert.match(migrate, /minio:\s*\n\s+condition: service_healthy/);
  assert.match(migrate, /minio-init:\s*\n\s+condition: service_completed_successfully/);
  assert.doesNotMatch(migrate, /^\s+ports:/m);

  const minioInit = service('minio-init');
  assert.match(minioInit, /postgres:\s*\n\s+condition: service_healthy/);

  assert.match(adminInit, /restart: "no"/);
  assert.match(adminInit, /admin-init\.sh/);
  assert.match(adminInit, /user: "0:0"/);
  assert.match(adminInit, /LOCAL_PRODUCTION_REHEARSAL: enabled/);
  assert.match(adminInit, /admin-password-host:ro/);
  assert.match(adminInit, /\$\{LOCAL_PRODUCTION_SECRET_DIR:\?[^}]+\}\/admin-password:\/run\/secrets\/admin-password-host:ro/);
  assert.match(adminInit, /\/run\/admin-password:size=64k,mode=0700/);
  assert.match(adminInit, /migrate:\s*\n\s+condition: service_completed_successfully/);
  assert.doesNotMatch(adminInit, /MINIO_ROOT_USER|MINIO_ROOT_PASSWORD/);
  assert.doesNotMatch(adminInit, /^\s+ports:/m);
  const adminCapAdd = adminInit.match(/cap_add:\s*\r?\n((?:\s+- \w+\r?\n?)+)/)?.[1] ?? '';
  assert.deepEqual([...adminCapAdd.matchAll(/- (\w+)/g)].map((match) => match[1]), ['CHOWN', 'SETGID', 'SETUID']);
  assert.match(adminInitScript, /^#!\/bin\/sh$/m);
  assert.match(adminInitScript, /cat "\$host_password" > "\$staged_password"/);
  assert.match(adminInitScript, /chmod 0400 "\$staged_password"/);
  assert.match(adminInitScript, /chown node:node "\$staged_password"(?: "\$node_home" "\$node_cache")? "\$staging_directory"/);
  assert.match(adminInitScript, /su -p node -s \/bin\/sh -c/);
  assert.match(adminInitScript, /set -eu/);
  assert.match(adminInitScript, /LOCAL_PRODUCTION_REHEARSAL="\$LOCAL_PRODUCTION_REHEARSAL"/);
  assert.match(adminInitScript, /DATABASE_URL="\$DATABASE_URL"/);
  assert.match(adminInitScript, /PILOT_AUTH_PEPPER="\$PILOT_AUTH_PEPPER"/);
  assert.doesNotMatch(adminInitScript, /env -i[\s\S]*?ROOT_[A-Z_]+=/);
  assert.match(adminInitScript, /test "\$\(id -u\)" -eq 1000/);
  assert.match(adminInitScript, /test "\$\(id -g\)" -eq 1000/);
  assert.match(adminInitScript, /test -f \/run\/admin-password\/admin-password/);
  assert.match(adminInitScript, /--password-file \/run\/admin-password\/admin-password/);
  assert.match(adminInitScript, /bootstrap:local-production-admin --password-file \/run\/admin-password\/admin-password/);
  assert.doesNotMatch(adminInitScript, /bootstrap:local-production-admin -- --password-file/);
  assert.match(dockerfile, /ENV COREPACK_HOME=\/opt\/corepack/);
  assert.match(dockerfile, /corepack prepare pnpm@10\.15\.0 --activate/);
  assert.match(dockerfile, /chown -R node:node \/opt\/corepack/);

  assert.match(app, /admin-init:\s*\n\s+condition: service_completed_successfully/);
  assert.doesNotMatch(app, /admin-password|MINIO_ROOT_USER|MINIO_ROOT_PASSWORD/);
  assert.match(waf, /app:\s*\n\s+condition: service_healthy/);
});

test('MinIO service-account commands cannot write supplied credentials to init output', async () => {
  const minioInit = await source('deploy/local-production/minio-init.sh');

  assert.match(minioInit, /mc admin user svcacct edit local "\$S3_ACCESS_KEY_ID" \\\n+    --secret-key "\$S3_SECRET_ACCESS_KEY" \\\n+    --policy \/config\/app-bucket-policy\.json >\/dev\/null 2>&1/);
  assert.match(minioInit, /mc admin user svcacct add local "\$MINIO_ROOT_USER"[\s\S]*?--policy \/config\/app-bucket-policy\.json >\/dev\/null 2>&1/);
});
