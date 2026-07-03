import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const resources = resolve(root, 'release/win-unpacked/resources');
const forbiddenNames = new Set(['.env', '.env.local', 'backend.env']);
const textExtensions = new Set(['.js', '.json', '.py', '.txt', '.md', '.toml', '.yaml', '.yml']);
const forbiddenMarkers = [
  /AIza[0-9A-Za-z_-]{20,}/,
  /sk-[0-9A-Za-z_-]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  new RegExp('GEM' + 'INI_API_KEY', 'i'),
  /@google[/]genai/i,
  new RegExp('LiveSession' + 'Manager', 'i')
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const files = await walk(resources).catch(() => []);
if (!files.length) {
  console.error('Packaged resources were not found. Run electron:build first.');
  process.exit(1);
}

let failed = false;
for (const path of files) {
  if (forbiddenNames.has(basename(path).toLowerCase())) {
    console.error('Packaged resources contain a forbidden credential file: ' + basename(path));
    failed = true;
    continue;
  }
  if (!textExtensions.has(extname(path).toLowerCase())) continue;
  const content = await readFile(path, 'utf8').catch(() => '');
  if (forbiddenMarkers.some((pattern) => pattern.test(content))) {
    console.error('Packaged resource contains a forbidden credential or legacy integration marker: ' + basename(path));
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('Packaged credential and legacy-integration scan passed.');