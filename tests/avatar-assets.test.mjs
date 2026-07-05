import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAvatar } from '../scripts/validate-avatar-assets.mjs';

test('Vanguard GLB is self-contained, animated, root-locked, and within budget', async () => {
  const summary = await validateAvatar();
  assert.ok(summary.meshes > 0);
  assert.ok(summary.animations > 0);
  assert.ok(summary.size <= 20 * 1024 * 1024);
});