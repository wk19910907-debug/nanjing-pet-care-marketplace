import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

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

  assert.match(postgres, /- "127\.0\.0\.1:\$\{POSTGRES_MAINTENANCE_PORT[^}]*\}:5432"/);
  assert.doesNotMatch(minio, /^\s+ports:/m);
  assert.match(postgres, /healthcheck:/);
  assert.match(minio, /healthcheck:/);
  assert.match(minioInitService, /minio:\s*\n\s+condition: service_healthy/);
  assert.match(app, /postgres:\s*\n\s+condition: service_healthy/);
  assert.match(app, /minio-init:\s*\n\s+condition: service_completed_successfully/);

  assert.match(compose, /edge:\s*\n\s+driver: bridge/);
  assert.match(compose, /backend:\s*\n\s+driver: bridge[\s\S]*?subnet: 172\.31\.0\.0\/24/);
  assert.match(app, /ipv4_address: 172\.31\.0\.3/);
  assert.match(app, /PILOT_TRUST_PROXY: 172\.31\.0\.2/);
  for (const service of [postgres, minio, app]) {
    assert.match(service, /security_opt:\s*\n\s+- no-new-privileges:true/);
    assert.match(service, /cap_drop:\s*\n\s+- ALL/);
    assert.match(service, /logging:\s*\n\s+driver: json-file[\s\S]*?max-size: "10m"[\s\S]*?max-file: "3"/);
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
  assert.match(minioInit, /https:\/\/petcare\.localhost/);
  assert.match(minioInit, /"GET", "PUT", "HEAD"/);
  assert.match(minioInit, /"ETag", "x-amz-checksum-sha256"/);
});
