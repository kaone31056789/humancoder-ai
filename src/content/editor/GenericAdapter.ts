import { BaseAdapter, isOtherEditable, type EditorState } from './BaseAdapter';
import type { FocusState } from './EditorAdapter';

type TextField = HTMLTextAreaElement | HTMLInputElement;

/**
 * Plain <textarea> (and text <input>) editors — also covers many custom editors built on a textarea.
 * Uses execCommand('insertText') so the page sees real input events and undo works; falls back to
 * setRangeText + a synthetic InputEvent when execCommand is unavailable or blocked.
 */
export class GenericAdapter extends BaseAdapter {
  readonly kind = 'textarea' as const;
  readonly label = 'Textarea editor';

  constructor(private readonly field: TextField) {
    super(field);
  }

  static matches(el: Element | null): el is TextField {
    if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
    if (el instanceof HTMLInputElement) return ['text', 'search', ''].includes(el.type) && !el.disabled && !el.readOnly;
    return false;
  }

  detect(): boolean {
    return GenericAdapter.matches(this.field);
  }

  protected async readState(): Promise<EditorState> {
    const f = this.field;
    const start = f.selectionStart ?? f.value.length;
    const end = f.selectionEnd ?? start;
    const head = f.selectionDirection === 'backward' ? start : end;
    return { code: f.value, start, end, head };
  }

  protected async writeSelection(start: number, end: number): Promise<void> {
    this.field.setSelectionRange(start, end);
  }

  protected async insert(text: string): Promise<void> {
    const f = this.field;
    const start = f.selectionStart ?? f.value.length;
    const end = f.selectionEnd ?? start;
    const before = f.value;

    this.focusIfNeeded();
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch {
      ok = false;
    }
    const applied = ok && f.value.slice(start, start + text.length) === text;
    if (applied) return;
    if (f.value !== before) return; // the page reacted to the input itself; the engine's verification decides

    f.setRangeText(text, start, end, 'end');
    f.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  protected async removeSelection(): Promise<void> {
    const f = this.field;
    const start = f.selectionStart ?? 0;
    const end = f.selectionEnd ?? start;
    if (start === end) return;
    const before = f.value;

    this.focusIfNeeded();
    let ok = false;
    try {
      ok = document.execCommand('delete', false);
    } catch {
      ok = false;
    }
    if (ok && f.value.length === before.length - (end - start)) return;
    if (f.value !== before) return;

    f.setRangeText('', start, end, 'end');
    f.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  }

  private focusIfNeeded() {
    if (document.activeElement !== this.field) {
      const { selectionStart, selectionEnd } = this.field;
      this.field.focus({ preventScroll: true });
      if (selectionStart != null && selectionEnd != null) this.field.setSelectionRange(selectionStart, selectionEnd);
    }
  }

  async ensureFocus(): Promise<FocusState> {
    const active = document.activeElement;
    if (active === this.field) return 'ok';
    if (isOtherEditable(active, this.field)) return 'lost';
    this.focusIfNeeded();
    return 'refocused';
  }
}
