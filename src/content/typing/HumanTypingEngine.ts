// The "hands": turns an action's text into individual keystrokes against an EditorAdapter.
// The AI decides WHAT to type; this engine decides HOW (timing, chunking, indentation) and
// verifies that the editor actually contains what was typed.

import type { KeyName } from '../../ai/schemas';
import type { TypingProfile } from '../../shared/types';
import type { EditorAdapter } from '../editor/EditorAdapter';
import type { RunControl } from '../RunControl';
import {
  isWordChar,
  keyPressDelay,
  keystrokeDelay,
  mulberry32,
  stepPause,
  wordFactor,
  type Rng,
} from './timing';

export class TypingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TypingError';
  }
}

export interface TypingEngineOptions {
  rng?: Rng;
  now?: () => number;
  onProgress?: (typed: number, total: number) => void;
  /** Lets the page process events between fast-mode chunks. */
  yieldFn?: () => Promise<void>;
}

const defaultYield = () => new Promise<void>((r) => setTimeout(r, 0));

/** Splits text into keystroke units. A line's leading indentation is one unit (like an editor Tab). */
export function tokenize(text: string, startsAtLineStart: boolean): { text: string; lineStart: boolean; indent: boolean }[] {
  const units: { text: string; lineStart: boolean; indent: boolean }[] = [];
  let i = 0;
  let atLineStart = startsAtLineStart;
  const chars = Array.from(text); // code points, so surrogate pairs stay together
  while (i < chars.length) {
    if (atLineStart) {
      let j = i;
      while (j < chars.length && (chars[j] === ' ' || chars[j] === '\t')) j++;
      if (j > i) {
        units.push({ text: chars.slice(i, j).join(''), lineStart: true, indent: true });
        i = j;
      }
      if (i < chars.length && chars[i] !== '\n') {
        units.push({ text: chars[i], lineStart: true, indent: false });
        i++;
      }
      atLineStart = false;
      continue;
    }
    const ch = chars[i];
    units.push({ text: ch, lineStart: false, indent: false });
    if (ch === '\n') atLineStart = true;
    i++;
  }
  return units;
}

export class HumanTypingEngine {
  private profile: TypingProfile;
  private readonly rng: Rng;
  private readonly now: () => number;

  constructor(
    private readonly adapter: EditorAdapter,
    private readonly control: RunControl,
    profile: TypingProfile,
    private readonly options: TypingEngineOptions = {},
  ) {
    this.profile = { ...profile };
    this.rng = options.rng ?? mulberry32((Date.now() ^ 0x5eed) >>> 0);
    this.now = options.now ?? (() => performance.now());
  }

  /** Live speed / mode changes apply from the next keystroke. */
  setProfile(profile: Partial<TypingProfile>): void {
    this.profile = { ...this.profile, ...profile };
  }

  getProfile(): TypingProfile {
    return { ...this.profile };
  }

  /** Types text at the caret (replacing any selection), then verifies the editor content. */
  async typeText(raw: string): Promise<void> {
    const text = raw.replace(/\r\n?/g, '\n');
    if (!text) return;
    await this.control.checkpoint();

    const before = await this.adapter.getCursorPosition();
    const codeBefore = await this.adapter.getCode();
    const start = before.selectionStart;
    const expected = codeBefore.slice(0, start) + text + codeBefore.slice(before.selectionEnd);
    if (before.selectionEnd !== before.selectionStart) {
      await this.adapter.deleteSelection();
      await this.control.sleep(stepPause(this.profile, this.rng));
    }

    if (this.profile.mode === 'fast') await this.typeFast(text);
    else await this.typeNatural(text, before.column === 1);

    await this.verify(expected);
  }

  private async typeFast(text: string): Promise<void> {
    // Line-sized chunks: quick, but still incremental and interruptible.
    const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [text];
    let typed = 0;
    for (const line of lines) {
      await this.control.checkpoint();
      await this.adapter.type(line);
      typed += line.length;
      this.options.onProgress?.(typed, text.length);
      await (this.options.yieldFn ?? defaultYield)();
    }
  }

  private async typeNatural(text: string, startsAtLineStart: boolean): Promise<void> {
    const units = tokenize(text, startsAtLineStart);
    let prev = '';
    let prevLineEnd = '';
    let currentWordFactor = 1;
    let repeatRun = 0;
    let latency = 0;
    let typed = 0;

    for (let u = 0; u < units.length; u++) {
      const unit = units[u];
      const ch = unit.text[0];

      if (isWordChar(ch) && !isWordChar(prev)) {
        const word = /^[A-Za-z0-9_]+/.exec(units.slice(u, u + 40).map((x) => x.text).join(''))?.[0] ?? ch;
        currentWordFactor = wordFactor(word, this.rng);
      } else if (!isWordChar(ch)) {
        currentWordFactor = 1;
      }
      repeatRun = ch === prev ? repeatRun + 1 : 0;

      const delay = unit.indent
        ? Math.round(keyPressDelay('TAB', 0, this.profile, this.rng) * 0.6)
        : keystrokeDelay(
            {
              prev,
              ch,
              wordFactor: currentWordFactor,
              lineStart: unit.lineStart,
              blockStart: unit.lineStart && /[{:([]\s*$/.test(prevLineEnd),
              repeatRun,
              lastLatencyMs: latency,
            },
            this.profile,
            this.rng,
          );

      await this.control.sleep(delay);
      const t0 = this.now();
      await this.adapter.type(unit.text);
      latency = this.now() - t0;

      if (ch === '\n') prevLineEnd = prev;
      prev = unit.text[unit.text.length - 1];
      typed += unit.text.length;
      this.options.onProgress?.(typed, text.length);
    }
  }

  /** Presses a key `times` times with natural spacing (faster after the first repeat). */
  async pressKey(key: KeyName, times = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
      await this.control.sleep(keyPressDelay(key, i, this.profile, this.rng));
      await this.adapter.pressKey(key);
    }
  }

  /** Backspace `count` characters; a non-empty selection is removed first and counts as one press. */
  async deleteBackward(count: number): Promise<void> {
    const pos = await this.adapter.getCursorPosition();
    if (pos.selectionStart === pos.selectionEnd && pos.offset === 0) {
      throw new TypingError('Nothing to delete: the caret is at the start of the document.');
    }
    await this.pressKey('BACKSPACE', count);
  }

  /** Replaces the selection with text (empty text simply deletes the selection). */
  async replaceSelection(text: string): Promise<void> {
    const pos = await this.adapter.getCursorPosition();
    if (pos.selectionStart !== pos.selectionEnd) {
      await this.control.sleep(stepPause(this.profile, this.rng));
      await this.adapter.deleteSelection();
    }
    if (text) {
      await this.control.sleep(stepPause(this.profile, this.rng));
      await this.typeText(text);
    }
  }

  /** The whole document must equal what it was with the selection replaced by the typed text. */
  private async verify(expected: string): Promise<void> {
    if (!this.adapter.exactOffsets) return;
    const actual = await this.adapter.getCode();
    if (actual === expected) return;
    let at = 0;
    while (at < expected.length && actual[at] === expected[at]) at++;
    throw new TypingError(
      `Editor content differs from what was typed (first difference at offset ${at}). ` +
        'The editor may have auto-inserted or reformatted text, or the page/user changed it.',
    );
  }
}
