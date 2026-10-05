// Builds all three targets defined in vite.config.ts into dist/.
//   node scripts/build.mjs          one-off production build
//   node scripts/build.mjs --watch  rebuild on change (npm run dev)
import { build } from 'vite';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

if (!existsSync(resolve(root, 'public/icons/icon128.png'))) {
  spawnSync(process.execPath, [resolve(root, 'scripts/gen-icons.mjs')], { stdio: 'inherit' });
}

await rm(resolve(root, 'dist'), { recursive: true, force: true });

const targets = ['app', 'content', 'bridge'];
for (const target of targets) {
  await build({
    configFile: resolve(root, 'vite.config.ts'),
    mode: target === 'app' ? (watch ? 'development' : 'production') : target,
    logLevel: 'warn',
    build: watch ? { watch: {}, minify: false } : {},
  });
  console.log(`✓ built ${target}`);
}

if (watch) {
  console.log('\nWatching for changes. Reload the extension in chrome://extensions after each rebuild.');
} else {
  console.log('\nDone. Load the dist/ folder via chrome://extensions → Load unpacked.');
}
