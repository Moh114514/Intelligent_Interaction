import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function inspectAvatar(path = resolve('public/models/vanguard-soldier.glb')) {
  const buffer = await readFile(path);
  if (buffer.toString('ascii', 0, 4) !== 'glTF') throw new Error('Avatar is not a binary glTF file');
  if (buffer.readUInt32LE(4) !== 2) throw new Error('Avatar must use glTF 2.0');
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.toString('ascii', 16, 20);
  if (jsonType !== 'JSON') throw new Error('GLB JSON chunk is missing');
  const document = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).replace(/\0+$/g, '').trim());
  return { buffer, document };
}

export async function validateAvatar(path) {
  const resolved = path ? resolve(path) : resolve('public/models/vanguard-soldier.glb');
  const { buffer, document } = await inspectAvatar(resolved);
  const info = await stat(resolved);
  if (info.size > 20 * 1024 * 1024) throw new Error(`Avatar exceeds 20 MiB: ${info.size}`);
  if (!document.meshes?.length) throw new Error('Avatar has no meshes');
  if (!document.materials?.length) throw new Error('Avatar has no materials');
  if (!document.images?.length) throw new Error('Avatar has no embedded textures');
  if (!document.skins?.length) throw new Error('Avatar has no skin');
  const talking = document.animations?.find((item) => item.name === 'Talking');
  if (!talking) throw new Error('Talking animation is missing');
  for (const channel of talking.channels ?? []) {
    if (channel.target?.path !== 'translation') continue;
    const nodeName = String(document.nodes?.[channel.target.node]?.name ?? '').toLowerCase();
    if (nodeName.includes('hips') || nodeName.includes('root')) throw new Error(`Root translation remains on ${nodeName}`);
  }
  return { size: buffer.length, meshes: document.meshes.length, animations: document.animations.length };
}

if (process.argv[1] && process.argv[1].endsWith('validate-avatar-assets.mjs')) {
  validateAvatar(process.argv[2]).then((summary) => console.log(JSON.stringify(summary))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}