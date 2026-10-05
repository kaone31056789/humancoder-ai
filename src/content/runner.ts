// Owns one session in the page: editor detection, the typing engine, run control, and either
// direct typing ("type" mode) or the observe→plan→act agent loop ("agent" mode).

import { Agent, StopError, type ActionOutcome, type AgentEnvironment } from '../ai/Agent';
import type { AgentAction } from '../ai/schemas';
import { locateAnchor } from '../shared/comments';
import { detectLanguage } from '../shared/language';
import { sendToBackground, type ControlCommand, type Result } from '../shared/messages';
import { lineColToOffset, nthIndexOf } from '../shared/text';
import type { EditorInfo, Observation, RunRequest, SessionStatus, TypingProfile } from '../shared/types';
import { BackgroundAIProvider } from './BackgroundAIProvider';
import type { EditorAdapter } from './editor/EditorAdapter';
import { detectEditor, detectEditors } from './editor/registry';
import { Overlay } from './overlay';
import { extractErrors, extractProblemText, relevantRect } from './pageContext';
import { Reporter } from './reporter';
import { RunControl } from './RunControl';
import { isHidden, pageAwareWait, yieldToEventLoop } from './timer';
import { HumanTypingEngine } from './typing/HumanTypingEngine';

async function editorInfo(adapter: EditorAdapter): Promise<EditorInfo> {
  const code = await adapter.getCode();
  return {
    kind: adapter.kind,
    label: adapter.label,
    language: (await adapter.getLanguage().catch(() => null)) ?? detectLanguage(code),
    lineCount: code.split('\n').length,
  };
}

export class SessionRunner {
  private running = false;
  private control: RunControl | null = null;
  private engine: HumanTypingEngine | null = null;
  private adapter: EditorAdapter | null = null;
  private reporter: Reporter | null = null;
  private lastActiveStatus: SessionStatus = 'typing';
  private readonly overlay = new Overlay({
    onTogglePause: () => this.handleControl('toggle'),
    onStop: () => this.handleControl('stop'),
  });

  isRunning(): boolean {
    return this.running;
  }

  async detect(): Promise<Result<{ editor: EditorInfo | null; reason?: string }>> {
    if (this.running && this.adapter) return { ok: true, editor: await editorInfo(this.adapter) };
    const det = await detectEditor();
    if (!det.adapter) return { ok: true, editor: null, reason: det.reason };
    this.adapter = det.adapter;
    return { ok: true, editor: await editorInfo(det.adapter) };
  }

  async read(preferCode = false): Promise<Result<{ code: string; language: string | null; editor: EditorInfo }>> {
    const det = this.running && this.adapter ? { adapter: this.adapter } : await detectEditor({ preferCode, forWriting: false });
    if (!det.adapter) return { ok: false, error: ('reason' in det && det.reason) || 'No editor found', code: 'no_editor' };
    const editor = await editorInfo(det.adapter);
    return { ok: true, code: await det.adapter.getCode(), language: editor.language, editor };
  }

  start(req: RunRequest): Result {
    if (this.running) return { ok: false, error: 'A session is already running in this tab.', code: 'busy' };
    if (req.mode === 'type' && !req.code.trim()) return { ok: false, error: 'Paste some code to type first.', code: 'empty' };
    if (req.mode === 'comments' && !req.comments?.length) return { ok: false, error: 'There are no comments to add.', code: 'empty' };
    if (req.mode === 'agent' && !req.task.trim() && !req.code.trim()) {
      return { ok: false, error: 'Describe a task (or paste reference code) for the agent.', code: 'empty' };
    }
    this.running = true;
    void this.run(req);
    return { ok: true };
  }

