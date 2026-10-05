import { BaseAdapter, isOtherEditable, type EditorState } from './BaseAdapter';
import { buildModel, offsetToPoint, pointToOffset } from './contentEditableModel';
import type { FocusState } from './EditorAdapter';

/**
 * Generic contenteditable editors. Text offsets are derived from the DOM (text nodes, <br>, blocks),
 * which is exact for simple markup and approximate for rich editors with decorations.
 */
export class ContentEditableAdapter extends BaseAdapter {
  readonly kind = 'contenteditable' as const;
  readonly label = 'Contenteditable editor';
  override readonly exactOffsets = false;
  private last = { start: 0, end: 0 };

  static matches(el: Element | null): el is HTMLElement {
    return el instanceof HTMLElement && el.isContentEditable && !el.closest('[data-humancoder-overlay]');
  }

  /** Walks up to the editing host so we operate on the whole editor, not an inner span. */
  static hostOf(el: HTMLElement): HTMLElement {
    let host = el;
    while (host.parentElement?.isContentEditable) host = host.parentElement;
    return host;
  }

  detect(): boolean {
    return this.el.isContentEditable;
  }

  protected async readState(): Promise<EditorState> {
    const model = buildModel(this.el);
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && sel.anchorNode && sel.focusNode && this.el.contains(sel.anchorNode)) {
      const a = pointToOffset(model, this.el, sel.anchorNode, sel.anchorOffset);
      const f = pointToOffset(model, this.el, sel.focusNode, sel.focusOffset);
      this.last = { start: Math.min(a, f), end: Math.max(a, f) };
      return { code: model.text, start: this.last.start, end: this.last.end, head: f };
    }
    const start = Math.min(this.last.start, model.text.length);
    const end = Math.min(this.last.end, model.text.length);
    return { code: model.text, start, end, head: end };
  }

  protected async writeSelection(start: number, end: number): Promise<void> {
    const model = buildModel(this.el);
    const a = offsetToPoint(model, this.el, start);
    const b = offsetToPoint(model, this.el, end);
    window.getSelection()?.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
    this.last = { start, end };
  }

  private async ensureSelectionInside() {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || !this.el.contains(sel.anchorNode)) {
      this.el.focus({ preventScroll: true });
      await this.writeSelection(this.last.start, this.last.end);
    }
  }

  protected async insert(text: string): Promise<void> {
    await this.ensureSelectionInside();
    const pieces = text.split('\n');
    for (let i = 0; i < pieces.length; i++) {
      if (i > 0 && !exec('insertLineBreak')) this.manualInsert(document.createElement('br'));
      if (pieces[i] && !exec('insertText', pieces[i])) this.manualInsert(document.createTextNode(pieces[i]));
    }
    await this.readState(); // refresh `last`
  }

  protected async removeSelection(): Promise<void> {
    await this.ensureSelectionInside();
    if (!exec('delete')) {
      const sel = window.getSelection();
      if (sel?.rangeCount) {
        sel.getRangeAt(0).deleteContents();
        this.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      }
    }
    await this.readState();
  }

  private manualInsert(node: Node) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    this.el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: node.nodeName === 'BR' ? 'insertLineBreak' : 'insertText',
        data: node.textContent,
      }),
    );
  }

  async ensureFocus(): Promise<FocusState> {
    const active = document.activeElement;
    if (active === this.el || (active && this.el.contains(active))) return 'ok';
    if (isOtherEditable(active, this.el)) return 'lost';
    this.el.focus({ preventScroll: true });
    await this.writeSelection(this.last.start, this.last.end);
    return 'refocused';
  }
}

function exec(command: string, value?: string): boolean {
  try {
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
}
