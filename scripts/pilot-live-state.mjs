import { readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RUN_ID = /^[a-f0-9]{16}$/;
const TEMP_NAME = /^petcare-live-[a-zA-Z0-9_-]+$/;

export function acceptanceStatePath(tempDirectory) {
  return path.join(path.resolve(tempDirectory), 'petcare-live-state-v1.json');
}

function positivePid(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${field} pid`);
  return value;
}

function ownedTempRoot(value, tempDirectory) {
  if (typeof value !== 'string') throw new Error('Invalid acceptance temporary path');
  const resolved = path.resolve(value);
  const expectedParent = path.resolve(tempDirectory);
  if (path.dirname(resolved) !== expectedParent || !TEMP_NAME.test(path.basename(resolved))) {
    throw new Error('Acceptance temporary path is outside the owned namespace');
  }
  return resolved;
}

export function validateAcceptanceState(value, tempDirectory) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid acceptance state manifest');
  }
  if (value.version !== 1 || typeof value.runId !== 'string' || !RUN_ID.test(value.runId)) {
    throw new Error('Invalid acceptance state version or run id');
  }
  const expectedContainer = `petcare-live-${value.runId}`;
  if (value.containerName !== expectedContainer) {
    throw new Error('Acceptance container name is outside the owned namespace');
  }
  return {
    version: 1,
    runId: value.runId,
    runnerPid: positivePid(value.runnerPid, 'runner'),
    apiPid: value.apiPid === null ? null : positivePid(value.apiPid, 'API'),
    containerName: expectedContainer,
    tempRoot: ownedTempRoot(value.tempRoot, tempDirectory),
  };
}

function validatedStateWrite(statePath, state, tempDirectory) {
  const validated = validateAcceptanceState(state, tempDirectory);
  const resolvedState = path.resolve(statePath);
  if (resolvedState !== acceptanceStatePath(tempDirectory)) {
    throw new Error('Refusing to write an unexpected acceptance state path');
  }
  return { resolvedState, serialized: `${JSON.stringify(validated)}\n` };
}

export async function acquireAcceptanceState(statePath, state, tempDirectory) {
  const { resolvedState, serialized } = validatedStateWrite(statePath, state, tempDirectory);
  await writeFile(resolvedState, serialized, { encoding: 'utf8', flag: 'wx' });
}

export async function writeAcceptanceState(statePath, state, tempDirectory) {
  const { resolvedState, serialized } = validatedStateWrite(statePath, state, tempDirectory);
  const pending = `${resolvedState}.${process.pid}.tmp`;
  await writeFile(pending, serialized, { encoding: 'utf8', flag: 'wx' });
  try {
    await rename(pending, resolvedState);
  } catch (error) {
    await unlink(pending).catch(() => undefined);
    throw error;
  }
}

function commandHas(commandLine, fragment) {
  if (typeof commandLine !== 'string') return false;
  const normalizedCommand = commandLine.replaceAll('\\', '/').toLowerCase();
  const normalizedFragment = fragment.replaceAll('\\', '/').toLowerCase();
  return normalizedCommand.includes(normalizedFragment);
}

function matchesApi(commandLine, state, apiEntry) {
  return commandHas(commandLine, apiEntry)
    && commandHas(commandLine, `--pilot-acceptance-run=${state.runId}`);
}

async function readState(statePath, tempDirectory) {
  let text;
  try {
    text = await readFile(statePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Acceptance state manifest is not valid JSON');
  }
  return validateAcceptanceState(parsed, tempDirectory);
}

export async function reclaimStaleRun(options) {
  const state = await readState(options.statePath, options.tempDirectory);
  if (!state) return false;

  if (state.runnerPid !== options.currentPid) {
    const runnerCommand = await options.inspectProcess(state.runnerPid);
    if (runnerCommand && commandHas(runnerCommand, options.runnerEntry)) {
      throw new Error(`Live acceptance is already active with runner pid ${state.runnerPid}`);
    }
  }

  let apiProcess = state.apiPid === null ? null : {
    pid: state.apiPid,
    commandLine: await options.inspectProcess(state.apiPid),
  };
  if (!apiProcess?.commandLine) apiProcess = await options.findApiProcess(state.runId);
  if (apiProcess?.commandLine) {
    if (!matchesApi(apiProcess.commandLine, state, options.apiEntry)) {
      throw new Error(`Refusing to stop API pid ${apiProcess.pid}: process identity mismatch`);
    }
    await options.stopProcess(apiProcess.pid);
  }

  const containerRunId = await options.inspectContainer(state.containerName);
  if (containerRunId !== null) {
    if (containerRunId !== state.runId) {
      throw new Error(`Refusing to remove ${state.containerName}: container identity mismatch`);
    }
    await options.removeContainer(state.containerName);
  }

  await rm(state.tempRoot, { recursive: true, force: true });
  await unlink(options.statePath);
  return true;
}
