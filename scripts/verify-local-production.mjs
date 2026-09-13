import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://petcare.localhost';
const storageOrigin = 'https://storage.petcare.localhost';
export const checkNames = Object.freeze([
  'runtime', 'secrets', 'browser', 'readiness', 'waf-sqli', 'waf-traversal', 'waf-xss',
  'normal-api', 'rate-limit', 'private-list', 'private-object', 'console-admin', 'console-ui',
  'signed-put', 'signed-get', 'tampered-key', 'tampered-signature', 'checksum-rejected',
  'direct-app', 'direct-minio', 'direct-console', 'host-bindings',
  'owner-booking', 'administrator-login', 'provider-onboarding', 'dispatch', 'evidence-report',
  'owner-completion', 'restart', 'persisted-admin', 'persisted-order', 'persisted-evidence',
  'application-logs', 'cleanup', 'acceptance',
]);

export function createChecks(write = (line) => process.stdout.write(line)) {
  return async (name, operation) => {
    if (!checkNames.includes(name)) throw new Error('CHECK_NAME_INVALID');
    try {
      const code = await operation();
      if (!Number.isInteger(code) || code < 0 || code > 599) throw new Error('STATUS_INVALID');
      write(`[local-production] ${name} PASS ${code}\n`);
      return code;
    } catch {
      write(`[local-production] ${name} FAIL 1\n`);
      throw new Error('CHECK_FAILED');
    }
  };
}

