# HumanCoder AI

A Chrome extension (Manifest V3) that edits code in web-based editors. The AI (any model on
[OpenRouter](https://openrouter.ai)) is the **brain**: it reads the editor and returns a short list of
validated, structured actions. The extension is the **hands**: a typing engine carries those actions out
keystroke by keystroke, then reads the editor again to verify the result and correct mistakes.

It is a personal automation project. It does not include features for evading AI detectors, plagiarism
checks or academic-integrity systems, and shouldn't be used for that.

```
 popup / options (React)            background service worker              page (top frame)
 ───────────────────────            ─────────────────────────              ─────────────────────────────
 code input, task, settings  ──▶   holds API key, OpenRouterClient   ◀──▶  content script (isolated world)
 status + action log  ◀── storage.session ──  session state                 ├─ Agent loop  (observe→plan→act)
                                    injects scripts (activeTab)              ├─ HumanTypingEngine
                                    screenshots for Vision Mode              ├─ EditorAdapters
                                                                             └─ HUD (pause / stop)
                                                                                     │ postMessage
                                                                           bridge (MAIN world): Monaco,
                                                                           CodeMirror 5/6, Ace page APIs
```

## Features

- **Two modes**
  - **Type code**: paste code in the popup and it is typed into the focused editor. No API key is needed.
  - **Agent task**: describe a task (e.g. "complete `solve()`", "fix the compile error"). The agent runs
    *observe → plan → act → observe again → correct* until the task is done, up to a maximum number of iterations.
- **Structured actions only**: `type`, `key`, `move`, `select`, `find`, `replace`, `delete`, `wait`, `inspect`.
  Every model reply is validated against a strict [zod](https://zod.dev) schema with size limits before
  anything runs. No action can run JavaScript, call browser APIs or navigate.
- **Typing engine**:
  - **Natural mode** varies timing by word familiarity, slows after punctuation and newlines, and can add occasional thinking pauses.
  - **Steady mode** types at a fixed rate. **Fast mode** has no delays.
  - Adaptive timing compensates for slow editors.
  - You can pause, resume, stop and change speed while it runs.
  - After each typed chunk the whole document is checked against the expected text.
- **Editors**: Monaco, CodeMirror 6, CodeMirror 5, Ace, `<textarea>` and `contenteditable`. Edits go through each
  editor's own API, so nothing gets auto-indented or auto-closed and the result is exactly what was planned.
- **Reading the page**: code, caret and selection, language, visible error and console output near the
  editor, and a short problem description (the problem text can be turned off).
- **Vision Mode** (optional): when the DOM isn't enough, the agent can ask for a screenshot inspection. Only the
  editor and error region is captured, and only when the agent explicitly asks for an inspection.
- **Controls everywhere**: the popup, an in-page HUD, and the shortcuts `Alt+Shift+P` (pause/resume) and `Alt+Shift+X` (stop).

## Setup

Requires Node 20+ and Chrome 116+.

```bash
npm install
npm run build        # type-check + build into dist/
npm run dev          # rebuild on change (reload the extension in chrome://extensions after each build)
npm test             # unit tests (vitest)
```

### Load the extension in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder.
4. Pin **HumanCoder AI** to the toolbar. The Settings page opens automatically the first time.

After rebuilding, click the ↻ reload icon on the extension card.

### Add your OpenRouter key

1. Create a key at <https://openrouter.ai/keys> and add a few credits.
2. Open the extension's **Settings** (the ⚙ button in the popup, or right-click the icon and choose *Options*).
3. Paste the key, click **Test**, then **Save**.

The key is kept in `chrome.storage.local` and is only ever sent to `openrouter.ai`, from the background worker.
It is never given to web pages or content scripts, and it is redacted from all logs.

### Choose models

The default coding model is `qwen/qwen-2.5-coder-32b-instruct` (cheap) and the default vision model is
`google/gemini-2.5-flash`. Model IDs change over time, so both are just defaults in
[`src/shared/config.ts`](src/shared/config.ts). In Settings you can type any OpenRouter ID, or click **Refresh list**
to load the current catalogue (with prices and context sizes).

## Using it

Click into the code editor on the page, open the popup, pick one of the four tabs, and press its big button.

| Tab | What it does | Needs a key |
| --- | --- | --- |
| **⌨ Type** | Types the code you paste into the editor, keystroke by keystroke. | no |
| **✦ AI Task** | You describe a change (e.g. "complete `solve()`"). The AI edits the editor in small steps and checks its work. | yes |
| **✓ Review** | Finds problems in the pasted code, or in the editor's code if nothing is pasted. Tick findings, then **Fix in editor** (the AI edits the page) or **Fix pasted code** (the corrected code goes to the Type tab). | yes |
| **¶ Explain** | Pick a type (**Algorithm**, Observation, Approach, Step-by-step, Complexity, Edge cases) and optionally a line range. Then write it into a **text box on the page** or as **comments in the code** (`//`, `#`, `--`…, placed above the lines they explain; code itself unchanged). | yes |

- **Fixed formats.** Every explanation type follows a fixed template. For example, Algorithm is always
  `Algorithm / Idea / Steps / Why it works / Complexity`, and Complexity is always `Time / Space`. Results are consistent
  and ready to paste. The templates are in [`src/ai/prompts.ts`](src/ai/prompts.ts) (`EXPLANATION_FORMATS`).
- **Models.** Explain uses its own model, **Gemini 2.5 Flash** by default; `google/gemini-2.5-pro` gives deeper
  algorithm write-ups. AI Task and Review use the coding model. Change either in Settings or the popup's **Options** strip.
- **Run card.** While something runs, a card at the top shows the status and Pause/Stop.
  The in-page panel and `Alt+Shift+P` / `Alt+Shift+X` work too.
- **Background tabs.** You can switch tabs while it types, and it keeps its normal speed (see Known limitations).
- **Activity.** The **Activity** strip at the bottom holds the step-by-step log. It opens by itself when something fails.
## Testing

### Unit tests: `npm test`

| Area | File |
| --- | --- |
| Action schema, key normalisation, limits, malformed/malicious replies | `tests/schemas.test.ts` |
| OpenRouter client: 401/402/404/429/5xx, retries, timeouts, JSON-mode fallback, repair round, key redaction | `tests/openrouter.test.ts` |
| Timing model (fast/steady/natural, pauses, determinism), tokenizer | `tests/timing.test.ts` |
| Agent loop: finish, failed actions, iteration limit, done-verification, stop, AI errors | `tests/agent.test.ts` |
| Textarea typing, Enter/Tab/Backspace/Delete/arrows, pause/resume/stop, live speed change, divergence detection, editor detection, contenteditable offset model | `tests/editor.test.ts` (jsdom) |

### Local test pages

```bash
npm run serve:test   # http://localhost:5174/
```

- `test-page.html` (works offline): a plain textarea, a contenteditable editor, and a **simulated code editor**
  with a live "compiler" that shows errors under it. It also has a problem statement and an input-event log.
  - Try **Type code** in each editor.
  - Click **Load buggy sample** and run the agent with the task *"Fix the compile errors"*.
- `editors.html` (needs internet): real **Monaco, CodeMirror 5, CodeMirror 6 and Ace** loaded from CDNs, for testing each adapter.

Use `http://localhost` rather than `file://`. For `file://` pages you would also need to enable
*Allow access to file URLs* on the extension card.

### End-to-end test (optional)

This loads `dist/` into a real Chromium with Playwright and drives the whole extension against both test pages.
OpenRouter is mocked inside the service worker, so no key or credits are needed.

```bash
npm i -D playwright && npx playwright install chromium
npm run build && npm run test:e2e
npm run test:e2e:background   # real hidden-tab check (briefly opens a Chromium window)
```

It checks: editor detection, exact natural/fast typing into the textarea and contenteditable, pause/resume/stop,
a full agent fix cycle (act → inspect → done) with the prompt contents checked, rejection of schema-violating
model output, the 401 error message, the API key never appearing in logs, and exact typing into
Monaco, CodeMirror 5, CodeMirror 6 and Ace.

## Project layout

```
src/
  manifest.ts               → dist/manifest.json
  background/               service worker: messaging, OpenRouter calls, injection, session state, screenshots
  ai/
    OpenRouterClient.ts     AIProvider over OpenRouter (retries, timeouts, JSON repair, error mapping)
    Agent.ts                observe → plan → act → re-observe → correct loop
    schemas.ts              strict action/response schemas + parsing
    prompts.ts              agent / analysis / vision system prompts
  content/
    index.ts, runner.ts     session runner (type mode / agent mode), focus guard, action execution
    editor/                 EditorAdapter + Generic (textarea), ContentEditable, Monaco, CodeMirror, Ace, registry
    typing/                 HumanTypingEngine + pure timing model
    pageContext.ts          error / problem-text extraction, vision crop rectangle
    overlay.ts              in-page HUD
  bridge/                   MAIN-world script that drives editor APIs (fixed operations only)
  popup/, options/          React UI
  shared/                   types, config/limits, storage, messages, text utilities
test/                       local test pages
tests/                      unit tests + e2e harness
```

### Adding an editor adapter

1. If the editor exposes a page-world API, add a driver to [`src/bridge/drivers.ts`](src/bridge/drivers.ts)
   (`getState`, `setSelection`, `insert`, `focus`). Then add a small `BridgeAdapter` subclass with its CSS selector,
   like [`AceAdapter.ts`](src/content/editor/AceAdapter.ts).
2. For DOM-only editors, extend [`BaseAdapter`](src/content/editor/BaseAdapter.ts) and implement four primitives:
   `readState`, `writeSelection`, `insert` and `removeSelection`. Key presses, selection and cursor math come for free.
3. Register it in [`registry.ts`](src/content/editor/registry.ts).

## Privacy

- Code and prompts are sent only to OpenRouter, and only when you press an AI button. There's no analytics or tracking.
- Requests carry no app-identifying headers (no `HTTP-Referer` / `X-Title`).
- **Settings → Privacy → "Don't store my data"** sends `provider.data_collection = "deny"`, so OpenRouter only routes to
  providers that don't retain or train on prompts. It's off by default because some models have no such provider;
  when that happens you get a clear error.
- **Clear saved data** forgets drafts, review/explain results, the activity log and the model cache, and keeps settings and the key.
- Scripts are injected only into the tab you act on (`activeTab`). Pages you don't use HumanCoder on never see it.

## Security model

- Model output is untrusted. It is parsed and validated against strict schemas in the background, and validated
  again in the content script before running. Unknown action types, unknown fields, bad key names, oversized text,
  out-of-range waits/repeats/deletes, reversed selections, and batches over the action or character limits are all rejected.
  On a rejection, the model gets one chance to repair its reply.
- No model-supplied string is ever evaluated. The bridge only dispatches on a fixed list of operation names.
- Page text (problem statements, error output) is labelled as untrusted data in the prompt.
- Permissions are minimal: `activeTab`, `scripting` and `storage`, plus host access to `openrouter.ai` only.
  Scripts are injected only into the tab you opened the popup on.
- Hard limits are in `LIMITS` in [`src/shared/config.ts`](src/shared/config.ts). The iteration cap is 1–20 (default 6).

## Known limitations

- **Iframes**: only the top frame is scripted. Editors embedded in an iframe aren't detected.
- **Monaco without `window.monaco`**: some sites bundle Monaco privately. The extension then reports
  *"Monaco editor found, but this page does not expose its API"* rather than guessing.
- **Access is per tab and per page load** (`activeTab`): after the page navigates or reloads, open the popup again.
  A navigation in the middle of a session aborts it, and the popup says so.
- **No trusted keyboard events**: edits arrive through editor APIs and `execCommand` input events, not real keystrokes.
  Features that only react to physical keys (autocomplete accept, custom keybindings) won't fire. This is
  deliberate, for deterministic results.
- **Rich contenteditable editors** (ProseMirror, Lexical, etc.): offsets are approximate and post-typing
  verification is skipped there. Prefer the `find` action.
- **Background tabs**: Chrome throttles page timers in hidden tabs. While the tab is hidden, keystroke timing is driven by the
  extension's service worker, so typing keeps its normal speed. Stop takes effect within about 250 ms there instead of 25 ms.
  Chrome's Memory/Energy Saver can still *freeze or discard* a tab left in the background for a long time;
  exclude the site in chrome://settings/performance if that happens.
- **Error detection is heuristic**: it relies on class names like `error`, `console` and `output`, so some sites' output panels are missed.
- **Vision Mode** needs the tab to be visible and is the least-tested path. It isn't covered by the automated e2e test.
- **Model quality matters**: small models sometimes break the schema. The client asks for one repair, then
  reports the error. Larger coding models are much more reliable at multi-step edits.
- **Storage**: the API key is stored unencrypted in the extension's local storage, which is normal for extensions.
  Remove it in Settings when you're done.
- **Long model calls**: the service worker is kept alive during calls, but a request is capped by the timeout setting (default 90 s).
