import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { buildManifest } from './src/manifest.ts';

const root = import.meta.dirname;
const outDir = resolve(root, 'dist');

/** Emits dist/manifest.json from src/manifest.ts so the manifest stays type-checked. */
function manifestPlugin(): Plugin {
  return {
    name: 'humancoder-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: JSON.stringify(buildManifest(), null, 2),
      });
    },
  };
}

/**
 * Three build targets share this file, selected with `--mode`:
 *   (default) popup + options pages (React) and the background service worker (ES module)
 *   content   isolated-world content script, bundled as a single IIFE (MV3 content scripts can't be modules)
 *   bridge    MAIN-world script that talks to Monaco / CodeMirror / Ace page APIs, also an IIFE
 * scripts/build.mjs runs all three.
 */
export default defineConfig(({ mode }) => {
  const sourcemap = mode !== 'production' && process.env.HC_SOURCEMAP === '1';

  if (mode === 'content' || mode === 'bridge') {
    const entry = mode === 'content' ? 'src/content/index.ts' : 'src/bridge/index.ts';
    return {
      publicDir: false,
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        outDir,
        emptyOutDir: false,
        sourcemap,
        lib: {
          entry: resolve(root, entry),
          name: mode === 'content' ? 'HumanCoderContent' : 'HumanCoderBridge',
          formats: ['iife'],
          fileName: () => `${mode}.js`,
        },
      },
    };
  }

  return {
    root: resolve(root, 'src'),
    base: '',
    publicDir: resolve(root, 'public'),
    plugins: [react(), manifestPlugin()],
    build: {
      outDir,
      emptyOutDir: false,
      sourcemap,
      modulePreload: false,
      rollupOptions: {
        input: {
          popup: resolve(root, 'src/popup/index.html'),
          options: resolve(root, 'src/options/index.html'),
          background: resolve(root, 'src/background/index.ts'),
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        },
      },
    },
  };
});
