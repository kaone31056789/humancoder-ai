import type { KeyName } from '../../ai/schemas';
import { cursorFrom, detectIndentUnit, lineColToOffset, offsetToLineCol } from '../../shared/text';
import type { CursorPosition, EditorKind } from '../../shared/types';
import type { EditorAdapter, FocusState } from './EditorAdapter';

export interface EditorState {
  code: string;
  /** Always start <= end. */
  start: number;
  end: number;
  /** Caret end of the selection (start or end). */
  head: number;
}

/**
 * Implements the full EditorAdapter on top of four primitives. Key presses are translated into
 * explicit edits/caret moves so behaviour is identical (and deterministic) across editors.
 */
export abstract class BaseAdapter implements EditorAdapter {
  abstract readonly kind: EditorKind;
  abstract readonly label: string;
  readonly exactOffsets: boolean = true;

  constructor(protected readonly el: HTMLElement) {}

  protected abstract readState(): Promise<EditorState>;
  protected abstract writeSelection(start: number, end: number): Promise<void>;
  /** Replace the selection with text and leave a collapsed caret after it. */
  protected abstract insert(text: string): Promise<void>;
  protected abstract removeSelection(): Promise<void>;

  abstract detect(): boolean;

  async attach(_opts?: { forWriting?: boolean }): Promise<string | null> {
    return null;
  }

  isAlive(): boolean {
    return this.el.isConnected;
  }

  element(): HTMLElement {
    return this.el;
  }

  async getCode(): Promise<string> {
    return (await this.readState()).code;
  }

  async getCursorPosition(): Promise<CursorPosition> {
    const s = await this.readState();
    return cursorFrom(s.code, s.start, s.end, s.head);
  }

  async getSelectedText(): Promise<string> {
    const s = await this.readState();
    return s.code.slice(s.start, s.end);
  }

  async getLanguage(): Promise<string | null> {
    return null;
  }

  async type(text: string): Promise<void> {
    if (text) await this.insert(text);
  }

  async select(start: number, end: number): Promise<void> {
    const { code } = await this.readState();
    const a = Math.max(0, Math.min(start, code.length));
    const b = Math.max(0, Math.min(end, code.length));
    await this.writeSelection(Math.min(a, b), Math.max(a, b));
  }

  async deleteSelection(): Promise<void> {
    const s = await this.readState();
    if (s.start !== s.end) await this.removeSelection();
  }

  async ensureFocus(): Promise<FocusState> {
    return 'ok';
  }

  async pressKey(key: KeyName): Promise<void> {
    const s = await this.readState();
    const { code, start, end, head } = s;
    const collapsed = start === end;
    const caret = (o: number) => this.writeSelection(o, o);

    switch (key) {
      case 'ENTER':
        return this.insert('\n');
      case 'TAB':
        return this.insert(detectIndentUnit(code));
      case 'BACKSPACE': {
        if (!collapsed) return this.removeSelection();
        if (start === 0) return;
        const width = isLowSurrogate(code.charCodeAt(start - 1)) && start >= 2 ? 2 : 1;
        await this.writeSelection(start - width, start);
        return this.removeSelection();
      }
      case 'DELETE': {
        if (!collapsed) return this.removeSelection();
        if (start >= code.length) return;
        const width = isHighSurrogate(code.charCodeAt(start)) ? 2 : 1;
        await this.writeSelection(start, start + width);
        return this.removeSelection();
      }
      case 'ARROW_LEFT':
        return caret(collapsed ? Math.max(0, start - 1) : start);
      case 'ARROW_RIGHT':
        return caret(collapsed ? Math.min(code.length, end + 1) : end);
      case 'ARROW_UP':
      case 'ARROW_DOWN': {
        const { line, column } = offsetToLineCol(code, head);
        const target = key === 'ARROW_UP' ? line - 1 : line + 1;
        const off = lineColToOffset(code, target, column);
        return caret(off ?? (key === 'ARROW_UP' ? 0 : code.length));
      }
      case 'HOME': {
        const { line } = offsetToLineCol(code, head);
        return caret(lineColToOffset(code, line, 1) ?? 0);
      }
      case 'END': {
        const { line } = offsetToLineCol(code, head);
        return caret(lineColToOffset(code, line, Number.MAX_SAFE_INTEGER) ?? code.length);
      }
      case 'ESCAPE':
        return caret(head);
    }
  }
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** A focusable element that isn't the target editor: typing there means the user moved on. */
export function isOtherEditable(active: Element | null, target: HTMLElement): boolean {
  if (!active || active === document.body || target.contains(active)) return false;
  if (active.closest('[data-humancoder-overlay]')) return false;
  const el = active as HTMLElement;
  return (
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'range'].includes(el.type)) ||
    el.isContentEditable
  );
}
