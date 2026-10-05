// Collects only what the coding task needs from the page: visible error/output text near the
// editor and a short problem description. Nothing is collected unless a session is running.

import { LIMITS } from '../shared/config';
import type { Rect } from '../shared/types';
import { truncate } from '../shared/text';

const ERROR_SELECTORS = [
  '[role="alert"]',
  '[class*="error" i]',
  '[class*="compile" i]',
  '[class*="console" i]',
  '[class*="output" i]',
  '[class*="result" i]',
  '[class*="stderr" i]',
  '[data-e2e-locator*="console" i]',
  '.monaco-editor .squiggly-error', // marker only; text comes from hover, so usually filtered as empty
];

const PROBLEM_SELECTORS = [
  '[data-track-load="description_content"]',
  '[class*="problem-statement" i]',
  '[class*="problem_statement" i]',
  '[class*="question-content" i]',
  '[class*="challenge-instructions" i]',
  '[class*="description" i]',
  '#problem',
  'article',
  'main',
];

function visibleText(el: Element): string {
  const h = el as HTMLElement;
  const r = h.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return '';
  const style = getComputedStyle(h);
  if (style.display === 'none' || style.visibility === 'hidden') return '';
  return (h.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

const isOurs = (el: Element) => !!el.closest('[data-humancoder-overlay]');

/** Visible error/console/output text outside the editor itself. */
export function extractErrors(editorEl: HTMLElement | null): { texts: string[]; elements: HTMLElement[] } {
  const picked: HTMLElement[] = [];
  const texts: string[] = [];
  let total = 0;
  const nodes = document.querySelectorAll<HTMLElement>(ERROR_SELECTORS.join(','));
  for (const el of nodes) {
    if (total >= LIMITS.maxErrorsText) break;
    if (isOurs(el) || (editorEl && (editorEl.contains(el) || el.contains(editorEl)))) continue;
    if (picked.some((p) => p.contains(el) || el.contains(p))) continue;
    const text = visibleText(el);
    if (text.length < 3 || text.length > 4000) continue;
    // Skip big layout containers that merely have "result"/"output" in a class name.
    if (el.querySelectorAll('button, input, select, textarea').length > 3) continue;
    picked.push(el);
    const t = truncate(text, Math.min(1500, LIMITS.maxErrorsText - total));
    texts.push(t);
    total += t.length;
  }
  return { texts, elements: picked };
}

/** A short problem/task description from the page, if one is identifiable. */
export function extractProblemText(editorEl: HTMLElement | null): string {
  for (const sel of PROBLEM_SELECTORS) {
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (isOurs(el) || (editorEl && el.contains(editorEl))) continue;
      const text = visibleText(el);
      if (text.length >= 80) return truncate(text, LIMITS.maxPageContext);
    }
  }
  return '';
}

/** Union of the editor and error-output rectangles, clipped to the viewport (for vision crops). */
export function relevantRect(editorEl: HTMLElement | null, extra: HTMLElement[]): Rect | null {
  const rects = [editorEl, ...extra]
    .filter((e): e is HTMLElement => !!e)
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  if (!rects.length) return null;
  const pad = 16;
  const x1 = Math.max(0, Math.min(...rects.map((r) => r.left)) - pad);
  const y1 = Math.max(0, Math.min(...rects.map((r) => r.top)) - pad);
  const x2 = Math.min(window.innerWidth, Math.max(...rects.map((r) => r.right)) + pad);
  const y2 = Math.min(window.innerHeight, Math.max(...rects.map((r) => r.bottom)) + pad);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
