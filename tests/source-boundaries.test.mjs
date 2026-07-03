import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('App consumes feature boundaries and the Python Agent client', async () => {
  const source = await read('App.tsx');
  for (const feature of ['features/conversation', 'features/speech', 'features/avatar']) {
    assert.match(source, new RegExp(feature));
  }
  assert.match(source, /services\/agentClient/);
  assert.doesNotMatch(source, /components\/(?:ChatBubble|CatAvatar)/);
  assert.doesNotMatch(source, /services\/(?:speechRecognition|audioUtils)/);
  assert.match(source, /Speech synthesis failed; keeping the text response/);
  assert.match(await read('config.ts'), /credentials\.appId\.startsWith\('YOUR_'\)/);
  assert.ok(
    source.indexOf('setIsStarted(true)') < source.indexOf("audioContextRef.current?.state === 'suspended'"),
    'conversation UI must start before optional audio initialization'
  );
});

test('production Vite config substitutes the credential-free speech example', async () => {
  const source = await read('vite.config.ts');
  assert.match(source, /isProduction/);
  assert.match(source, /api\.config\.example\.ts/);
  assert.doesNotMatch(source, /loadEnv|process\.env|define:/);
});

test('removed model integration cannot re-enter the Renderer boundary', async () => {
  const forbidden = new RegExp(['ge' + 'mini', '@google/' + 'genai', 'ai' + 'studio', 'GE' + 'MINI_' + 'API_KEY', 'LiveSession' + 'Manager'].join('|'), 'i');
  const paths = [
    'App.tsx',
    'vite.config.ts',
    'constants.ts',
    'index.html',
    'config.ts',
    'package.json'
  ];
  for (const path of paths) assert.doesNotMatch(await read(path), forbidden, path);
  await assert.rejects(access(new URL('../services/' + 'ge' + 'miniService.ts', import.meta.url)));
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
  assert.match(main, /did-finish-load/);
});