export async function retry(operation, { attempts = 30, delayMs = 1000 } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 120 || delayMs < 0 || delayMs > 5000) throw new Error('RETRY_OPTIONS_INVALID');
  for (let index = 0; index < attempts; index++) {
    try { const value = await operation(); if (value) return value; } catch { /* No raw diagnostics. */ }
    if (index + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error('RETRY_EXHAUSTED');
}

export function createCleanup() {
  const callbacks = [];
  let pending;
  return {
    add: (callback) => callbacks.push(callback),
    run: () => pending ??= (async () => {
      const results = await Promise.allSettled(callbacks.map((callback) => Promise.resolve().then(callback)));
      if (results.some((result) => result.status === 'rejected')) throw new Error('CLEANUP_FAILED');
    })(),
  };
}

export async function restartPreservingVolumes({ stop, start, probe }) {
  let started = false;
  try {
    await stop();
    await start();
    started = true;
    await probe();
  } catch { throw new Error('RESTART_FAILED'); }
  finally {
    if (!started) {
      try { await start(); } catch { throw new Error('RESTART_FAILED'); }
    }
  }
}

export function logsAreSafe(logs, secrets) {
  return !/x-amz-(?:signature|credential)=/i.test(logs)
    && secrets.filter(Boolean).every((secret) => !logs.includes(secret) && !logs.includes(encodeURIComponent(secret)));
}

function requireCondition(condition) { if (!condition) throw new Error('ASSERTION_FAILED'); }

export function localHttpsOptions(input) {
  const url = new URL(input);
  if (![origin, storageOrigin].includes(url.origin) || url.username || url.password) throw new Error('PROBE_ORIGIN_INVALID');
  return { hostname: '127.0.0.1', port: 443, servername: url.hostname, headers: { Host: url.host }, path: url.pathname + url.search, rejectUnauthorized: false };
}

function probeRequest(url, init = {}) {
  const options = localHttpsOptions(url);
  return new Promise((resolve, reject) => {
    const request = https.request({ ...options, method: init.method ?? 'GET', headers: { ...init.headers, ...options.headers } }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) request.destroy(new Error('PROBE_TOO_LARGE'));
        else chunks.push(chunk);
      });
      response.once('error', () => reject(new Error('PROBE_FAILED')));
      response.once('end', () => resolve({ status: () => response.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.setTimeout(5000, () => request.destroy(new Error('PROBE_TIMEOUT')));
    request.once('error', () => reject(new Error('PROBE_FAILED')));
    request.end(init.data);
  });
}

async function capture(command, args, env = process.env) {
  try {
    const { stdout, stderr } = await promisify(execFile)(command, args, {
      cwd: root, env, windowsHide: true, timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
    });
    return stdout + stderr;
  } catch { throw new Error('PROCESS_FAILED'); }
}

async function compose(action, target) {
  // Reuse the controller's validation, environment isolation and Compose fallback.
  const commands = {
    stop: "@('stop','waf','app','minio','postgres')",
    start: "@('start','postgres','minio','app','waf')",
    logs: "@('logs','--no-color','app')",
  };
  requireCondition(Object.hasOwn(commands, action));
  const script = `. ./scripts/local-production.ps1; $compose = Get-LocalProductionCompose; $result = Invoke-LocalProductionCompose $compose $env:LOCAL_PRODUCTION_SECRET_DIR ${commands[action]} 'acceptance'; $result.Output`;
  return capture('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { ...process.env, LOCAL_PRODUCTION_SECRET_DIR: target });
}

async function portClosed(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (closed) => { socket.destroy(); resolve(closed); };
    socket.once('connect', () => finish(false));
    socket.once('error', (error) => finish(error.code === 'ECONNREFUSED'));
    socket.setTimeout(1500, () => finish(false));
  });
}

export async function main() {
  const check = createChecks();
  const cleanup = createCleanup();
  const sensitive = new Set();
  let interrupted = false;
  const abort = () => { interrupted = true; void cleanup.run().catch(() => {}); };
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    await check('runtime', async () => { requireCondition(process.versions.node.startsWith('22.')); return 0; });
    const target = process.env.LOCAL_PRODUCTION_SECRET_DIR;
    let adminPassword;
    let bucket;
    await check('secrets', async () => {
      requireCondition(target && path.isAbsolute(target));
      // Controller validates ownership and every parent against reparse points.
      await capture('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '. ./scripts/local-production.ps1; $target = Get-LocalProductionSecretTarget -Destination $env:LOCAL_PRODUCTION_SECRET_DIR -RepositoryRoot (Get-NormalizedPath (Get-Location).Path); Assert-ExistingSecretsAreValid -EnvironmentPath (Join-Path $target local-production.env) -AdminPasswordPath (Join-Path $target admin-password)']);
      const environment = await readFile(path.join(target, 'local-production.env'), 'utf8');
      const values = Object.fromEntries(environment.split(/\r?\n/).filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
      adminPassword = (await readFile(path.join(target, 'admin-password'), 'utf8')).replace(/\r?\n$/, '');
      sensitive.add(adminPassword);
      for (const [key, value] of Object.entries(values)) if (/PASSWORD|SECRET|KEY|PEPPER|DATABASE_URL/.test(key)) sensitive.add(value);
      bucket = values.S3_BUCKET;
      requireCondition(/^[a-z0-9-]+$/.test(bucket));
      return 0;
    });
    const adminRequire = createRequire(path.join(root, 'apps/admin/package.json'));
    const { chromium } = adminRequire('@playwright/test');
    let browser;
    await check('browser', async () => {
      browser = await chromium.launch({ headless: true });
      cleanup.add(() => browser.close());
      return 0;
    });
    const request = { get: probeRequest, put: (url, init) => probeRequest(url, { ...init, method: 'PUT' }) };
    const ready = () => retry(async () => {
      const response = await request.get(`${origin}/health/ready`, { timeout: 5000 });
      const body = await response.json();
      requireCondition(response.status() === 200 && body.ready && body.database && body.objectStorage && body.encryption && body.objectStorageProvider === 's3');
      // In production ready=true includes the credential probe; actual login below
      // independently proves administrator readiness without exposing its identity.
      return 200;
    });
    const waf = async () => {
      for (const [name, value] of [
        ['waf-sqli', "1' OR 1=1 UNION SELECT password FROM users--"],
        ['waf-traversal', '../../../../etc/passwd'],
        ['waf-xss', '<script>alert(document.cookie)</script>'],
      ]) await check(name, async () => {
        const response = await request.get(`${origin}/health/live?probe=${encodeURIComponent(value)}`);
        requireCondition(response.status() === 403);
        return response.status();
      });
    };
    await check('readiness', ready);
    await waf();
    const canary = randomBytes(24).toString('base64url');
    sensitive.add(canary);
    await check('normal-api', async () => {
      const response = await request.get(`${origin}/health/live`, { headers: { Cookie: `acceptance_probe=${canary}`, Authorization: `Bearer ${canary}` } });
      requireCondition(response.status() === 200 && (await response.json()).alive === true);
      return response.status();
    });
    await check('rate-limit', async () => {
      const statuses = await Promise.all(Array.from({ length: 16 }, async (_, index) => (
        await request.get(`${origin}/health/live`, { headers: { 'X-Forwarded-For': `203.0.113.${index + 1}` } })
      ).status()));
      requireCondition(statuses.includes(200) && statuses.includes(429));
      return 429;
    });
    for (const [name, url, denied] of [
      ['private-list', `${storageOrigin}/${bucket}?list-type=2`, [403]],
      ['console-admin', `${storageOrigin}/minio/admin/v3/info`, [403, 404]],
      ['console-ui', `${storageOrigin}/minio/console/`, [403, 404]],
    ]) await check(name, async () => {
      const response = await request.get(url, { maxRedirects: 0 });
      requireCondition(denied.includes(response.status())); return response.status();
    });
    for (const [name, port] of [['direct-app', 3000], ['direct-minio', 9000], ['direct-console', 9001]]) {
      await check(name, async () => { requireCondition(await portClosed(port)); return 0; });
    }
    await check('host-bindings', async () => {
      for (const name of ['app', 'minio']) {
        const raw = await capture('docker', ['inspect', '--format', '{{json .HostConfig.PortBindings}}', `nanjing-petcare-local-production-${name}-1`]);
        requireCondition(Object.keys(JSON.parse(raw) ?? {}).length === 0);
      }
      return 0;
    });
    const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
    const { tsImport } = apiRequire('tsx/esm/api');
    const { verifyBrowserWorkflow } = await tsImport(pathToFileURL(path.join(root, 'apps/admin/e2e/local-production.spec.ts')).href, import.meta.url);
    const workflow = await verifyBrowserWorkflow({ browser, check, adminPassword, rememberSecret: (value) => sensitive.add(value) });
    await check('private-object', async () => {
      const unsigned = new URL(workflow.readUrl); unsigned.search = '';
      const response = await request.get(unsigned.href);
      requireCondition(response.status() === 403); return response.status();
    });
    for (const variant of ['key', 'signature']) await check(`tampered-${variant}`, async () => {
      const tampered = new URL(workflow.readUrl);
      if (variant === 'key') tampered.pathname += '-tampered';
      else {
        const signature = tampered.searchParams.get('X-Amz-Signature');
        requireCondition(signature?.length === 64);
        tampered.searchParams.set('X-Amz-Signature', `${signature[0] === '0' ? '1' : '0'}${signature.slice(1)}`);
      }
      const response = await request.get(tampered.href);
      requireCondition(response.status() === 403); return response.status();
    });
    await check('checksum-rejected', async () => {
      const response = await request.put(workflow.uploadUrl, { data: Buffer.from('incorrect-content'), headers: workflow.uploadHeaders });
      requireCondition([400, 403].includes(response.status())); return response.status();
    });
    await check('restart', async () => {
      await restartPreservingVolumes({ stop: () => compose('stop', target), start: () => compose('start', target), probe: ready });
      return 0;
    });
    await check('readiness', ready);
    await waf();
    await workflow.verifyPersistence();
    await check('application-logs', async () => {
      requireCondition(logsAreSafe(await compose('logs', target), [...sensitive])); return 0;
    });
    requireCondition(!interrupted);
    await check('acceptance', async () => 0);
  } catch { process.exitCode = 1; }
  finally {
    await check('cleanup', async () => { await cleanup.run(); return 0; }).catch(() => { process.exitCode = 1; });
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stdout.write('[local-production] acceptance FAIL 1\n'); process.exitCode = 1; });
}
