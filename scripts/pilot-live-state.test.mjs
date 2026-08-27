import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  acceptanceStatePath,
  reclaimStaleRun,
  validateAcceptanceState,
  writeAcceptanceState,
} from './pilot-live-state.mjs';

function stateFor(tempRoot) {
  const runId = '0123456789abcdef';
  return {
    version: 1,
    runId,
    runnerPid: 111,
    apiPid: 222,
    containerName: `petcare-live-${runId}`,
    tempRoot,
  };
}

test('rejects stale state whose names or paths are outside the owned namespace', () => {
  const tempDirectory = path.resolve(os.tmpdir());
  const validRoot = path.join(tempDirectory, 'petcare-live-safe123');
  assert.throws(
    () => validateAcceptanceState({ ...stateFor(validRoot), containerName: 'postgres' }, tempDirectory),
    /container/i,
  );
  assert.throws(
    () => validateAcceptanceState(stateFor(path.resolve(tempDirectory, '..', 'outside')), tempDirectory),
    /temporary/i,
  );
  assert.throws(
    () => validateAcceptanceState({ ...stateFor(validRoot), apiPid: -1 }, tempDirectory),
    /pid/i,
  );
});

test('atomically stores only the non-secret stale-run recovery fields', async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'petcare-live-state-test-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const statePath = acceptanceStatePath(sandbox);
  const state = stateFor(path.join(sandbox, 'petcare-live-owned'));
  await writeAcceptanceState(statePath, state, sandbox);
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), state);
  assert.doesNotMatch(await readFile(statePath, 'utf8'), /password|pepper|cookie|invite|token/i);
  await writeAcceptanceState(statePath, { ...state, apiPid: null }, sandbox);
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).apiPid, null);
});

test('reclaims one validated stale run and only its exact resources', async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'petcare-live-state-test-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const tempRoot = path.join(sandbox, 'petcare-live-stale123');
  await mkdir(tempRoot);
  await writeFile(path.join(tempRoot, 'evidence.bin'), 'owned');
  const statePath = acceptanceStatePath(sandbox);
  const state = stateFor(tempRoot);
  await writeAcceptanceState(statePath, state, sandbox);
  const stopped = [];
  const removed = [];

  assert.equal(await reclaimStaleRun({
    statePath,
    tempDirectory: sandbox,
    currentPid: 999,
    runnerEntry: 'run-pilot-live-acceptance.mjs',
    apiEntry: 'apps/api/src/server.ts',
    inspectProcess: async (pid) => pid === 222
      ? 'node apps/api/src/server.ts --pilot-acceptance-run=0123456789abcdef'
      : null,
    findApiProcess: async () => null,
    stopProcess: async (pid) => { stopped.push(pid); },
    inspectContainer: async () => '0123456789abcdef',
    removeContainer: async (name) => { removed.push(name); },
  }), true);
  assert.deepEqual(stopped, [222]);
  assert.deepEqual(removed, ['petcare-live-0123456789abcdef']);
  await assert.rejects(readFile(tempRoot), /ENOENT/);
  await assert.rejects(readFile(statePath), /ENOENT/);
});

test('fails closed before deletion when a live resource identity does not match', async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'petcare-live-state-test-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const tempRoot = path.join(sandbox, 'petcare-live-stale456');
  await mkdir(tempRoot);
  const statePath = acceptanceStatePath(sandbox);
  await writeAcceptanceState(statePath, stateFor(tempRoot), sandbox);
  const stopped = [];

  await assert.rejects(reclaimStaleRun({
    statePath,
    tempDirectory: sandbox,
    currentPid: 999,
    runnerEntry: 'run-pilot-live-acceptance.mjs',
    apiEntry: 'apps/api/src/server.ts',
    inspectProcess: async (pid) => pid === 222 ? 'node unrelated.js' : null,
    findApiProcess: async () => null,
    stopProcess: async (pid) => { stopped.push(pid); },
    inspectContainer: async () => '0123456789abcdef',
    removeContainer: async () => assert.fail('must not remove a container'),
  }), /identity/i);
  assert.deepEqual(stopped, []);
  assert.equal((await readFile(statePath, 'utf8')).length > 0, true);
});
