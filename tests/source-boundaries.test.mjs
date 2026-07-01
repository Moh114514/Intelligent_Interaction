import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('App consumes conversation, speech and avatar feature boundaries', async () => {
  const source = await read('App.tsx');
  for (const feature of ['features/conversation', 'features/speech', 'features/avatar']) {
    assert.match(source, new RegExp(feature));
  }
  assert.doesNotMatch(source, /components\/(?:ChatBubble|CatAvatar)/);
  assert.doesNotMatch(source, /services\/(?:speechRecognition|audioUtils)/);
  assert.ok(
    source.indexOf('setIsStarted(true)') < source.indexOf("audioContextRef.current?.state === 'suspended'"),
    'conversation UI must start before optional audio initialization'
  );
});

test('production Vite config substitutes the credential-free example', async () => {
  const source = await read('vite.config.ts');
  assert.match(source, /isProduction/);
  assert.match(source, /api\.config\.example\.ts/);
  assert.match(source, /isProduction \? '' : env\.GEMINI_API_KEY/);
});

test('Electron preload exposes only the approved capability surface', async () => {
  const preload = await read('apps/electron/preload/index.cjs');
  const names = Array.from(preload.matchAll(/^\s{2}([a-zA-Z]+):/gm), (match) => match[1]).sort();
  assert.deepEqual(names, [
    'getAppVersion',
    'getBackendConnection',
    'onBackendStatus',
    'openFileDialog',
    'showNotification'
  ]);
  const main = await read('electron.cjs');
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
});
