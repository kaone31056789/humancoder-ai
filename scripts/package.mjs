// Packages dist/ into release/HumanCoder-AI.zip (a "HumanCoder-AI" folder + INSTALL.txt) for sharing.
//   npm run package
// Uses the system `tar` (bsdtar on Windows 10+ and macOS) to write a standard zip with forward-slash paths.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const out = resolve(root, 'release');
const stage = resolve(out, 'stage');
const folder = resolve(stage, 'HumanCoder-AI');
const zip = resolve(out, 'HumanCoder-AI.zip');

if (!existsSync(resolve(dist, 'manifest.json'))) {
  console.error('dist/ is missing — run `npm run build` first.');
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(folder, { recursive: true });
cpSync(dist, folder, { recursive: true });
cpSync(resolve(root, 'scripts/INSTALL.txt'), resolve(folder, 'INSTALL.txt'));

const res = spawnSync('tar', ['-a', '-c', '-f', zip, 'HumanCoder-AI'], { cwd: stage, stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });
if (res.status !== 0) {
  console.error('tar failed — zip the dist/ folder manually.');
  process.exit(1);
}
console.log(`Created ${zip}`);
