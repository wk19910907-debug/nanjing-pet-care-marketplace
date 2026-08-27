import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnedChildRegistry } from './pilot-live-children.mjs';

test('terminates and awaits every exact child spawned through the registry', async () => {
  const registry = createOwnedChildRegistry();
  const first = registry.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const second = registry.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  assert.equal(registry.size, 2);

  await registry.stopAll();
  await registry.stopAll();

  assert.equal(registry.size, 0);
  assert.equal(first.exitCode !== null || first.signalCode !== null, true);
  assert.equal(second.exitCode !== null || second.signalCode !== null, true);
});
