import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { SidecarManager } = require('../apps/electron/main/sidecar/manager.cjs');

const waitForStatus = (manager, expected, timeoutMs = 20000) => new Promise((resolve, reject) => {
  if (manager.getStatus().state === expected) return resolve(manager.getStatus());
  const timer = setTimeout(() => {
    manager.removeListener('status', listener);
    reject(new Error(`Timed out waiting for sidecar status: ${expected}`));
  }, timeoutMs);
  const listener = (status) => {
    if (status.state !== expected) return;
    clearTimeout(timer);
    manager.removeListener('status', listener);
    resolve(status);
  };

  manager.on('status', listener);
});
const requestEcho = (connection) => new Promise((resolve, reject) => {
  const requestId = 'integration-request';
  const socket = new WebSocket(connection.wsUrl, ['agent.v1', connection.token]);
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error('WebSocket echo timed out'));
  }, 5000);
  socket.onopen = () => socket.send(JSON.stringify({
    type: 'diagnostics.echo.request',
    version: '1.0',
    session_id: 'integration-session',
    request_id: requestId,
    timestamp: new Date().toISOString(),
    data: { message: 'ping' }
  }));
  socket.onmessage = (message) => {
    clearTimeout(timer);
    try {
      const event = JSON.parse(String(message.data));
      assert.equal(event.type, 'diagnostics.echo.response');
      assert.equal(event.request_id, requestId);
      assert.deepEqual(event.data, { echo: { message: 'ping' } });
      socket.close();
      resolve(event);
    } catch (error) {
      socket.close();
      reject(error);
    }
  };
  socket.onerror = () => {
    clearTimeout(timer);
    reject(new Error('WebSocket echo connection failed'));
  };
});

test('sidecar starts, authenticates, restarts once and stops cleanly', async () => {
  const manager = new SidecarManager({ rootDir: process.cwd(), healthTimeoutMs: 20000 });
  try {
    const first = await manager.start();
    const response = await fetch(`${first.httpUrl}/version`, {
      headers: { Authorization: `Bearer ${first.token}` }
    });
    assert.equal(response.status, 200);
    await requestEcho(first);

    assert.equal((await response.json()).protocol_version, '1.0');

    manager.child.kill();
    await waitForStatus(manager, 'restarting');
    await waitForStatus(manager, 'ready');
    const second = manager.getConnection();
    assert.ok(second.port > 0);
    assert.notEqual(second.token, first.token);
  } finally {
    await manager.stop();
  }
  assert.equal(manager.getStatus().state, 'stopped');
});
