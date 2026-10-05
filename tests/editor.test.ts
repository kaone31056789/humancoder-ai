// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { StopError } from '../src/ai/Agent';
import { buildModel, offsetToPoint, pointToOffset } from '../src/content/editor/contentEditableModel';
import { GenericAdapter } from '../src/content/editor/GenericAdapter';
import { detectEditor } from '../src/content/editor/registry';
import { RunControl } from '../src/content/RunControl';
import { HumanTypingEngine, TypingError } from '../src/content/typing/HumanTypingEngine';
import type { TypingProfile } from '../src/shared/types';

const FAST: TypingProfile = { mode: 'fast', wpm: 400, thinkingPauses: false, adaptive: false };
const QUICK_NATURAL: TypingProfile = { mode: 'natural', wpm: 400, thinkingPauses: false, adaptive: true };

function setup(value = '', profile = FAST) {
  document.body.innerHTML = '<textarea id="ed"></textarea>';
  const ta = document.getElementById('ed') as HTMLTextAreaElement;
  ta.value = value;
  ta.focus();
  ta.setSelectionRange(value.length, value.length);
  const adapter = new GenericAdapter(ta);
  const control = new RunControl();
  const engine = new HumanTypingEngine(adapter, control, profile);
  return { ta, adapter, control, engine };
}

describe('GenericAdapter + typing engine (textarea)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('inserts code at the caret and fires input events', async () => {
    const { ta, engine } = setup();
    let inputs = 0;
    ta.addEventListener('input', () => inputs++);
    const code = '#include <iostream>\nint main() {\n    return 0;\n}';
    await engine.typeText(code);
    expect(ta.value).toBe(code);
    expect(inputs).toBeGreaterThan(0);
    expect(ta.selectionStart).toBe(code.length);
  });

  it('types char by char in natural mode and keeps indentation exact', async () => {
    const { ta, engine } = setup('', QUICK_NATURAL);
    const code = 'if (a) {\n\tb();\n}';
    await engine.typeText(code);
    expect(ta.value).toBe(code);
  });

  it('handles Enter, Tab, Backspace, Delete and arrows', async () => {
    const { ta, adapter, engine } = setup('ab');
    await engine.pressKey('ENTER');
    expect(ta.value).toBe('ab\n');
    await engine.pressKey('TAB');
    expect(ta.value).toBe('ab\n    ');
    await engine.pressKey('BACKSPACE', 4);
    expect(ta.value).toBe('ab\n');
    await engine.pressKey('ARROW_UP');
    expect((await adapter.getCursorPosition()).line).toBe(1);
    await engine.pressKey('HOME');
    await engine.pressKey('DELETE');
    expect(ta.value).toBe('b\n');
    await engine.pressKey('END');
    expect((await adapter.getCursorPosition()).offset).toBe(1);
  });

  it('replaces a selection', async () => {
    const { ta, adapter, engine } = setup('int x = 1;');
    await adapter.select(4, 5);
    await engine.replaceSelection('count');
    expect(ta.value).toBe('int count = 1;');
  });

  it('tab indent unit follows existing code', async () => {
    const { ta, engine } = setup('if (a) {\n  b();\n}\n');
    await engine.pressKey('TAB');
    expect(ta.value.endsWith('\n  ')).toBe(true);
  });

  it('detects edits the page made behind our back', async () => {
    const { ta, engine } = setup('', QUICK_NATURAL);
    // Simulate an editor that auto-closes brackets.
    ta.addEventListener('input', () => {
      if (ta.value.endsWith('(')) {
        const pos = ta.selectionStart;
        ta.value += ')';
        ta.setSelectionRange(pos, pos);
      }
    });
    await expect(engine.typeText('f(x);')).rejects.toBeInstanceOf(TypingError);
  });

  it('pauses and resumes mid-typing', async () => {
    const { ta, control, engine } = setup('', { mode: 'steady', wpm: 400, thinkingPauses: false, adaptive: false });
    const done = engine.typeText('abcdefghij');
    await new Promise((r) => setTimeout(r, 70));
    control.pause();
    await new Promise((r) => setTimeout(r, 40));
    const frozen = ta.value;
    await new Promise((r) => setTimeout(r, 150));
    expect(ta.value).toBe(frozen);
    expect(frozen.length).toBeLessThan(10);
    control.resume();
    await done;
    expect(ta.value).toBe('abcdefghij');
  });

  it('stops promptly', async () => {
    const { ta, control, engine } = setup('', { mode: 'steady', wpm: 400, thinkingPauses: false, adaptive: false });
    const done = engine.typeText('abcdefghijklmnopqrstuvwxyz');
    await new Promise((r) => setTimeout(r, 60));
    control.stop();
    await expect(done).rejects.toBeInstanceOf(StopError);
    expect(ta.value.length).toBeLessThan(26);
  });

  it('applies speed changes while running', async () => {
    const { engine } = setup('', { mode: 'steady', wpm: 20, thinkingPauses: false, adaptive: false });
    const t0 = Date.now();
    const done = engine.typeText('abcdefgh');
    engine.setProfile({ mode: 'fast' });
    await done;
    expect(Date.now() - t0).toBeLessThan(1000); // at 20 wpm this would take ~4.8s
  });
});

describe('editor detection', () => {
  it('finds the focused textarea', async () => {
    document.body.innerHTML = '<div><textarea id="a"></textarea><textarea id="b"></textarea></div>';
    (document.getElementById('b') as HTMLTextAreaElement).focus();
    const det = await detectEditor();
    expect(det.adapter?.kind).toBe('textarea');
    expect(det.adapter?.element().id).toBe('b');
  });

  it('explains when no editor exists', async () => {
    document.body.innerHTML = '<p>nothing here</p>';
    const det = await detectEditor();
    expect(det.adapter).toBeNull();
    expect(det.reason).toMatch(/No supported editor/);
  });
});

describe('contenteditable text model', () => {
  const make = (html: string) => {
    document.body.innerHTML = `<div id="ce" contenteditable="true">${html}</div>`;
    return document.getElementById('ce') as HTMLElement;
  };

  it('maps <br> and block markup to newlines', () => {
    expect(buildModel(make('a<br>b')).text).toBe('a\nb');
    expect(buildModel(make('a<br><br>')).text).toBe('a\n');
    expect(buildModel(make('<div>a</div><div>b</div>')).text).toBe('a\nb');
    expect(buildModel(make('x<div>y</div><div><br></div>')).text).toBe('x\ny\n');
  });

  it('round-trips offsets through DOM points', () => {
    const root = make('int a;<br>int b;<br>return a+b;');
    const model = buildModel(root);
    for (let off = 0; off <= model.text.length; off++) {
      const p = offsetToPoint(model, root, off);
      expect(pointToOffset(model, root, p.node, p.offset)).toBe(off);
    }
  });
});
