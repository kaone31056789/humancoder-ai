// Pure timing model for the typing engine. Separated from DOM work so it can be unit-tested
// and reasoned about: given what is being typed and a profile, how long to wait before a keystroke.

import type { TypingProfile } from '../../shared/types';

export type Rng = () => number;

/** Small, seedable PRNG so timing is reproducible in tests. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximately standard-normal sample (Irwin–Hall, cheap and bounded to ±3). */
export function gaussian(rng: Rng): number {
  return rng() + rng() + rng() + rng() + rng() + rng() - 3;
}

/** Milliseconds per character at a words-per-minute rate (1 word = 5 chars). */
export function msPerChar(wpm: number): number {
  return 60000 / (Math.max(1, wpm) * 5);
}

const FAST_WORDS = new Set([
  'int', 'for', 'if', 'else', 'return', 'while', 'void', 'char', 'bool', 'true', 'false', 'auto', 'const',
  'let', 'var', 'def', 'self', 'in', 'and', 'or', 'not', 'new', 'this', 'std', 'cout', 'cin', 'endl',
  'public', 'static', 'class', 'import', 'from', 'print', 'string', 'long', 'double', 'float', 'null', 'None',
]);
const SHIFTED = new Set('~!@#$%^&*()_+{}|:"<>?');
const PAUSE_AFTER = new Set(';,');
const isWordChar = (c: string) => /[A-Za-z0-9_]/.test(c);

/** Per-word speed multiplier: familiar keywords are faster, long identifiers slightly slower. */
export function wordFactor(word: string, rng: Rng): number {
  if (FAST_WORDS.has(word)) return 0.7 + rng() * 0.15;
  const lengthPenalty = Math.min(0.2, Math.max(0, word.length - 6) * 0.025);
  return 0.85 + rng() * 0.3 + lengthPenalty;
}

export interface KeystrokeContext {
  prev: string;
  ch: string;
  /** Speed multiplier of the word `ch` belongs to (1 outside words). */
  wordFactor: number;
  /** True for the first keystroke on a new line (after indentation is placed). */
  lineStart: boolean;
  /** True when the previous line ended with an opening brace/colon (a new block starts). */
  blockStart: boolean;
  /** How many identical characters precede this one (e.g. '=' in '=='). */
  repeatRun: number;
  /** Milliseconds the editor took to apply the previous keystroke. */
  lastLatencyMs: number;
}

/**
 * Delay before typing `ctx.ch`. Fast mode → 0. Steady → constant rate. Natural → rate modulated by
 * jitter, word familiarity, shifted symbols, punctuation and newline pauses, plus optional thinking pauses.
 */
export function keystrokeDelay(ctx: KeystrokeContext, profile: TypingProfile, rng: Rng): number {
  if (profile.mode === 'fast') return 0;
  const base = msPerChar(profile.wpm);
  if (profile.mode === 'steady') return Math.max(0, Math.round(base - (profile.adaptive ? ctx.lastLatencyMs : 0)));

  let d = base * Math.min(1.8, Math.max(0.55, 1 + gaussian(rng) * 0.2));
  if (isWordChar(ctx.ch)) d *= ctx.wordFactor;
  if (SHIFTED.has(ctx.ch)) d *= 1.25;
  if (ctx.repeatRun > 0) d *= profile.adaptive ? 0.6 : 0.8;
  if (ctx.ch === ' ' && isWordChar(ctx.prev)) d *= 0.85;

  if (PAUSE_AFTER.has(ctx.prev)) d += base * (0.5 + rng() * 0.8);
  else if (ctx.prev === ')' || ctx.prev === '{' || ctx.prev === '}') d += base * (0.2 + rng() * 0.4);

  if (ctx.ch === '\n') d = base * (1.4 + rng() * 1.6);
  if (ctx.lineStart) d += base * (0.6 + rng() * 1.2);

  if (profile.thinkingPauses && ctx.lineStart) {
    const p = ctx.blockStart ? 0.14 : 0.06;
    if (rng() < p) d += 450 + rng() * 1400;
  }

  if (profile.adaptive) d -= ctx.lastLatencyMs; // keep the effective rate on target on slow editors
  return Math.max(0, Math.min(5000, Math.round(d)));
}

/** Delay before a discrete key press (Enter, Backspace, arrows…). */
export function keyPressDelay(key: string, repeatIndex: number, profile: TypingProfile, rng: Rng): number {
  if (profile.mode === 'fast') return 0;
  const base = msPerChar(profile.wpm);
  if (profile.mode === 'steady') return Math.round(base);
  // Held/repeated keys (Backspace ×10) speed up after the first press.
  const repeatFactor = repeatIndex === 0 ? 1.6 : 0.55;
  const keyFactor = key === 'ENTER' ? 1.5 : key.startsWith('ARROW') ? 0.9 : 1;
  return Math.round(base * repeatFactor * keyFactor * (0.85 + rng() * 0.3));
}

/** Short pause used between composite steps (e.g. after deleting a selection, before retyping). */
export function stepPause(profile: TypingProfile, rng: Rng): number {
  if (profile.mode === 'fast') return 0;
  const base = msPerChar(profile.wpm);
  return Math.round(profile.mode === 'steady' ? base * 2 : base * (2 + rng() * 3));
}

export { isWordChar };
