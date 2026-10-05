// Editor detection. Adapters are tried in priority order: the editor holding focus first,
// then visible API-backed editors (Monaco/CodeMirror/Ace), then textareas, then contenteditables.
// To support a new editor: add an adapter class and register it in BRIDGE_TYPES (or the DOM tiers).

import { AceAdapter } from './AceAdapter';
import { CodeMirror5Adapter, CodeMirror6Adapter } from './CodeMirrorAdapter';
import { ContentEditableAdapter } from './ContentEditableAdapter';
import type { EditorAdapter } from './EditorAdapter';
import { GenericAdapter } from './GenericAdapter';
import { MonacoAdapter } from './MonacoAdapter';

const BRIDGE_TYPES: { selector: string; create: (el: HTMLElement) => EditorAdapter }[] = [
  { selector: MonacoAdapter.selector, create: (el) => new MonacoAdapter(el) },
  { selector: CodeMirror6Adapter.selector, create: (el) => new CodeMirror6Adapter(el) },
  { selector: CodeMirror5Adapter.selector, create: (el) => new CodeMirror5Adapter(el) },
  { selector: AceAdapter.selector, create: (el) => new AceAdapter(el) },
];
const CODE_EDITOR_SELECTOR = BRIDGE_TYPES.map((t) => t.selector).join(',');

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 20 || r.height < 10) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
}

const area = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
};

/** document.activeElement, descending into open shadow roots. */
export function deepActiveElement(): Element | null {
  let a: Element | null = document.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

export interface DetectOptions {
  /** Prefer real code editors over a focused plain text box (e.g. an explanation field). */
  preferCode?: boolean;
  /** False when only reading: read-only editors are acceptable. */
  forWriting?: boolean;
}

function candidates(opts: DetectOptions = {}): EditorAdapter[] {
  const list: EditorAdapter[] = [];
  const seen = new Set<Element>();
  const add = (el: HTMLElement, make: () => EditorAdapter) => {
    if (seen.has(el)) return;
    seen.add(el);
    list.push(make());
  };

  // 1. Whatever editor currently holds focus.
  const active = deepActiveElement();
  if (active && active !== document.body && !active.closest('[data-humancoder-overlay]')) {
    let matched = false;
    for (const t of BRIDGE_TYPES) {
      const host = active.closest<HTMLElement>(t.selector);
      if (host) {
        add(host, () => t.create(host));
        matched = true;
        break;
      }
    }
    if (!matched && opts.preferCode) {
      // Defer the focused text box until after real code editors (added below).
    } else if (!matched && GenericAdapter.matches(active)) add(active, () => new GenericAdapter(active));
    else if (!matched && ContentEditableAdapter.matches(active)) {
      const host = ContentEditableAdapter.hostOf(active);
      add(host, () => new ContentEditableAdapter(host));
    }
  }

  // 2. Visible API-backed code editors, largest first.
  const codeEditors: { el: HTMLElement; t: (typeof BRIDGE_TYPES)[number] }[] = [];
  for (const t of BRIDGE_TYPES) {
    document.querySelectorAll<HTMLElement>(t.selector).forEach((el) => {
      if (isVisible(el) && !el.parentElement?.closest(CODE_EDITOR_SELECTOR)) codeEditors.push({ el, t });
    });
  }
  codeEditors.sort((a, b) => area(b.el) - area(a.el)).forEach(({ el, t }) => add(el, () => t.create(el)));

  if (opts.preferCode && active) {
    if (GenericAdapter.matches(active)) add(active as HTMLElement, () => new GenericAdapter(active));
    else if (ContentEditableAdapter.matches(active)) {
      const host = ContentEditableAdapter.hostOf(active);
      add(host, () => new ContentEditableAdapter(host));
    }
  }

  // 3. Plain textareas, then 4. contenteditable hosts (outside code editors).
  [...document.querySelectorAll('textarea')]
    .filter((el) => GenericAdapter.matches(el) && isVisible(el) && !el.closest(CODE_EDITOR_SELECTOR))
    .sort((a, b) => area(b) - area(a))
    .forEach((el) => add(el, () => new GenericAdapter(el)));

  [...document.querySelectorAll<HTMLElement>('[contenteditable]')]
    .filter((el) => ContentEditableAdapter.matches(el) && isVisible(el) && !el.closest(CODE_EDITOR_SELECTOR))
    .map((el) => ContentEditableAdapter.hostOf(el))
    .sort((a, b) => area(b) - area(a))
    .forEach((el) => add(el, () => new ContentEditableAdapter(el)));

  return list;
}

export interface DetectionResult {
  adapter: EditorAdapter | null;
  reason?: string;
}

/** All usable editors in priority order (attached), for callers that pick by content. */
export async function detectEditors(opts: DetectOptions = {}, max = 6): Promise<EditorAdapter[]> {
  const out: EditorAdapter[] = [];
  for (const adapter of candidates(opts).slice(0, max)) {
    if (!(await adapter.attach({ forWriting: opts.forWriting !== false }))) out.push(adapter);
  }
  return out;
}

/** Finds and attaches to the most relevant editor. Reports why each candidate failed. */
export async function detectEditor(opts: DetectOptions = {}): Promise<DetectionResult> {
  const found = candidates(opts);
  if (!found.length) {
    return {
      adapter: null,
      reason: 'No supported editor found. Supported: Monaco, CodeMirror 5/6, Ace, textarea, contenteditable. Click into the editor first.',
    };
  }
  const problems: string[] = [];
  for (const adapter of found.slice(0, 6)) {
    const problem = await adapter.attach({ forWriting: opts.forWriting !== false });
    if (!problem) return { adapter };
    problems.push(`${adapter.label}: ${problem}`);
  }
  return { adapter: null, reason: problems.join(' | ') };
}
