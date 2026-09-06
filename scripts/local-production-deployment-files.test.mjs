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
  assert.match(postgres, /healthcheck:/);
  assert.match(minio, /healthcheck:/);
  assert.match(minioInitService, /minio:\s*\n\s+condition: service_healthy/);
  assert.match(app, /postgres:\s*\n\s+condition: service_healthy/);
  assert.match(app, /minio:\s*\n\s+condition: service_healthy/);
  assert.match(app, /minio-init:\s*\n\s+condition: service_completed_successfully/);

  assert.match(compose, /edge:\s*\n\s+driver: bridge/);
  assert.match(compose, /backend:\s*\n\s+driver: bridge[\s\S]*?subnet: 172\.31\.0\.0\/24/);
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
  assert.match(minioInit, /mc cors set "local\/\$S3_BUCKET" \/config\/cors\.json/);
  assert.match(minioInit, /admin policy create local app-bucket-policy \/config\/app-bucket-policy\.json/);
  assert.match(minioInit, /admin user svcacct add local "\$MINIO_ROOT_USER"[\s\S]*?--access-key "\$S3_ACCESS_KEY_ID"[\s\S]*?--secret-key "\$S3_SECRET_ACCESS_KEY"/);
  assert.match(minioInit, /admin user svcacct edit local "\$S3_ACCESS_KEY_ID"[\s\S]*?--policy \/config\/app-bucket-policy\.json/);
  assert.match(minioInit, /mc anonymous get "local\/\$S3_BUCKET" \| grep -Eq '\(private\|none\)'/);
  const policy = minioInit.match(/cat > \/config\/app-bucket-policy\.json <<EOF\r?\n([\s\S]*?)\r?\nEOF/)?.[1];
  assert.ok(policy, 'the bucket policy is generated as JSON');
  assert.deepEqual(JSON.parse(policy), {
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Action: ['s3:GetObject', 's3:PutObject'],
      Resource: ['arn:aws:s3:::$S3_BUCKET/*'],
    }],
  });

  const cors = minioInit.match(/cat > \/config\/cors\.json <<'EOF'\r?\n([\s\S]*?)\r?\nEOF/)?.[1];
  assert.ok(cors, 'the CORS configuration is generated as XML');
  assert.match(cors, /^<\?xml version="1\.0" encoding="UTF-8"\?>\r?\n<CORSConfiguration xmlns="http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/">/);
  assert.deepEqual([...cors.matchAll(/<AllowedOrigin>([^<]+)<\/AllowedOrigin>/g)].map((match) => match[1]), ['https://petcare.localhost']);
  assert.deepEqual([...cors.matchAll(/<AllowedMethod>([^<]+)<\/AllowedMethod>/g)].map((match) => match[1]), ['GET', 'PUT', 'HEAD']);
  assert.deepEqual([...cors.matchAll(/<ExposeHeader>([^<]+)<\/ExposeHeader>/g)].map((match) => match[1]), ['ETag', 'x-amz-checksum-sha256']);
  assert.match(cors, /<\/CORSConfiguration>$/);
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
  assert.match(waf, /- "80:80"/);
  assert.match(waf, /- "443:443"/);
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
  assert.equal([...compose.matchAll(/- "80:80"/g)].length, 1, 'only WAF may publish TCP port 80');
  assert.equal([...compose.matchAll(/- "443:443"/g)].length, 1, 'only WAF may publish TCP port 443');

  assert.match(caddyfile, /order coraza_waf first/);
  assert.match(caddyfile, /https:\/\/petcare\.localhost\s*\{[\s\S]*?coraza_waf\s*\{[\s\S]*?load_owasp_crs[\s\S]*?directives `Include \/etc\/caddy\/coraza\.conf`[\s\S]*?\}[\s\S]*?reverse_proxy app:3000\s*\{[\s\S]*?header_up X-Forwarded-For \{client_ip\}/);
  assert.match(caddyfile, /https:\/\/storage\.petcare\.localhost\s*\{[\s\S]*?reverse_proxy minio:9000/);
  const storage = caddyfile.match(/https:\/\/storage\.petcare\.localhost\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(storage, /respond @minio_console 404/);
  assert.doesNotMatch(storage, /coraza_waf|request_body|uri replace|header_up.*(?:X-Amz|Authorization)/i);

  assert.match(coraza, /SecRuleEngine On/);
  assert.match(coraza, /tx\.paranoia_level=1/);
  assert.match(coraza, /SecRequestBodyLimit 1048576/);
  assert.match(coraza, /SecRequestBodyNoFilesLimit 1048576/);
  assert.match(coraza, /Include @owasp_crs\/\*\.conf/);
});
