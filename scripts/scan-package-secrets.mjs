import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackage } from '@electron/asar';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const resources = resolve(root, 'release/win-unpacked/resources');
const sidecar = resolve(resources, 'backend-sidecar');
const forbiddenNames = new Set(['.env', '.env.local', 'backend.env']);
const forbiddenExtensions = new Set(['.py', '.pyc', '.pyo', '.db', '.sqlite', '.sqlite3']);
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
const sidecarExe = resolve(sidecar, 'agent-backend.exe');
const pythonDll = resolve(sidecar, '_internal/python312.dll');
for (const required of [sidecarExe, pythonDll, resolve(resources, 'app.asar')]) {
  if (!(await stat(required).catch(() => null))?.isFile()) throw new Error('Required packaged resource is missing: ' + required);
}
const files = await walk(resources);
let sidecarBytes = 0;
let failed = false;
for (const path of files) {
  const relative = path.slice(resources.length + 1).replaceAll('\\', '/');
  const name = basename(path).toLowerCase();
  if (relative.startsWith('backend-sidecar/')) sidecarBytes += (await stat(path)).size;
  if (forbiddenNames.has(name) || forbiddenExtensions.has(extname(name)) || relative.includes('/__pycache__/') || relative.includes('/tests/')) {
    console.error('Forbidden packaged file: ' + relative); failed = true; continue;
  }
  const buffer = await readFile(path);
  const text = buffer.toString('latin1');
  if (forbiddenMarkers.some((pattern) => pattern.test(text))) {
    console.error('Forbidden credential or legacy marker in: ' + relative); failed = true;
  }
}
if (sidecarBytes > 300 * 1024 * 1024) { console.error('Sidecar exceeds 300 MiB'); failed = true; }
const asarEntries = listPackage(resolve(resources, 'app.asar')).map((item) => item.replaceAll('\\', '/'));
for (const required of ['/dist/index.html', '/dist/models/vanguard-soldier.glb', '/electron.cjs', '/apps/electron/main/sidecar/manager.cjs']) {
  if (!asarEntries.includes(required)) { console.error('Required ASAR entry is missing: ' + required); failed = true; }
}
for (const entry of asarEntries) {
  if (entry.startsWith('/backend/') || entry.includes('/backend/tests/') || entry.endsWith('.py')) {
    console.error('Python source entered ASAR: ' + entry); failed = true;
  }
}
if (failed) process.exit(1);
console.log(`Packaged resource scan passed (${(sidecarBytes / 1024 / 1024).toFixed(2)} MiB Sidecar).`);