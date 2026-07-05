import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('App consumes feature boundaries and backend Agent/Speech clients', async () => {
  const source = await read('App.tsx');
  for (const feature of ['features/conversation', 'features/speech', 'features/avatar']) assert.match(source, new RegExp(feature));
  assert.match(source, /services\/agentClient/);
  assert.match(source, /services\/speechClient/);
  assert.doesNotMatch(source, /components\/(?:ChatBubble|CatAvatar)/);
  assert.doesNotMatch(source, /speechRecognition|xunfeiTts|api\.config|crypto-js/);
  assert.match(source, /语音合成失败，文字回复仍可使用/);
  const recognitionBlock = source.slice(source.indexOf('const stopListening'), source.indexOf('const handleToolDecision'));
  assert.match(recognitionBlock, /setInputText\(result\.text\)/);
  assert.doesNotMatch(recognitionBlock, /generate\(|handleTextSubmit/);
  assert.ok(source.indexOf('setIsStarted(true)') < source.indexOf("audioContextRef.current?.state === 'suspended'"));
  for (const removed of ['services/speechRecognition.ts', 'services/xunfeiTts.ts', 'services/audioUtils.ts', 'config.ts']) {
    await assert.rejects(access(new URL(`../${removed}`, import.meta.url)));
  }
});

test('Vite does not inject Renderer speech credentials', async () => {
  const source = await read('vite.config.ts');
  assert.doesNotMatch(source, /api\.config|loadEnv|process\.env|define:/);
});

test('removed model integration cannot re-enter the Renderer boundary', async () => {
  const forbidden = new RegExp(['ge' + 'mini', '@google/' + 'genai', 'ai' + 'studio', 'GE' + 'MINI_' + 'API_KEY', 'LiveSession' + 'Manager'].join('|'), 'i');
  for (const path of ['App.tsx', 'vite.config.ts', 'constants.ts', 'index.html', 'package.json']) assert.doesNotMatch(await read(path), forbidden, path);
  await assert.rejects(access(new URL('../services/' + 'ge' + 'miniService.ts', import.meta.url)));
});

test('Electron preload exposes only the approved capability surface', async () => {
  const preload = await read('apps/electron/preload/index.cjs');
  const names = Array.from(preload.matchAll(/^\s{2}([a-zA-Z]+):/gm), (match) => match[1]).sort();
  assert.deepEqual(names, ['getAppVersion', 'getBackendConnection', 'onBackendStatus', 'openFileDialog', 'showNotification']);
  const main = await read('electron.cjs');
  assert.match(main, /nodeIntegration:\s*false/); assert.match(main, /contextIsolation:\s*true/); assert.match(main, /sandbox:\s*true/);
});
