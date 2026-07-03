import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = new Map([
  ['dist', resolve(root, 'dist')],
  ['release', resolve(root, 'release')]
]);
const name = process.argv[2];
const target = allowed.get(name);

if (!target || dirname(target) !== root) {
  throw new Error('Refusing to clean an unapproved build directory');
}

await rm(target, { recursive: true, force: true });
console.log(`Cleaned ${name}`);