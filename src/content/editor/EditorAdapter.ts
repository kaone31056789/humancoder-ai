import type { KeyName } from '../../ai/schemas';
import type { CursorPosition, EditorKind } from '../../shared/types';

export type FocusState = 'ok' | 'refocused' | 'lost';

/**
 * Uniform interface over every supported editor implementation.
 * Offsets are 0-based character indices into getCode().
 */
export interface EditorAdapter {
  readonly kind: EditorKind;
  readonly label: string;
  /** False when offsets are approximate (contenteditable with complex markup). */
  readonly exactOffsets: boolean;

  /** True if the element this adapter was created for still looks like its editor type. */
  detect(): boolean;
  /** Prepare for interaction (e.g. confirm page API access). Returns a reason string on failure.
   *  With forWriting=false, read-only editors are accepted (for reading code). */
  attach(opts?: { forWriting?: boolean }): Promise<string | null>;
  /** The element is still in the document. */
  isAlive(): boolean;
  element(): HTMLElement;

  getCode(): Promise<string>;
  getCursorPosition(): Promise<CursorPosition>;
  getSelectedText(): Promise<string>;
  getLanguage(): Promise<string | null>;

  /** Inserts text at the caret, replacing the selection. Literal: no auto-indent / auto-close. */
  type(text: string): Promise<void>;
  pressKey(key: KeyName): Promise<void>;
  select(start: number, end: number): Promise<void>;
  /** Deletes the current selection (no-op when collapsed). */
  deleteSelection(): Promise<void>;

  /** Make sure input goes to this editor. 'lost' = the user moved focus to another input. */
  ensureFocus(): Promise<FocusState>;
}

export class EditorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditorError';
  }
}
