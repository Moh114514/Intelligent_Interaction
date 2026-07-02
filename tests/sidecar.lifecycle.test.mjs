import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { SidecarManager } = require('../apps/electron/main/sidecar/manager.cjs');

const createFailedChild = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => {
    if (child.exitCode !== null) return false;
    child.killed = true;
    child.exitCode = 1;
    queueMicrotask(() => child.emit('exit', 1, null));
    return true;
  };
  queueMicrotask(() => {
    const error = new Error('Python executable was not found');
    error.code = 'ENOENT';
    child.emit('error', error);
  });
  return child;
};

test('spawn errors are retried once and reported without uncaught events', async () => {
  let spawnCount = 0;
  const manager = new SidecarManager({
    allocatePortImpl: async () => 51000 + spawnCount,
    spawnImpl: () => {
      spawnCount += 1;
      return createFailedChild();
    },
    healthIntervalMs: 5,
    healthTimeoutMs: 100
  });

  await assert.rejects(manager.start(), /Python executable was not found/);
  assert.equal(spawnCount, 2);
  assert.equal(manager.getStatus().state, 'failed');
  await manager.stop();
});

test('stop cancels a launch before it can spawn a process', async () => {
  let resolvePort;
  let spawnCount = 0;
  const pendingPort = new Promise((resolve) => { resolvePort = resolve; });
  const manager = new SidecarManager({
    allocatePortImpl: () => pendingPort,
    spawnImpl: () => {
      spawnCount += 1;
      return createFailedChild();
    }
  });

  const startPromise = manager.start();
  const cancelled = assert.rejects(startPromise, (error) => error.code === 'SIDECAR_CANCELLED');
  await manager.stop();
  resolvePort(52000);
  await cancelled;
  assert.equal(spawnCount, 0);
  assert.equal(manager.getStatus().state, 'stopped');
});

test('stop cancels a launch while the spawned process is becoming healthy', async () => {
  let child;
  const manager = new SidecarManager({
    allocatePortImpl: async () => 53000,
    spawnImpl: () => {
      child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.exitCode = null;
      child.killed = false;
      child.kill = () => {
        child.killed = true;
        child.exitCode = 0;
        queueMicrotask(() => child.emit('exit', 0, null));
        return true;
      };
      return child;
    },
    healthIntervalMs: 5,
    healthTimeoutMs: 1000
  });

  const startPromise = manager.start();
  while (!child) await new Promise((resolve) => setTimeout(resolve, 1));
  await manager.stop();
  await assert.rejects(startPromise, (error) => error.code === 'SIDECAR_CANCELLED');
  assert.equal(child.killed, true);
  assert.equal(manager.getStatus().state, 'stopped');
});
