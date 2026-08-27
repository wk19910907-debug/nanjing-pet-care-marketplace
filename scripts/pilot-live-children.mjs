import { spawn as nodeSpawn } from 'node:child_process';

const exited = (child) => child.exitCode !== null || child.signalCode !== null;

function waitForExit(child, timeoutMs) {
  if (exited(child)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error(`Owned child ${child.pid ?? 'unknown'} did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve();
    };
    child.once('exit', onExit);
  });
}

export function createOwnedChildRegistry(spawnImpl = nodeSpawn) {
  const children = new Set();

  const spawn = (command, args, options) => {
    const child = spawnImpl(command, args, options);
    children.add(child);
    const release = () => children.delete(child);
    child.once('exit', release);
    child.once('error', release);
    return child;
  };

  const stop = async (child) => {
    if (!child || exited(child)) {
      if (child) children.delete(child);
      return;
    }
    child.kill('SIGTERM');
    await waitForExit(child, 5_000).catch(() => undefined);
    if (!exited(child)) {
      child.kill('SIGKILL');
      await waitForExit(child, 5_000);
    }
    children.delete(child);
  };

  const stopAll = async () => {
    const results = await Promise.allSettled([...children].map(stop));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(failures.map((result) => result.reason), 'Failed to stop owned child processes');
    }
  };

  return {
    spawn,
    stop,
    stopAll,
    get size() { return children.size; },
  };
}
