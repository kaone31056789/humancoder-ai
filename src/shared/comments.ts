// Turns explanation annotations into language-appropriate comments and page-box text.

import type { Annotation, CodeExplanation, CommentInsertion } from './types';

const HASH = new Set(['python', 'ruby', 'r', 'shell', 'bash', 'perl', 'yaml', 'toml', 'elixir']);
const DASH = new Set(['sql', 'lua', 'haskell']);

export function commentSyntax(language: string): { open: string; close: string } {
  const l = language.toLowerCase();
  if (HASH.has(l)) return { open: '#', close: '' };
  if (DASH.has(l)) return { open: '--', close: '' };
  if (l === 'html' || l === 'xml') return { open: '<!--', close: ' -->' };
  if (l === 'css') return { open: '/*', close: ' */' };
  return { open: '//', close: '' }; // C-family, JS/TS, Java, Go, Rust, C#, Kotlin, PHP, Swift…
}

/** Word-wraps text into comment lines no wider than `width` characters of text. */
export function formatComment(language: string, text: string, width = 88): string[] {
  const { open, close } = commentSyntax(language);
  const out: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n')) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let line = '';
    for (const w of words) {
      if (line && line.length + 1 + w.length > width) {
        out.push(line);
        line = w;
      } else line = line ? `${line} ${w}` : w;
    }
    if (line) out.push(line);
  }
  return out.map((l) => `${open} ${l}${close}`);
}

/**
 * Comment blocks to insert above each annotated range of `code`. For a whole-code explanation the
 * formatted summary (e.g. the Algorithm block) goes above the first explained block as well.
 */
export function buildCommentInsertions(code: string, language: string, annotations: Annotation[], summary?: string): CommentInsertion[] {
  const lines = code.split('\n');
  const valid = annotations.filter((a) => a.fromLine >= 1 && a.fromLine <= lines.length && a.text.trim());
  const out = valid.map((a) => ({ line: a.fromLine, anchor: lines[a.fromLine - 1], lines: formatComment(language, a.text) }));
  if (summary?.trim() && valid.length) {
    const first = valid.reduce((m, a) => (a.fromLine < m.fromLine ? a : m));
    out.unshift({ line: first.fromLine, anchor: lines[first.fromLine - 1], lines: formatComment(language, summary) });
  }
  return out;
}

const rangeLabel = (a: Annotation) => (a.fromLine === a.toLine ? `Line ${a.fromLine}` : `Lines ${a.fromLine}-${a.toLine}`);

/** Text for an explanation box on the page: the formatted explanation, plus line notes for whole-code explanations. */
export function explanationToText(explanation: CodeExplanation, ranged: boolean): string {
  const anns = explanation.annotations;
  if (ranged) return (anns.map((a) => a.text).join('\n\n') || explanation.summary).trim();
  if (!anns.length) return explanation.summary.trim();
  return [explanation.summary.trim(), '', 'Line notes:', ...anns.map((a) => `- ${rangeLabel(a)}: ${a.text}`)].join('\n').trim();
}

/**
 * Finds where an anchor line is now: its original index if unchanged, otherwise the nearest line
 * with the same trimmed text. Returns a 0-based index or -1.
 */
export function locateAnchor(lines: string[], line: number, anchor: string): number {
  const want = anchor.trim();
  const idx = line - 1;
  if (idx >= 0 && idx < lines.length && lines[idx].trim() === want) return idx;
  if (!want) return idx >= 0 && idx < lines.length ? idx : -1;
  let best = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === want && (best === -1 || Math.abs(i - idx) < Math.abs(best - idx))) best = i;
  }
  return best;
}
