import { describe, expect, it } from 'vitest';
import { keyPressDelay, keystrokeDelay, msPerChar, mulberry32, type KeystrokeContext } from '../src/content/typing/timing';
import { tokenize } from '../src/content/typing/HumanTypingEngine';
import type { TypingProfile } from '../src/shared/types';

const ctx = (over: Partial<KeystrokeContext> = {}): KeystrokeContext => ({
  prev: 'a',
  ch: 'b',
  wordFactor: 1,
  lineStart: false,
  blockStart: false,
  repeatRun: 0,
  lastLatencyMs: 0,
  ...over,
});
const natural: TypingProfile = { mode: 'natural', wpm: 60, thinkingPauses: true, adaptive: false };

describe('typing timing model', () => {
  it('fast mode never waits', () => {
    const p = { ...natural, mode: 'fast' as const };
    expect(keystrokeDelay(ctx(), p, mulberry32(1))).toBe(0);
    expect(keyPressDelay('ENTER', 0, p, mulberry32(1))).toBe(0);
  });

  it('steady mode is a constant rate derived from WPM', () => {
    const p = { ...natural, mode: 'steady' as const, wpm: 60 };
    expect(msPerChar(60)).toBe(200);
    expect(keystrokeDelay(ctx(), p, mulberry32(1))).toBe(200);
    expect(keystrokeDelay(ctx({ ch: ';' }), p, mulberry32(2))).toBe(200);
  });

  it('natural mode is deterministic for a given seed and stays within bounds', () => {
    const a = Array.from({ length: 50 }, (_, i) => keystrokeDelay(ctx({ ch: 'x', prev: i % 7 ? 'y' : ';' }), natural, mulberry32(i)));
    const b = Array.from({ length: 50 }, (_, i) => keystrokeDelay(ctx({ ch: 'x', prev: i % 7 ? 'y' : ';' }), natural, mulberry32(i)));
    expect(a).toEqual(b);
    for (const d of a) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(5000);
    }
  });

  it('pauses longer after punctuation and on new lines', () => {
    const avg = (c: Partial<KeystrokeContext>) => {
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += keystrokeDelay(ctx(c), { ...natural, thinkingPauses: false }, mulberry32(i));
      return sum / 400;
    };
    expect(avg({ prev: ';', ch: ' ' })).toBeGreaterThan(avg({ prev: 'a', ch: 'b' }));
    expect(avg({ ch: '\n' })).toBeGreaterThan(avg({ ch: 'b' }));
  });

  it('thinking pauses only happen when enabled', () => {
    const max = (p: TypingProfile) =>
      Math.max(...Array.from({ length: 300 }, (_, i) => keystrokeDelay(ctx({ lineStart: true, blockStart: true }), p, mulberry32(i))));
    expect(max({ ...natural, thinkingPauses: true })).toBeGreaterThan(700);
    expect(max({ ...natural, thinkingPauses: false })).toBeLessThan(700);
  });

  it('adaptive timing subtracts editor latency', () => {
    const p = { ...natural, mode: 'steady' as const, adaptive: true };
    expect(keystrokeDelay(ctx({ lastLatencyMs: 50 }), p, mulberry32(1))).toBe(150);
  });
});

describe('tokenize', () => {
  it('groups leading indentation into a single unit per line', () => {
    const units = tokenize('if (x) {\n    y();\n}', true);
    const texts = units.map((u) => u.text);
    expect(texts).toContain('    ');
    expect(texts.join('')).toBe('if (x) {\n    y();\n}');
    expect(units.find((u) => u.text === '    ')!.indent).toBe(true);
  });

  it('keeps surrogate pairs intact', () => {
    expect(tokenize('a😀b', false).map((u) => u.text)).toEqual(['a', '😀', 'b']);
  });
});
