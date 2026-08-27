import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dockerImage = 'postgres:16-alpine';
const resourcePrefix = 'petcare-live-';
const nodeMajor = Number(process.versions.node.split('.')[0]);

if (nodeMajor !== 22) {
  process.stderr.write(`Live acceptance requires Node.js 22.x; received ${process.version}.\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed (${code ?? signal ?? 'unknown'})`));
    });
  });
}

function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      windowsHide: true,
      ...options,
      stdio: ['ignore', 'pipe', options.inheritStderr ? 'inherit' : 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr += chunk; });
    }
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${path.basename(command)} failed (${code ?? signal ?? 'unknown'}): ${stderr.trim()}`));
    });
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to reserve a loopback port');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitFor(predicate, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), resourcePrefix));
const evidenceDir = path.join(tempRoot, 'evidence');
const playwrightOutput = path.join(tempRoot, 'playwright');
const containerName = `${resourcePrefix}${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const databasePort = await freePort();
const pilotPort = await freePort();
const databasePassword = randomBytes(24).toString('base64url');
const databaseUrl = `postgresql://pilot:${encodeURIComponent(databasePassword)}@127.0.0.1:${databasePort}/pilot?schema=public`;
const pilotBaseUrl = `http://127.0.0.1:${pilotPort}`;
const authPepper = randomBytes(32).toString('base64');
const fieldKey = randomBytes(32).toString('base64');
const serverEnvironment = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: databaseUrl,
  FIELD_ENCRYPTION_KEY_V1: fieldKey,
  PILOT_MODE: 'enabled',
  PILOT_HOST: '127.0.0.1',
  PILOT_PORT: String(pilotPort),
  PILOT_AUTH_PEPPER: authPepper,
  PILOT_EVIDENCE_DIR: evidenceDir,
};

let containerStarted = false;
let pilotProcess;
let controlServer;
let restartGeneration = 0;

const tsxCli = path.join(repositoryRoot, 'apps/api/node_modules/tsx/dist/cli.mjs');
const apiEntry = path.join(repositoryRoot, 'apps/api/src/server.ts');

async function startPilot() {
  const child = spawn(process.execPath, [tsxCli, apiEntry], {
    cwd: repositoryRoot,
    env: serverEnvironment,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  pilotProcess = child;
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`pilot process exited ${child.exitCode}`);
    const response = await fetch(`${pilotBaseUrl}/health/ready`);
    return response.status === 200;
  }, 'pilot server', 30_000);
  restartGeneration += 1;
}

async function restartPilot() {
  await stopChild(pilotProcess);
  pilotProcess = undefined;
  await startPilot();
  process.stdout.write(`[live] Pilot server restart ${restartGeneration - 1} completed.\n`);
}

async function cleanup() {
  if (controlServer) {
    await new Promise((resolve) => controlServer.close(() => resolve()));
    controlServer = undefined;
  }
  await stopChild(pilotProcess);
  pilotProcess = undefined;
  if (containerStarted) {
    await capture('docker', ['rm', '-f', containerName]).catch(() => undefined);
    containerStarted = false;
  }
  const resolvedTemp = path.resolve(tempRoot);
  const resolvedOsTemp = path.resolve(os.tmpdir());
  if (path.dirname(resolvedTemp) !== resolvedOsTemp || !path.basename(resolvedTemp).startsWith(resourcePrefix)) {
    throw new Error('Refusing to remove an unexpected acceptance path');
  }
  await rm(resolvedTemp, { recursive: true, force: true });
}

let exitCode = 1;
try {
  await mkdir(evidenceDir, { recursive: true });
  await mkdir(playwrightOutput, { recursive: true });

  await capture('docker', ['version', '--format', '{{.Server.Version}}']);
  await capture('docker', [
    'run', '--detach', '--rm', '--name', containerName,
    '--publish', `127.0.0.1:${databasePort}:5432`,
    '--env', 'POSTGRES_USER=pilot',
    '--env', `POSTGRES_PASSWORD=${databasePassword}`,
    '--env', 'POSTGRES_DB=pilot',
    dockerImage,
  ], { inheritStderr: true });
  containerStarted = true;

  let postgresVersion = '';
  await waitFor(async () => {
    try {
      await capture('docker', ['exec', containerName, 'pg_isready', '--username', 'pilot', '--dbname', 'pilot']);
      postgresVersion = await capture('docker', [
        'exec', containerName, 'psql', '--username', 'pilot', '--dbname', 'pilot',
        '--tuples-only', '--no-align', '--command', 'SHOW server_version_num',
      ]);
      return postgresVersion.startsWith('16');
    } catch {
      return false;
    }
  }, 'PostgreSQL 16', 90_000);
  if (!postgresVersion.startsWith('16')) throw new Error(`Expected PostgreSQL 16, received ${postgresVersion}`);
  process.stdout.write('[live] Fresh PostgreSQL 16 database is ready.\n');

  await run(process.execPath, [
    path.join(repositoryRoot, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy',
  ], { env: { ...process.env, DATABASE_URL: databaseUrl } });

  await run(process.execPath, [
    path.join(repositoryRoot, 'apps/admin/node_modules/vite/bin/vite.js'), 'build', '--mode', 'pilot',
  ], { cwd: path.join(repositoryRoot, 'apps/admin') });

  const adminInvite = await capture(process.execPath, [
    tsxCli, path.join(repositoryRoot, 'apps/api/src/pilot/bootstrap.ts'),
  ], { env: serverEnvironment });
  if (!adminInvite) throw new Error('Pilot bootstrap did not return an invitation');
  process.stdout.write('[live] One-time administrator invitation created in memory.\n');

  await startPilot();
  process.stdout.write('[live] Actual pilot server and built UI are ready.\n');

  const controlSecret = randomBytes(24).toString('base64url');
  const controlPort = await freePort();
  const controlPath = `/restart/${controlSecret}`;
  controlServer = http.createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== controlPath) {
      response.writeHead(404).end();
      return;
    }
    void restartPilot().then(() => {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ generation: restartGeneration }));
    }).catch(() => {
      response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ code: 'RESTART_FAILED' }));
    });
  });
  await new Promise((resolve, reject) => {
    controlServer.once('error', reject);
    controlServer.listen(controlPort, '127.0.0.1', resolve);
  });

  await run(process.execPath, [
    path.join(repositoryRoot, 'apps/admin/node_modules/@playwright/test/cli.js'),
    'test', '--config', 'apps/admin/playwright.live.config.ts',
  ], { env: {
    ...process.env,
    PILOT_ACCEPTANCE_BASE_URL: pilotBaseUrl,
    PILOT_ACCEPTANCE_ADMIN_INVITE: adminInvite,
    PILOT_ACCEPTANCE_CONTROL_URL: `http://127.0.0.1:${controlPort}${controlPath}`,
    PILOT_ACCEPTANCE_OUTPUT_DIR: playwrightOutput,
  }});
  exitCode = 0;
} catch (error) {
  process.stderr.write(`[live] Acceptance failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
} finally {
  await cleanup().catch((error) => {
    exitCode = 1;
    process.stderr.write(`[live] Cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  });
  process.stdout.write('[live] API, database container, and temporary evidence artifacts removed.\n');
}

process.exitCode = exitCode;