  handleControl(command: ControlCommand, typing?: TypingProfile): Result {
    const c = this.control;
    if (!c || !this.running) return { ok: false, error: 'No session is running.', code: 'idle' };
    switch (command) {
      case 'pause':
        c.pause('Paused by user');
        break;
      case 'resume':
        c.resume();
        break;
      case 'toggle':
        c.toggle();
        break;
      case 'stop':
        c.stop();
        this.reporter?.status('stopped', 'Stopping…');
        break;
      case 'setTyping':
        if (typing) {
          this.engine?.setProfile(typing);
          this.reporter?.log('info', `Typing set to ${typing.mode}, ${typing.wpm} WPM`);
        }
        break;
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------------

  private async run(req: RunRequest): Promise<void> {
    const reporter = new Reporter(req.debug);
    const control = new RunControl(pageAwareWait, isHidden);
    this.reporter = reporter;
    this.control = control;

    reporter.onStatus((s, d) => {
      if (s !== 'paused' && s !== 'stopped' && s !== 'error' && s !== 'finished') this.lastActiveStatus = s;
      this.overlay.update(s, d);
    });
    control.onChange((state, reason) => {
      if (state === 'paused') {
        reporter.status('paused', reason);
        reporter.log('info', reason);
      } else if (state === 'running') {
        reporter.status(this.lastActiveStatus, 'Resumed');
        reporter.log('info', 'Resumed');
      }
    });

    reporter.set({ running: true, iteration: 0, maxIterations: req.mode === 'agent' ? req.maxIterations : 0 });
    reporter.status('detecting', 'Looking for an editor');

    try {
      const det = req.mode === 'comments' ? await this.pickEditorForComments(req) : await detectEditor();
      if (!det.adapter) {
        reporter.log('error', det.reason ?? 'No editor found');
        reporter.status('error', det.reason ?? 'No editor found');
        return;
      }
      this.attach(det.adapter, req.typing);
      reporter.log('info', `Editor detected: ${det.adapter.label}`);

      if (req.mode === 'type') await this.runTyping(req);
      else if (req.mode === 'comments') await this.runComments(req);
      else await this.runAgent(req);
    } catch (e) {
      if (e instanceof StopError) {
        reporter.status('stopped', 'Stopped by user');
        reporter.log('info', 'Stopped by user');
      } else {
        const msg = (e as Error)?.message ?? String(e);
        reporter.status('error', msg);
        reporter.log('error', msg);
      }
    } finally {
      this.running = false;
      reporter.set({ running: false });
      await reporter.flush();
    }
  }

  private attach(adapter: EditorAdapter, typing: TypingProfile) {
    const profile = this.engine?.getProfile() ?? typing;
    this.adapter = adapter;
    let lastReport = 0;
    this.engine = new HumanTypingEngine(adapter, this.control!, profile, {
      yieldFn: yieldToEventLoop,
      onProgress: (typed, total) => {
        const now = Date.now();
        if (now - lastReport < 800 && typed < total) return;
        lastReport = now;
        this.reporter?.set({ detail: `${typed}/${total} characters` });
      },
    });
  }

  private async runTyping(req: RunRequest) {
    const reporter = this.reporter!;
    reporter.status('typing', `Typing ${req.code.length} characters`);
    reporter.log('action', `Action: type ${req.code.length} characters (${req.typing.mode}, ${req.typing.wpm} WPM)`);
    await this.guardFocus();
    await this.engine!.typeText(req.code);
    reporter.log('info', 'Typing complete and verified');
    reporter.status('finished', `Typed ${req.code.length} characters`);
  }

  /** The code editor whose content contains the most explained lines (the focused text box is a last resort). */
  private async pickEditorForComments(req: RunRequest): Promise<{ adapter: EditorAdapter | null; reason?: string }> {
    const editors = await detectEditors({ preferCode: true });
    if (!editors.length) return detectEditor({ preferCode: true });
    let best = editors[0];
    let bestScore = -1;
    for (const ed of editors) {
      const lines = (await ed.getCode()).split('\n');
      const score = (req.comments ?? []).filter((c) => locateAnchor(lines, c.line, c.anchor) >= 0).length;
      if (score > bestScore) {
        best = ed;
        bestScore = score;
      }
    }
    return { adapter: best };
  }

  /** Inserts explanation comments above their lines, bottom-up so earlier line numbers stay valid. */
  private async runComments(req: RunRequest) {
    const reporter = this.reporter!;
    const adapter = this.adapter!;
    const items = req.comments ?? [];
    const lines0 = (await adapter.getCode()).split('\n');

    const byLine = new Map<number, string[]>();
    let skipped = 0;
    for (const c of items) {
      const idx = locateAnchor(lines0, c.line, c.anchor);
      if (idx < 0) {
        skipped++;
        reporter.log('warn', `Skipped a comment: line ${c.line} ("${c.anchor.trim().slice(0, 40)}") is not in the editor`);
        continue;
      }
      byLine.set(idx, [...(byLine.get(idx) ?? []), ...c.lines]);
    }
    const targets = [...byLine.entries()].sort((a, b) => b[0] - a[0]);
    reporter.status('typing', `Adding ${targets.length} comment block(s)`);

    for (const [idx, commentLines] of targets) {
      await this.guardFocus();
      const code = await adapter.getCode();
      const line = code.split('\n')[idx] ?? '';
      const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
      const off = lineColToOffset(code, idx + 1, 1) ?? 0;
      await adapter.select(off, off);
      reporter.log('action', `Action: comment above line ${idx + 1}`);
      await this.engine!.typeText(commentLines.map((l) => indent + l).join('\n') + '\n');
    }
    const msg = `Added ${targets.length} comment block(s)${skipped ? `, skipped ${skipped}` : ''}`;
    reporter.log('info', msg);
    reporter.status('finished', msg);
  }

  private async runAgent(req: RunRequest) {
    const reporter = this.reporter!;
    const env: AgentEnvironment = {
      observe: ({ vision }) => this.observe(req, vision),
      execute: (action) => this.execute(action),
      checkpoint: () => this.control!.checkpoint(),
      status: (s, d, iteration) => reporter.status(s, d, iteration),
      log: (level, msg) => reporter.log(level, msg),
    };
    const code = await this.adapter!.getCode();
    const language =
      req.language !== 'auto'
        ? req.language
        : (await this.adapter!.getLanguage().catch(() => null)) ?? detectLanguage(code || req.code) ?? 'unknown';

    const agent = new Agent(new BackgroundAIProvider(), env, {
      task: req.task.trim(),
      language,
      referenceCode: req.code,
      model: req.model,
      maxIterations: req.maxIterations,
      visionEnabled: req.visionEnabled,
      verbose: req.debug,
    });
    reporter.log('info', `Agent started (model ${req.model}, max ${req.maxIterations} iterations)`);
    const result = await agent.run();

    switch (result.status) {
      case 'finished':
        reporter.log('info', `Finished after ${result.iterations} iteration(s): ${result.message}`);
        reporter.status('finished', result.message);
        break;
      case 'stopped':
        reporter.log('info', 'Stopped by user');
        reporter.status('stopped', 'Stopped by user');
        break;
      default:
        reporter.log('error', result.message);
        reporter.status('error', result.message);
    }
  }

  /** Pauses (instead of typing into the wrong place) when the user has moved to another input. */
  private async guardFocus(): Promise<void> {
    const adapter = this.adapter!;
    const state = await adapter.ensureFocus();
    if (state !== 'lost') return;
    this.reporter?.log('warn', 'Editor lost focus — paused. Click Resume to continue typing into the editor.');
    this.control!.pause('Editor lost focus — press Resume');
    await this.control!.checkpoint();
    adapter.element().focus({ preventScroll: true });
  }

  private async observe(req: RunRequest, vision: boolean): Promise<Observation> {
    const warnings: string[] = [];
    if (!this.adapter?.isAlive()) {
      const det = await detectEditor();
      if (!det.adapter) {
        return { editor: null, code: '', cursor: null, selectedText: '', errors: [], pageContext: '', warnings: [det.reason ?? 'Editor not found'] };
      }
      this.attach(det.adapter, req.typing);
      warnings.push('The page re-created the editor; re-attached to it.');
      this.reporter?.log('warn', 'Editor was re-created by the page; re-attached');
    }
    const adapter = this.adapter!;
    const el = adapter.element();
    const [code, cursor, selectedText, editor] = await Promise.all([
      adapter.getCode(),
      adapter.getCursorPosition(),
      adapter.getSelectedText(),
      editorInfo(adapter),
    ]);
    const errors = extractErrors(el);
    const obs: Observation = {
      editor,
      code,
      cursor,
      selectedText,
      errors: errors.texts,
      pageContext: req.includePageContext ? extractProblemText(el) : '',
      warnings,
    };
    if (!adapter.exactOffsets) warnings.push('Contenteditable editor: offsets may be approximate; prefer "find".');

    if (vision) {
      this.reporter?.log('info', 'Vision inspection: capturing the editor region');
      const res = await sendToBackground({
        type: 'VISION_INSPECT',
        rect: relevantRect(el, errors.elements),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        dpr: window.devicePixelRatio || 1,
        task: req.task,
      });
      if (res.ok) obs.visionNotes = res.notes;
      else {
        warnings.push(`Vision inspection failed: ${res.error}`);
        this.reporter?.log('warn', `Vision inspection failed: ${res.error}`);
      }
    }
    return obs;
  }

  private async execute(action: AgentAction): Promise<ActionOutcome> {
    const adapter = this.adapter!;
    const engine = this.engine!;
    try {
      await this.guardFocus();
      switch (action.type) {
        case 'type':
          await engine.typeText(action.text);
          break;
        case 'key':
          await engine.pressKey(action.key, action.times ?? 1);
          break;
        case 'wait':
          await this.control!.sleep(action.ms);
          break;
        case 'move': {
          const code = await adapter.getCode();
          const off = lineColToOffset(code, action.line, action.column);
          if (off === null) return { ok: false, message: `line ${action.line} does not exist (editor has ${code.split('\n').length} lines)` };
          await adapter.select(off, off);
          break;
        }
        case 'select': {
          const len = (await adapter.getCode()).length;
          if (action.end > len) return { ok: false, message: `selection end ${action.end} is beyond the document length ${len}` };
          await adapter.select(action.start, action.end);
          break;
        }
        case 'find': {
          const code = await adapter.getCode();
          const n = action.occurrence ?? 1;
          const idx = nthIndexOf(code, action.text, n);
          if (idx === -1) {
            const count = code.split(action.text).length - 1;
            return { ok: false, message: count ? `only ${count} occurrence(s) of the text exist` : 'text not found in the editor' };
          }
          await adapter.select(idx, idx + action.text.length);
          break;
        }
        case 'replace':
          await engine.replaceSelection(action.text);
          break;
        case 'delete':
          await engine.deleteBackward(action.count);
          break;
        case 'inspect':
          break; // handled by the agent loop
      }
      return { ok: true };
    } catch (e) {
      if (e instanceof StopError) throw e;
      return { ok: false, message: (e as Error)?.message ?? String(e) };
    }
  }
}
