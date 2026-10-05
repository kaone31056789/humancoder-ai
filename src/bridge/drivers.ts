// MAIN-world drivers: each one talks to a specific editor's public API.
// All edits go through the editor's model/document API (not simulated keystrokes), so the
// editor never auto-indents or auto-closes brackets — text lands exactly as requested.

import type { BridgeKind, BridgeState } from '../shared/bridgeProtocol';

export interface Driver {
  getState(): BridgeState;
  setSelection(start: number, end: number): void;
  insert(text: string): void;
  focus(): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

function monacoDriver(el: HTMLElement): Driver {
  const monaco = w.monaco;
  if (!monaco?.editor) throw new Error('Monaco editor found, but this page does not expose its API (window.monaco).');
  const editors: any[] = monaco.editor.getEditors?.() ?? [];
  const ed = editors.find((e) => {
    const node: HTMLElement | null = e.getDomNode?.() ?? null;
    const container: HTMLElement | null = e.getContainerDomNode?.() ?? null;
    return node === el || container === el || (node && (el.contains(node) || node.contains(el)));
  });
  if (!ed) throw new Error('Could not match the Monaco instance to the focused editor element.');
  const model = () => {
    const m = ed.getModel();
    if (!m) throw new Error('Monaco editor has no model attached.');
    return m;
  };
  const offsetOf = (lineNumber: number, column: number) => model().getOffsetAt({ lineNumber, column });

  return {
    getState() {
      const m = model();
      const sel = ed.getSelection();
      const start = offsetOf(sel.startLineNumber, sel.startColumn);
      const end = offsetOf(sel.endLineNumber, sel.endColumn);
      const head = offsetOf(sel.positionLineNumber, sel.positionColumn);
      const readOnly = !!(ed.getRawOptions?.().readOnly ?? false);
      return { code: m.getValue(), start, end, head, language: m.getLanguageId?.() ?? m.getModeId?.() ?? null, readOnly };
    },
    setSelection(start, end) {
      const a = model().getPositionAt(start);
      const b = model().getPositionAt(end);
      ed.setSelection({
        selectionStartLineNumber: a.lineNumber,
        selectionStartColumn: a.column,
        positionLineNumber: b.lineNumber,
        positionColumn: b.column,
      });
      ed.revealPositionInCenterIfOutsideViewport?.(b);
    },
    insert(text) {
      const m = model();
      const sel = ed.getSelection();
      const start = offsetOf(sel.startLineNumber, sel.startColumn);
      const ok = ed.executeEdits('humancoder', [{ range: sel, text, forceMoveMarkers: true }]);
      if (ok === false) throw new Error('Monaco rejected the edit (read-only editor?).');
      // Monaco normalises "\n" to the model EOL; account for that when placing the caret.
      const inserted = text.replace(/\r\n|\n/g, m.getEOL()).length;
      const p = m.getPositionAt(start + inserted);
      ed.setSelection({ selectionStartLineNumber: p.lineNumber, selectionStartColumn: p.column, positionLineNumber: p.lineNumber, positionColumn: p.column });
      ed.revealPositionInCenterIfOutsideViewport?.(p);
    },
    focus() {
      ed.focus();
    },
  };
}

/** Mirrors EditorView.findFromDOM across versions: `cmTile.root.view` (>= 6.38), `cmView.rootView.view` before. */
function findCm6View(el: HTMLElement): any {
  const candidates = [el.querySelector('.cm-content'), el];
  for (const node of candidates) {
    const n = node as any;
    const view = n?.cmTile?.root?.view ?? n?.cmView?.rootView?.view ?? n?.cmView?.view;
    if (view?.state && view?.dispatch) return view;
  }
  return null;
}

function cm6Driver(el: HTMLElement): Driver {
  const view = findCm6View(el);
  if (!view) throw new Error('CodeMirror 6 editor found, but its view object is not reachable.');
  return {
    getState() {
      const r = view.state.selection.main;
      return {
        code: view.state.doc.toString(),
        start: r.from,
        end: r.to,
        head: r.head,
        language: view.contentDOM?.getAttribute('data-language') ?? null,
        readOnly: !!view.state.readOnly,
      };
    },
    setSelection(start, end) {
      view.dispatch({ selection: { anchor: start, head: end }, scrollIntoView: true });
    },
    insert(text) {
      const r = view.state.selection.main;
      view.dispatch({
        changes: { from: r.from, to: r.to, insert: text },
        selection: { anchor: r.from + text.length },
        scrollIntoView: true,
        userEvent: 'input.type',
      });
    },
    focus() {
      view.focus();
    },
  };
}

function cm5Driver(el: HTMLElement): Driver {
  const cm = (el as any).CodeMirror;
  if (!cm?.getValue) throw new Error('CodeMirror 5 editor found, but its instance is not reachable.');
  return {
    getState() {
      const mode = cm.getOption('mode');
      return {
        code: cm.getValue(),
        start: cm.indexFromPos(cm.getCursor('from')),
        end: cm.indexFromPos(cm.getCursor('to')),
        head: cm.indexFromPos(cm.getCursor('head')),
        language: typeof mode === 'string' ? mode : mode?.name ?? null,
        readOnly: !!cm.getOption('readOnly'),
      };
    },
    setSelection(start, end) {
      cm.setSelection(cm.posFromIndex(start), cm.posFromIndex(end));
      cm.scrollIntoView(null);
    },
    insert(text) {
      cm.replaceSelection(text, 'end', '+input');
      cm.scrollIntoView(null);
    },
    focus() {
      cm.focus();
    },
  };
}

function aceDriver(el: HTMLElement): Driver {
  const ed = (el as any).env?.editor ?? w.ace?.edit?.(el);
  if (!ed?.getSession) throw new Error('Ace editor found, but its instance is not reachable.');
  const doc = () => ed.getSession().getDocument();
  return {
    getState() {
      const range = ed.getSelectionRange();
      const lead = ed.selection.getCursor();
      return {
        code: doc().getValue(),
        start: doc().positionToIndex(range.start, 0),
        end: doc().positionToIndex(range.end, 0),
        head: doc().positionToIndex(lead, 0),
        language: ed.getSession().getMode?.()?.$id ?? null,
        readOnly: !!ed.getReadOnly?.(),
      };
    },
    setSelection(start, end) {
      ed.selection.setSelectionRange({ start: doc().indexToPosition(start, 0), end: doc().indexToPosition(end, 0) });
      ed.renderer?.scrollCursorIntoView?.();
    },
    insert(text) {
      // session.replace inserts raw text (editor.insert would apply auto-indent/auto-pairing behaviours).
      const endPos = ed.getSession().replace(ed.getSelectionRange(), text);
      ed.selection.clearSelection();
      ed.selection.moveCursorToPosition(endPos);
      ed.renderer?.scrollCursorIntoView?.();
    },
    focus() {
      ed.focus();
    },
  };
}

export function createDriver(kind: BridgeKind, el: HTMLElement): Driver {
  switch (kind) {
    case 'monaco':
      return monacoDriver(el);
    case 'codemirror6':
      return cm6Driver(el);
    case 'codemirror5':
      return cm5Driver(el);
    case 'ace':
      return aceDriver(el);
  }
}
