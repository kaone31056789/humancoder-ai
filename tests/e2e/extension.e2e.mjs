// End-to-end test: loads dist/ into Playwright Chromium and drives the extension against the test pages,
// with OpenRouter mocked inside the service worker (no API key or credits needed).
//   npm i -D playwright && npx playwright install chromium
//   npm run build && npm run test:e2e
import { chromium } from 'playwright';
import { cpSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXT = mkdtempSync(join(tmpdir(), 'hc-ext-'));
rmSync(EXT, { recursive: true, force: true });
cpSync(join(PROJECT, 'dist'), EXT, { recursive: true });
// Test-only: grant localhost so scripts can be injected without clicking the toolbar button (activeTab).
const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('http://localhost/*');
writeFileSync(join(EXT, 'manifest.json'), JSON.stringify(manifest));

const server = spawn(process.execPath, [join(PROJECT, 'scripts/serve-test.mjs')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const results = [];
const check = (name, cond, info = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && info ? '  → ' + info : ''}`);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'hc-')), {
  channel: 'chromium',
  headless: true,
  // Playwright disables background throttling by default; re-enable it so hidden tabs behave like real Chrome.
  ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  // onInstalled opens the options page; let that settle first.
  await ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null);
  await new Promise((r) => setTimeout(r, 500));

  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [page error]', e.message));
  await page.goto('http://localhost:5174/test-page.html');
  const ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${extId}/popup/index.html`);
  const send = (msg) => ui.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  const tabIdFor = (prefix) => sw.evaluate(async (p) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(p))?.id, prefix);
  const session = () => ui.evaluate(async () => (await chrome.storage.session.get('hc_session')).hc_session);
  const waitDone = async (ms = 60000) => {
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 300));
    while (Date.now() - t0 < ms) {
      const s = await session();
      if (s && !s.running && ['finished', 'stopped', 'error'].includes(s.status)) return s;
      await new Promise((r) => setTimeout(r, 200));
    }
    return await session();
  };
  const typing = (mode, wpm = 300) => ({ mode, wpm, thinkingPauses: false, adaptive: true });
  const start = (tabId, request) => send({ type: 'START', tabId, request: { task: '', language: 'cpp', includePageContext: true, ...request } });

  const tab = await tabIdFor('http://localhost:5174/test-page.html');
  const CODE = '#include <iostream>\nint main() {\n    long long a, b;\n    if (a) {\n\tb++;\n    }\n    return 0;\n}';

  // 1. Detection
  await page.click('#plain');
  let det = await send({ type: 'DETECT', tabId: tab });
  check('detect: focused textarea', det.ok && det.editor?.kind === 'textarea', JSON.stringify(det));

  // 2. Type mode, natural timing, plain textarea
  let r = await start(tab, { mode: 'type', code: CODE, typing: typing('natural', 400) });
  check('start type mode', r.ok, JSON.stringify(r));
  let s = await waitDone();
  const plain = await page.$eval('#plain', (el) => el.value);
  check('textarea: natural typing is exact', plain === CODE && s.status === 'finished', `${s.status} ${s.detail} ${JSON.stringify(plain)}`);
  const inputs = await page.$eval('#events', (el) => el.children.length);
  check('textarea: page received input events', inputs > 20, String(inputs));

  // 3. Contenteditable, fast mode
  await page.click('#ce');
  r = await start(tab, { mode: 'type', code: CODE, typing: typing('fast') });
  s = await waitDone();
  const ce = await page.$eval('#ce', (el) => el.innerText);
  check('contenteditable: fast typing', s.status === 'finished' && ce.replace(/\n$/, '') === CODE, `${s.status} ${s.detail} ${JSON.stringify(ce)}`);

  // 4. Pause / resume / stop
  await page.click('[data-clear="plain"]');
  await page.click('#plain');
  await start(tab, { mode: 'type', code: 'x'.repeat(200), typing: typing('steady', 120) });
  await new Promise((r) => setTimeout(r, 800));
  await send({ type: 'CONTROL', tabId: tab, command: 'pause' });
  await new Promise((r) => setTimeout(r, 300));
  const a1 = (await page.$eval('#plain', (el) => el.value)).length;
  await new Promise((r) => setTimeout(r, 700));
  const a2 = (await page.$eval('#plain', (el) => el.value)).length;
  s = await session();
  check('pause freezes typing', a1 === a2 && a1 > 0 && s.status === 'paused', `${a1} ${a2} ${s.status}`);
  await send({ type: 'CONTROL', tabId: tab, command: 'resume' });
  await new Promise((r) => setTimeout(r, 500));
  const a3 = (await page.$eval('#plain', (el) => el.value)).length;
  check('resume continues typing', a3 > a2, `${a2} -> ${a3}`);
  await send({ type: 'CONTROL', tabId: tab, command: 'stop' });
  s = await waitDone(5000);
  const a4 = (await page.$eval('#plain', (el) => el.value)).length;
  await new Promise((r) => setTimeout(r, 500));
  const a5 = (await page.$eval('#plain', (el) => el.value)).length;
  check('stop ends the session', s.status === 'stopped' && a4 === a5 && a5 < 200, `${s.status} ${a4} ${a5}`);

  // 5. Agent mode with a mocked OpenRouter (fixes the simulated editor's compile errors)
  await sw.evaluate(async () => {
    await chrome.storage.local.set({ hc_settings: { apiKey: 'sk-or-v1-FAKEKEYFORTESTS0000', model: 'mock/coder', maxIterations: 4 } });
    const replies = [
      JSON.stringify({
        thought: 'Two statements are missing semicolons.',
        actions: [
          { type: 'find', text: 'long long a, b' },
          { type: 'key', key: 'END' },
          { type: 'type', text: ';' },
          { type: 'find', text: '<< endl' },
          { type: 'key', key: 'End' },
          { type: 'type', text: ';' },
          { type: 'inspect', reason: 'check the compiler output' },
        ],
        done: false,
      }),
      '```json\n{"thought":"Compiles now.","actions":[],"done":true}\n```',
    ];
    self.__requests = [];
    self.fetch = async (url, init) => {
      self.__requests.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization });
      return new Response(JSON.stringify({ choices: [{ message: { content: replies.shift() }, finish_reason: 'stop' }] }), { status: 200 });
    };
  });
  await page.click('[data-reset="sim"]');
  await page.click('#sim');
  r = await start(tab, { mode: 'agent', task: 'Fix the compile errors', code: '', typing: typing('natural', 400) });
  check('start agent mode', r.ok, JSON.stringify(r));
  s = await waitDone();
  const sim = await page.$eval('#sim', (el) => el.value);
  const simErr = await page.$eval('#sim-errors', (el) => el.textContent);
  check('agent: fixes applied and finished', s.status === 'finished' && sim.includes('long long a, b;') && sim.includes('<< endl;') && !simErr, `${s.status} ${s.detail} err=${simErr}`);
  const reqs = await sw.evaluate(() => self.__requests);
  check('agent: 2 model calls (act → inspect → done)', reqs.length === 2, String(reqs.length));
  const firstPrompt = reqs[0]?.body.messages[1].content ?? '';
  check('agent: prompt carried editor code + visible errors + problem text', /CURRENT CODE/.test(firstPrompt) && /expected ';'/.test(firstPrompt) && /Sum of two integers/i.test(firstPrompt), firstPrompt.slice(0, 1500));
  const secondPrompt = reqs[1]?.body.messages[1].content ?? '';
  check('agent: re-observation shows fixed code, no errors', secondPrompt.includes('long long a, b;') && !/expected ';'/.test(secondPrompt) && /Compiled successfully/.test(secondPrompt), secondPrompt.slice(0, 1200));
  const logs = s.logs.map((l) => l.msg).join('\n');
  check('agent: action log recorded actions', /Action: find/.test(logs) && /Action: END/.test(logs));
  check('agent: API key never appears in logs/session', !JSON.stringify(s).includes('FAKEKEYFORTESTS'));

  // 6. Agent rejects malicious / malformed output
  await sw.evaluate(() => {
    const bad = JSON.stringify({ actions: [{ type: 'eval', code: 'alert(1)' }], done: false });
    const replies = [bad, bad];
    self.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: replies.shift() }, finish_reason: 'stop' }] }), { status: 200 });
  });
  const before = await page.$eval('#sim', (el) => el.value);
  await page.click('#sim');
  await start(tab, { mode: 'agent', task: 'do something', code: '', typing: typing('fast') });
  s = await waitDone();
  check('agent: schema-violating output rejected, nothing executed', s.status === 'error' && /schema/.test(s.detail) && before === (await page.$eval('#sim', (el) => el.value)), `${s.status} ${s.detail}`);

  // 7. OpenRouter error surfaced
  await sw.evaluate(() => {
    self.fetch = async () => new Response(JSON.stringify({ error: { message: 'User not found.' } }), { status: 401 });
  });
  await start(tab, { mode: 'agent', task: 'x', code: '', typing: typing('fast') });
  s = await waitDone();
  check('agent: 401 surfaced as a clear error', s.status === 'error' && /API key/.test(s.detail), s.detail);

  // 7b. Typing keeps going while the tab is in the background
  await page.bringToFront();
  await page.click('[data-clear="plain"]');
  await page.click('#plain');
  const N = 150; // steady 300 wpm = 40 ms/char ≈ 6 s; with throttled page timers it would take minutes
  await start(tab, { mode: 'type', code: 'y'.repeat(N), typing: typing('steady', 300) });
  // Open another tab in the SAME window and activate it, exactly like the user switching tabs.
  const otherId = await sw.evaluate(async (tabId) => {
    const t = await chrome.tabs.get(tabId);
    return (await chrome.tabs.create({ windowId: t.windowId, url: 'about:blank', active: true })).id;
  }, tab);
  await new Promise((r) => setTimeout(r, 400));
  const vis = await page.evaluate(() => document.visibilityState);
  // Diagnostic: how often does an ordinary 10 ms page timer fire while hidden? (~200 if unthrottled)
  const pageTicks = await page.evaluate(
    () => new Promise((done) => { let n = 0; const t0 = Date.now(); const tick = () => (Date.now() - t0 < 2000 ? (n++, setTimeout(tick, 10)) : done(n)); tick(); }),
  );
  const tHidden = Date.now();
  s = await waitDone(90000);
  const hiddenMs = Date.now() - tHidden;
  const typedHidden = (await page.$eval('#plain', (el) => el.value)).length;
  console.log(`  hidden tab: visibility=${vis}, ordinary page timer fired ${pageTicks}× in 2s`);
  if (vis !== 'hidden') console.log('  (Playwright keeps pages visible; the real hidden-tab check is tests/e2e/background-tab.e2e.mjs)');
  else check('background tab: page timers are throttled (proves the scenario is real)', pageTicks < 20, String(pageTicks));
  check('background tab: typing finishes at normal speed', s.status === 'finished' && typedHidden === N && hiddenMs < 15000, ` len=${typedHidden} ${hiddenMs}ms`);
  await sw.evaluate((id) => chrome.tabs.remove(id), otherId);

  // 7c. "Fix pasted code" returns corrected code for the selected findings
  await sw.evaluate(() => {
    self.fetch = async (u, init) => {
      self.__fixBody = JSON.parse(init.body);
      const content = JSON.stringify({ code: '#include <iostream>\nint main() { return 0; }', changes: ['Replaced <bits/stdc++.h> with <iostream>'] });
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
    };
  });
  const fx = await send({ type: 'FIX_CODE', code: '#include <bits/stdc++.h>\nint main() { return 0; }', language: 'cpp', fixes: ['warning (line 1): Avoid <bits/stdc++.h>'] });
  const fixPrompt = await sw.evaluate(() => self.__fixBody.messages[1].content);
  check('fix pasted code: corrected code returned', fx.ok && fx.code.includes('<iostream>') && fx.changes.length === 1, JSON.stringify(fx));
  check('fix pasted code: prompt lists only the selected fixes', /1\. warning \(line 1\)/.test(fixPrompt) && !/2\./.test(fixPrompt.split('CODE:')[0]));

  // 8. Real editor libraries
  const ed = await ctx.newPage();
  ed.on('pageerror', (e) => console.log('  [editors page error]', e.message));
  await ed.goto('http://localhost:5174/editors.html');
  const loaded = await ed
    .waitForFunction(() => [...document.querySelectorAll('.state')].every((s) => s.textContent !== 'loading…'), null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  const states = await ed.$$eval('.state', (els) => els.map((e) => `${e.id}=${e.textContent}`));
  console.log('  editor libraries:', states.join(', '), loaded ? '' : '(timeout)');
  const etab = await tabIdFor('http://localhost:5174/editors.html');
  const SNIP = 'if (a > b) {\n        cout << "(" << a << ")";\n    }\n    ';
  const getters = {
    monaco: () => window.monaco.editor.getEditors()[0].getValue(),
    cm6: () => {
      const n = document.querySelector('#cm6 .cm-content');
      return (n.cmTile?.root?.view ?? n.cmView?.rootView?.view ?? n.cmView?.view).state.doc.toString();
    },
    cm5: () => document.querySelector('#cm5 .CodeMirror').CodeMirror.getValue(),
    ace: () => ace.edit('ace').getValue(),
  };
  const kinds = { monaco: 'monaco', cm6: 'codemirror6', cm5: 'codemirror5', ace: 'ace' };
  const clickTarget = { monaco: '#monaco .view-lines', cm6: '#cm6 .cm-content', cm5: '#cm5 .CodeMirror-code', ace: '#ace .ace_content' };
  for (const id of Object.keys(getters)) {
    if (!(await ed.$eval(`#s-${id}`, (e) => e.textContent === 'ready'))) {
      check(`${id}: library loaded`, false, 'CDN load failed; skipping');
      continue;
    }
    await ed.bringToFront();
    await ed.click(clickTarget[id], { position: { x: 5, y: 5 } });
    det = await send({ type: 'DETECT', tabId: etab });
    check(`${id}: detected`, det.ok && det.editor?.kind === kinds[id], JSON.stringify(det));
    const beforeVal = await ed.evaluate(getters[id]);
    r = await start(etab, { mode: 'type', code: SNIP, typing: typing('natural', 400) });
    s = await waitDone();
    const after = await ed.evaluate(getters[id]);
    const ok = s.status === 'finished' && after.length === beforeVal.length + SNIP.length && after.includes(SNIP);
    check(`${id}: typed exactly (no auto-indent / auto-close)`, ok, `${s.status} ${s.detail} Δ=${after.length - beforeVal.length}`);
  }

  // 9. Explain: generate (mocked), write into the page's explanation box, and as comments in the code editor
  await sw.evaluate(() => {
    self.fetch = async (u, init) => {
      self.__explainBody = JSON.parse(init.body);
      const content = JSON.stringify({
        summary: 'Reads two ints.',
        annotations: [{ fromLine: 5, toLine: 6, text: 'Declares a and b, then reads both from standard input.' }, { fromLine: 50, toLine: 60, text: 'Out of range, gets clamped.' }],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
    };
  });
  const SAMPLE = await ed.evaluate(() => SAMPLE);
  const ex = await send({ type: 'EXPLAIN', code: SAMPLE, language: 'cpp', style: 'Approach', range: { from: 5, to: 6 }, detailed: false });
  const exPrompt = await sw.evaluate(() => self.__explainBody.messages[1].content);
  check('explain: returns annotations clamped to the requested range', ex.ok && ex.explanation.annotations.every((a) => a.fromLine >= 5 && a.toLine <= 6), JSON.stringify(ex));
  check('explain: prompt carries style and range', /Approach/.test(exPrompt) && /ONLY lines 5-6/.test(exPrompt));
  const bad = await send({ type: 'EXPLAIN', code: SAMPLE, language: 'cpp', style: 'Approach', range: { from: 40, to: 41 }, detailed: false });
  check('explain: invalid range rejected', !bad.ok && /Invalid line range/.test(bad.error), JSON.stringify(bad));

  // Page box: focus the site's explanation textarea and type the text there (not into a code editor).
  await ed.bringToFront();
  await ed.click('#ex-text');
  const exText = 'Declares `a` and `b`, then reads both from standard input.';
  const snapshot = async () => Object.fromEntries(await Promise.all(Object.keys(getters).map(async (k) => [k, await ed.evaluate(getters[k])])));
  const editorsBefore = await snapshot();
  await start(etab, { mode: 'type', code: exText, typing: typing('natural', 400) });
  s = await waitDone();
  check(
    'explain → page box: typed into the focused explanation field',
    s.status === 'finished' && (await ed.$eval('#ex-text', (e) => e.value)) === exText && JSON.stringify(await snapshot()) === JSON.stringify(editorsBefore),
    `${s.status} ${s.detail}`,
  );

  // Comments: cursor is still in the text box, but comments must go to a code editor.
  const comments = [{ line: 5, anchor: '    int a, b;', lines: ['// Declares a and b, then reads', '// both from standard input.'] }];
  await start(etab, { mode: 'comments', code: '', comments, typing: typing('fast') });
  s = await waitDone();
  const editorsAfter = await snapshot();
  const block = '    // Declares a and b, then reads\n    // both from standard input.\n';
  const changed = Object.keys(getters).filter((k) => editorsAfter[k] !== editorsBefore[k]);
  const target = changed[0];
  check(
    'explain → comments: exactly one code editor got the comment, above the right line, with matching indent, code untouched',
    s.status === 'finished' && changed.length === 1 && editorsAfter[target].includes(block + '    int a, b;') && editorsAfter[target].replace(block, '') === editorsBefore[target],
    `${s.status} ${s.detail} changed=${changed.join(',')}`,
  );
  check('explain → comments: explanation box not modified', (await ed.$eval('#ex-text', (e) => e.value)) === exText);
} catch (e) {
  console.error('E2E crashed:', e);
  results.push({ name: 'crash', pass: false });
} finally {
  await ctx.close();
  server.kill();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
