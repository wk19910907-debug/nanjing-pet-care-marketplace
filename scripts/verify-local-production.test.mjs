import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const verifier = await import('./verify-local-production.mjs').catch(() => ({}));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('acceptance provider cleanup matches only its exact generated accounts', async () => {
  const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
  const { tsImport } = apiRequire('tsx/esm/api');
  const accounts = await tsImport(pathToFileURL(path.join(root, 'apps/admin/e2e/local-production.spec.ts')).href, import.meta.url);
  assert.equal(typeof accounts.isAcceptanceProviderAccount, 'function');
  const valid = { userId: 'id', username: 'verify.abcdef123456', displayName: '验收abcdef123456', role: 'PROVIDER', disabledAt: null };
  assert.equal(accounts.isAcceptanceProviderAccount(valid), true);
  for (const record of [
    { ...valid, username: 'verify.admin' },
    { ...valid, displayName: '真实服务人员' },
    { ...valid, role: 'ADMIN' },
    { ...valid, disabledAt: '2026-09-13T00:00:00.000Z' },
  ]) assert.equal(accounts.isAcceptanceProviderAccount(record), false);
});

test('named checks never report exception details, headers, signed URLs or environment secrets', async () => {
  assert.equal(typeof verifier.createChecks, 'function');
  const output = [];
  const check = verifier.createChecks((line) => output.push(line));
  const bypassed = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (line) => { bypassed.push(String(line)); return true; };
  const secrets = ['Cookie: session=canary', 'Authorization: Bearer canary', 'https://storage.petcare.localhost/a?X-Amz-Signature=canary', 'FIELD_ENCRYPTION_KEY_V1=canary'];
  try {
    for (const secret of secrets) {
      await assert.rejects(check('readiness', async () => { throw new Error(secret); }), { message: 'CHECK_FAILED' });
      await assert.rejects(check(secret, async () => 200), { message: 'CHECK_NAME_INVALID' });
    }
    await check('readiness', async () => 200);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.deepEqual(bypassed, []);
  assert.deepEqual(output, [...secrets.map(() => '[local-production] readiness FAIL 1\n'), '[local-production] readiness PASS 200\n']);
});

test('status output rejects arbitrary returned data', async () => {
  assert.equal(typeof verifier.createChecks, 'function');
  const output = [];
  await assert.rejects(verifier.createChecks((line) => output.push(line))('readiness', async () => 'secret'));
  assert.deepEqual(output, ['[local-production] readiness FAIL 1\n']);
});

test('readiness retries are bounded and failures contain no original error', async () => {
  assert.equal(typeof verifier.retry, 'function');
  let attempts = 0;
  await assert.rejects(verifier.retry(async () => { attempts++; throw new Error('private'); }, { attempts: 3, delayMs: 0 }), { message: 'RETRY_EXHAUSTED' });
  assert.equal(attempts, 3);
  attempts = 0;
  assert.equal(await verifier.retry(async () => ++attempts === 2 ? 200 : false, { attempts: 3, delayMs: 0 }), 200);
  assert.equal(attempts, 2);
  await assert.rejects(verifier.retry(async () => true, { attempts: 0 }), { message: 'RETRY_OPTIONS_INVALID' });
});

test('cleanup closes every owned resource once even when one close fails', async () => {
  assert.equal(typeof verifier.createCleanup, 'function');
  const cleanup = verifier.createCleanup();
  const calls = [];
  cleanup.add(async () => { calls.push('browser'); throw new Error('cookie-secret'); });
  cleanup.add(async () => { calls.push('request'); });
  await assert.rejects(cleanup.run(), { message: 'CLEANUP_FAILED' });
  await assert.rejects(cleanup.run(), { message: 'CLEANUP_FAILED' });
  assert.deepEqual(calls.sort(), ['browser', 'request']);
});

test('restart attempts to leave services running after a partial stop or failed probe', async () => {
  assert.equal(typeof verifier.restartPreservingVolumes, 'function');
  const calls = [];
  await assert.rejects(verifier.restartPreservingVolumes({
    stop: async () => { calls.push('stop'); throw new Error('stop-secret'); },
    start: async () => { calls.push('start'); },
    probe: async () => { calls.push('probe'); },
  }), { message: 'RESTART_FAILED' });
  assert.deepEqual(calls, ['stop', 'start']);
  calls.length = 0;
  await assert.rejects(verifier.restartPreservingVolumes({
    stop: async () => { calls.push('stop'); },
    start: async () => { calls.push('start'); },
    probe: async () => { calls.push('probe'); throw new Error('private'); },
  }), { message: 'RESTART_FAILED' });
  assert.deepEqual(calls, ['stop', 'start', 'probe']);
});

test('log inspection rejects raw or encoded probe secrets and signed query strings', () => {
  assert.equal(typeof verifier.logsAreSafe, 'function');
  assert.equal(verifier.logsAreSafe('request completed 200', ['secret/+']), true);
  for (const text of ['secret/+', 'secret%2F%2B', 'GET /key?X-Amz-Signature=abc', 'GET /key?x-amz-credential=abc']) {
    assert.equal(verifier.logsAreSafe(text, ['secret/+']), false);
  }
});

test('HTTPS probes resolve only the two fixed rehearsal origins to loopback without global TLS overrides', () => {
  assert.equal(typeof verifier.localHttpsOptions, 'function');
  const options = verifier.localHttpsOptions('https://storage.petcare.localhost/bucket/key?X-Amz-Signature=canary');
  assert.equal(options.hostname, '127.0.0.1');
  assert.equal(options.servername, 'storage.petcare.localhost');
  assert.equal(options.headers.Host, 'storage.petcare.localhost');
  assert.equal(options.path, '/bucket/key?X-Amz-Signature=canary');
  assert.equal(options.rejectUnauthorized, false);
  for (const url of ['https://example.com', 'http://petcare.localhost', 'https://petcare.localhost:444', 'https://user:secret@petcare.localhost']) {
    assert.throws(() => verifier.localHttpsOptions(url), { message: 'PROBE_ORIGIN_INVALID' });
  }
});
