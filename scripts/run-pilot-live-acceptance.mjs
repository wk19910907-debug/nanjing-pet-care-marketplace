import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, unlink } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  acceptanceStatePath,
  reclaimStaleRun,
  writeAcceptanceState,
} from './pilot-live-state.mjs';

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

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to reserve a loopback port');
  return {
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
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
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  if (!child || exited()) return;
  child.kill('SIGTERM');
  await waitFor(exited, 'child process exit after SIGTERM', 5_000).catch(() => undefined);
  if (exited()) return;
  child.kill('SIGKILL');
  await waitFor(exited, 'child process exit after SIGKILL', 5_000);
}

const tsxCli = path.join(repositoryRoot, 'apps/api/node_modules/tsx/dist/cli.mjs');
const apiEntry = path.join(repositoryRoot, 'apps/api/src/server.ts');
const runnerEntry = fileURLToPath(import.meta.url);
const statePath = acceptanceStatePath(os.tmpdir());

async function inspectProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Refusing to inspect an invalid pid');
  if (process.platform === 'win32') {
    const result = await capture('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if($p){$p | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress}`,
    ]);
    if (!result) return null;
    return JSON.parse(result).CommandLine ?? null;
  }
  const result = await capture('ps', ['-p', String(pid), '-o', 'args=']);
  return result || null;
}

