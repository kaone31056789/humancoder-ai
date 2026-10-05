// Background-tab test: switches to another tab and checks typing keeps full speed while Chrome throttles the page.
// Playwright fakes page visibility, so this spawns Chromium itself (a window opens briefly) and drives only the
// extension's service worker over the DevTools protocol.
//   npm i -D playwright && npx playwright install chromium   (Playwright is used only to locate Chromium)
//   npm run build && npm run test:e2e:background
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXT = mkdtempSync(join(tmpdir(), 'hc-ext-'));
rmSync(EXT, { recursive: true, force: true });
cpSync(join(PROJECT, 'dist'), EXT, { recursive: true });
const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('http://localhost/*');
writeFileSync(join(EXT, 'manifest.json'), JSON.stringify(manifest));

const server = spawn(process.execPath, [join(PROJECT, 'scripts/serve-test.mjs')], { stdio: 'ignore' });
const browser = spawn(chromium.executablePath(), [
  '--remote-debugging-port=9333',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'hc-prof-'))}`,
  `--disable-extensions-except=${EXT}`,
  `--load-extension=${EXT}`,
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  '--no-first-run',
  '--no-default-browser-check',
  'http://localhost:5174/test-page.html',
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function isOurs(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const v = await new Promise((r) => {
    ws.onmessage = (e) => r(JSON.parse(e.data).result?.result?.value);
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'chrome.runtime.getManifest().name', returnByValue: true } }));
  });
  ws.close();
  return v === 'HumanCoder AI';
}

try {
  let sw;
  for (let i = 0; i < 40 && !sw; i++) {
    await sleep(500);
    const targets = await fetch('http://127.0.0.1:9333/json').then((r) => r.json()).catch(() => []);
    const opt = targets.find((t) => t.type === 'page' && t.url.includes('/options/index.html'));
    if (opt) sw = targets.find((t) => t.type === 'service_worker' && t.url.startsWith(opt.url.split('/options')[0]));
  }
  if (!sw) throw new Error('service worker not found');
  const ws = new WebSocket(sw.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) pending.get(m.id)(m);
  };
  const evaluate = (fnSource, arg) =>
    new Promise((resolve, reject) => {
      const myId = ++id;
      pending.set(myId, (m) => {
        if (m.result?.exceptionDetails) reject(new Error(JSON.stringify(m.result.exceptionDetails)));
        else resolve(m.result?.result?.value);
      });
      ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate', params: { expression: `(${fnSource})(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true } }));
    });

  await sleep(1500);
  const result = await evaluate(
    async function run({ n }) {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function isOurs(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const v = await new Promise((r) => {
    ws.onmessage = (e) => r(JSON.parse(e.data).result?.result?.value);
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'chrome.runtime.getManifest().name', returnByValue: true } }));
  });
  ws.close();
  return v === 'HumanCoder AI';
}
      const [tab] = await chrome.tabs.query({ url: 'http://localhost:5174/*' });
      const inPage = async (func, args = []) => (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }))[0].result;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bridge.js'], world: 'MAIN' });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await inPage(() => { const t = document.getElementById('plain'); t.value = ''; t.focus(); });

      // Switch to another tab in the same window, like the user would.
      const other = await chrome.tabs.create({ windowId: tab.windowId, url: 'about:blank', active: true });
      await sleep(800);
      const visibility = await inPage(() => document.visibilityState);
      const pageTimerTicks = await inPage(
        () => new Promise((done) => { let k = 0; const t0 = Date.now(); const tick = () => (Date.now() - t0 < 2000 ? (k++, setTimeout(tick, 10)) : done(k)); tick(); }),
      );

      const typing = { mode: 'steady', wpm: 300, thinkingPauses: false, adaptive: true };
      const request = { mode: 'type', code: 'y'.repeat(n), task: '', language: 'cpp', model: 'x', typing, maxIterations: 1, visionEnabled: false, includePageContext: false, debug: false };
      const t0 = Date.now();
      await chrome.tabs.sendMessage(tab.id, { type: 'HC_RUN', request });
      let len = 0;
      while (Date.now() - t0 < 120000) {
        await sleep(500);
        len = await inPage(() => document.getElementById('plain').value.length);
        if (len >= n) break;
      }
      const elapsedMs = Date.now() - t0;
      const visibilityAfter = await inPage(() => document.visibilityState);
      await chrome.tabs.remove(other.id);
      return { visibility, visibilityAfter, pageTimerTicks, typed: len, elapsedMs };
    }.toString(),
    { n: 150 },
  );
  console.log(JSON.stringify(result, null, 2));
  const ok = result.visibility === 'hidden' && result.pageTimerTicks < 20 && result.typed === 150 && result.elapsedMs < 15000;
  console.log(ok ? 'PASS  typing ran at full speed in a genuinely hidden, throttled tab' : 'FAIL');
  process.exitCode = ok ? 0 : 1;
  ws.close();
} finally {
  browser.kill();
  server.kill();
}
