// Pure helpers for offset <-> line/column math. Lines and columns are 1-based, offsets 0-based.

import type { CursorPosition } from './types';

export function lineStarts(code: string): number[] {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  return starts;
}

export function offsetToLineCol(code: string, offset: number): { line: number; column: number } {
  const o = Math.max(0, Math.min(offset, code.length));
  const starts = lineStarts(code);
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= o) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: o - starts[lo] + 1 };
}

/** Returns null when the line is out of range. Columns past the line end clamp to the line end. */
export function lineColToOffset(code: string, line: number, column: number): number | null {
  const starts = lineStarts(code);
  if (line < 1 || line > starts.length) return null;
  const start = starts[line - 1];
  const end = line < starts.length ? starts[line] - 1 : code.length;
  return Math.min(start + Math.max(0, column - 1), end);
}

export function cursorFrom(code: string, selectionStart: number, selectionEnd: number, head = selectionEnd): CursorPosition {
  const { line, column } = offsetToLineCol(code, head);
  return { offset: head, line, column, selectionStart, selectionEnd };
}

/** Index of the n-th (1-based) occurrence of needle, or -1. */
export function nthIndexOf(haystack: string, needle: string, n: number): number {
  let from = 0;
  for (let i = 1; ; i++) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1 || i === n) return idx;
    from = idx + 1;
  }
}

/** Guesses the indent unit used by existing code: a tab, or the smallest space indent (default 4). */
export function detectIndentUnit(code: string): string {
  let minSpaces = Infinity;
  let tabs = 0;
  let spaced = 0;
  for (const line of code.split('\n')) {
    const m = /^([ \t]+)\S/.exec(line);
    if (!m) continue;
    if (m[1].startsWith('\t')) tabs++;
    else {
      spaced++;
      minSpaces = Math.min(minSpaces, m[1].length);
    }
  }
  if (tabs > spaced) return '\t';
  if (minSpaces >= 2 && minSpaces <= 8) return ' '.repeat(minSpaces);
  return '    ';
}

/** Renders code with right-aligned line numbers for the model, windowed around the cursor if too long. */
export function numberedCode(code: string, maxChars: number, focusLine = 1): { text: string; truncated: boolean } {
  const lines = code.split('\n');
  const width = String(lines.length).length;
  const render = (from: number, to: number) =>
    lines
      .slice(from, to)
      .map((l, i) => `${String(from + i + 1).padStart(width, ' ')}| ${l}`)
      .join('\n');

  const full = render(0, lines.length);
  if (full.length <= maxChars) return { text: full, truncated: false };

  // Grow a window around the focus line until it no longer fits.
  let from = Math.max(0, focusLine - 1);
  let to = Math.min(lines.length, focusLine);
  while (true) {
    const nextFrom = Math.max(0, from - 5);
    const nextTo = Math.min(lines.length, to + 5);
    if (nextFrom === from && nextTo === to) break;
    if (render(nextFrom, nextTo).length > maxChars) break;
    from = nextFrom;
    to = nextTo;
  }
  const head = from > 0 ? `... (lines 1-${from} omitted)\n` : '';
  const tail = to < lines.length ? `\n... (lines ${to + 1}-${lines.length} omitted)` : '';
  return { text: head + render(from, to) + tail, truncated: true };
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}