async function findApiProcess(runId) {
  if (process.platform === 'win32') {
    const escapedEntry = apiEntry.replaceAll("'", "''");
    const result = await capture('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p=Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*${escapedEntry}*' -and $_.CommandLine -like '*--pilot-acceptance-run=${runId}*' } | Select-Object -First 1; if($p){$p | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress}`,
    ]);
    if (!result) return null;
    const parsed = JSON.parse(result);
    return { pid: Number(parsed.ProcessId), commandLine: parsed.CommandLine };
  }
  const result = await capture('ps', ['-eo', 'pid=,args=']);
  const match = result.split(/\r?\n/).find((line) => line.includes(apiEntry)
    && line.includes(`--pilot-acceptance-run=${runId}`));
  if (!match) return null;
  const parsed = /^\s*(\d+)\s+(.+)$/.exec(match);
  return parsed ? { pid: Number(parsed[1]), commandLine: parsed[2] } : null;
}

async function stopExternalProcess(pid) {
  const stop = async (signal) => {
    try { process.kill(pid, signal); } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ESRCH') throw error;
    }
  };
  await stop('SIGTERM');
  await waitFor(async () => (await inspectProcess(pid)) === null, 'stale API exit after SIGTERM', 5_000)
    .catch(() => undefined);
  if (await inspectProcess(pid) === null) return;
  await stop('SIGKILL');
  await waitFor(async () => (await inspectProcess(pid)) === null, 'stale API exit after SIGKILL', 5_000);
}

async function inspectContainer(containerName) {
  try {
    const runId = await capture('docker', [
      'container', 'inspect', '--format', '{{ index .Config.Labels "com.petcare.live-run" }}', containerName,
    ]);
    return runId || '';
  } catch (error) {
    if (error instanceof Error && /No such (?:object|container)/i.test(error.message)) return null;
    throw error;
  }
}

await capture('docker', ['version', '--format', '{{.Server.Version}}']);
if (await reclaimStaleRun({
  statePath,
  tempDirectory: os.tmpdir(),
  currentPid: process.pid,
  runnerEntry,
  apiEntry,
  inspectProcess,
  findApiProcess,
  stopProcess: stopExternalProcess,
  inspectContainer,
  removeContainer: (name) => capture('docker', ['rm', '-f', name]),
})) {
  process.stdout.write('[live] Reclaimed one validated stale acceptance run.\n');
}

const runId = randomUUID().replaceAll('-', '').slice(0, 16);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), resourcePrefix));
const evidenceDir = path.join(tempRoot, 'evidence');
const playwrightOutput = path.join(tempRoot, 'playwright');
const containerName = `${resourcePrefix}${runId}`;
let databaseReservation = await reservePort();
let pilotReservation = await reservePort();
let controlReservation = await reservePort();
const databasePort = databaseReservation.port;
const pilotPort = pilotReservation.port;
const controlPort = controlReservation.port;
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
let cleanupPromise;
let state = { version: 1, runId, runnerPid: process.pid, apiPid: null, containerName, tempRoot };

await writeAcceptanceState(statePath, state, os.tmpdir());

async function persistState(apiPid) {
  state = { ...state, apiPid };
  await writeAcceptanceState(statePath, state, os.tmpdir());
}

async function releaseReservation(name) {
  const reservation = name === 'database'
    ? databaseReservation
    : name === 'pilot' ? pilotReservation : controlReservation;
  if (!reservation) return;
  await reservation.close();
  if (name === 'database') databaseReservation = undefined;
  else if (name === 'pilot') pilotReservation = undefined;
  else controlReservation = undefined;
}

async function startPilot() {
  const child = spawn(process.execPath, [tsxCli, apiEntry, `--pilot-acceptance-run=${runId}`], {
    cwd: repositoryRoot,
    env: serverEnvironment,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  pilotProcess = child;
  await persistState(child.pid);
  await waitFor(async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`pilot process exited ${child.exitCode ?? child.signalCode}`);
    }
    const response = await fetch(`${pilotBaseUrl}/health/ready`);
    return response.status === 200;
  }, 'pilot server', 30_000);
  restartGeneration += 1;
}

async function restartPilot() {
  await stopChild(pilotProcess);
  pilotProcess = undefined;
  await persistState(null);
  await startPilot();
  process.stdout.write(`[live] Pilot server restart ${restartGeneration - 1} completed.\n`);
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    await Promise.all([
      releaseReservation('database'), releaseReservation('pilot'), releaseReservation('control'),
    ]);
    if (controlServer) {
      await new Promise((resolve) => controlServer.close(() => resolve()));
      controlServer = undefined;
    }
    await stopChild(pilotProcess);
    pilotProcess = undefined;
    await persistState(null);
    if (containerStarted) {
      const label = await inspectContainer(containerName);
      if (label !== runId) throw new Error('Refusing to remove a container with a mismatched live-run label');
      await capture('docker', ['rm', '-f', containerName]);
      containerStarted = false;
    }
    const resolvedTemp = path.resolve(tempRoot);
    const resolvedOsTemp = path.resolve(os.tmpdir());
    if (path.dirname(resolvedTemp) !== resolvedOsTemp || !path.basename(resolvedTemp).startsWith(resourcePrefix)) {
      throw new Error('Refusing to remove an unexpected acceptance path');
    }
    await rm(resolvedTemp, { recursive: true, force: true });
    await unlink(statePath);
  })();
  return cleanupPromise;
}

let handlingSignal = false;
async function handleSignal(signal) {
  if (handlingSignal) return;
  handlingSignal = true;
  process.stderr.write(`[live] Received ${signal}; cleaning owned resources.\n`);
  await cleanup().catch((error) => {
    process.stderr.write(`[live] Signal cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  });
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.once('SIGINT', () => { void handleSignal('SIGINT'); });
process.once('SIGTERM', () => { void handleSignal('SIGTERM'); });

let exitCode = 1;
try {
  await mkdir(evidenceDir, { recursive: true });
  await mkdir(playwrightOutput, { recursive: true });

  await releaseReservation('database');
  await capture('docker', [
    'run', '--detach', '--rm', '--name', containerName,
    '--label', 'com.petcare.live-acceptance=true',
    '--label', `com.petcare.live-run=${runId}`,
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

  await releaseReservation('pilot');
  await startPilot();
  process.stdout.write('[live] Actual pilot server and built UI are ready.\n');

  const controlSecret = randomBytes(24).toString('base64url');
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
  await releaseReservation('control');
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
