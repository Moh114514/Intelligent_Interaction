import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeText, renderContracts } from '../scripts/generate-contracts.mjs';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

test('event envelope keeps all correlation fields required', async () => {
  const schema = await readJson('contracts/events.schema.json');
  assert.deepEqual(schema.required, ['type', 'version', 'session_id', 'request_id', 'timestamp', 'data']);
  assert.equal(schema.additionalProperties, false);
});


test('character contract includes the independent 3D soldier identity', async () => {
  const schema = await readJson('contracts/events.schema.json');
  assert.deepEqual(schema.$defs.characterId.enum, ['BLACK', 'WHITE', 'SOLDIER']);
});
test('agent state contract contains the eight V1 states', async () => {
  const schema = await readJson('contracts/agent-states.json');
  assert.deepEqual(schema.enum, ['idle', 'listening', 'recognizing', 'thinking', 'confirming', 'acting', 'speaking', 'error']);
});

test('generated TypeScript and Python contracts come from the same schemas', async () => {
  const outputs = await renderContracts();
  const ts = outputs.get('generated/contracts.ts');
  const py = outputs.get('backend/app/schemas/contracts.py');
  for (const state of ['idle', 'confirming', 'speaking', 'error']) {
    assert.match(ts, new RegExp(`'${state}'`));
    assert.match(py, new RegExp(`"${state}"`));
  }
});

test('generated contract checks are insensitive to platform line endings', () => {
  assert.equal(normalizeText('first\r\nsecond\r\n'), 'first\nsecond\n');
});

test('audio contract fixes whole-file ASR and one-time TTS metadata', async () => {
  const schema = await readJson('contracts/audio.schema.json');
  assert.equal(schema.$defs.asrResponse.properties.sample_rate.const, 16000);
  assert.deepEqual(schema.$defs.ttsRequest.properties.character_id.$ref, '#/$defs/characterId');
  const outputs = await renderContracts();
  assert.match(outputs.get('generated/contracts.ts'), /interface AsrResponse/);
  assert.match(outputs.get('backend/app/schemas/contracts.py'), /class TtsResponse/);
});
