import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readOptional = (path) => readFile(resolve(root, path), 'utf8').catch(() => '');
const assetsDir = resolve(root, 'dist/assets');
const assetNames = await readdir(assetsDir).catch(() => []);
const bundle = (await Promise.all(
  assetNames.filter((name) => name.endsWith('.js')).map((name) => readFile(resolve(assetsDir, name), 'utf8'))
)).join('\n');

if (!bundle) {
  console.error('No production JavaScript bundle found. Run the build first.');
  process.exit(1);
}

const patterns = [
  ['Google API key', /AIza[0-9A-Za-z_-]{20,}/],
  ['OpenAI-compatible key', /sk-[0-9A-Za-z_-]{16,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/]
];

let failed = false;
for (const [label, pattern] of patterns) {
  if (pattern.test(bundle)) {
    console.error(`Production bundle contains a ${label} pattern.`);
    failed = true;
  }
}

const localConfig = await readOptional('api.config.ts');
const envLocal = await readOptional('.env.local');
const candidates = [
  ...Array.from(localConfig.matchAll(/^\s*(?:apiKey|apiSecret|appId)\s*:\s*['"]([^'"]{8,})['"]/gm), (match) => match[1]),
  ...envLocal.split(/\r?\n/).map((line) => line.split('=', 2)[1]?.trim().replace(/^['"]|['"]$/g, '')).filter((value) => value?.length >= 8)
];

if (candidates.some((value) => bundle.includes(value))) {
  console.error('Production bundle contains a value from a local credential file.');
  failed = true;
}

if (failed) process.exit(1);
console.log(`Secret scan passed (${assetNames.filter((name) => name.endsWith('.js')).length} JavaScript bundle).`);
