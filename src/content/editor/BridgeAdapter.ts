import { normalizeLanguage } from '../../shared/language';
import { TARGET_ATTR, type BridgeKind, type BridgeState } from '../../shared/bridgeProtocol';
import { bridgeCall } from '../bridgeClient';
import { BaseAdapter, type EditorState } from './BaseAdapter';
import { EditorError } from './EditorAdapter';

let nextTarget = 0;

/** Base for editors whose API lives in the page's JS world (Monaco, CodeMirror, Ace). */
export abstract class BridgeAdapter extends BaseAdapter {
  protected abstract readonly bridgeKind: BridgeKind;
  private readonly target: string;

  constructor(el: HTMLElement) {
    super(el);
    const existing = el.getAttribute(TARGET_ATTR);
    this.target = existing && /^hc-\d+$/.test(existing) ? existing : `hc-${Date.now()}${++nextTarget}`;
    if (existing !== this.target) el.setAttribute(TARGET_ATTR, this.target);
  }

  private call<T>(op: 'probe' | 'getState' | 'setSelection' | 'insert' | 'focus', args?: { start?: number; end?: number; text?: string }) {
    return bridgeCall<T>(op, { kind: this.bridgeKind, target: this.target, args });
  }

  override async attach(opts: { forWriting?: boolean } = {}): Promise<string | null> {
    const forWriting = opts.forWriting !== false;
    try {
      const info = await this.call<{ readOnly: boolean }>('probe');
      if (!forWriting) return null;
      if (info.readOnly) return `${this.label} is read-only.`;
      await this.call('focus');
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  protected async readState(): Promise<EditorState> {
    const s = await this.call<BridgeState>('getState');
    if (!s || typeof s.code !== 'string') throw new EditorError('Bridge returned an invalid editor state.');
    return { code: s.code, start: s.start, end: s.end, head: s.head };
  }

  protected async writeSelection(start: number, end: number): Promise<void> {
    await this.call('setSelection', { start, end });
  }

  protected async insert(text: string): Promise<void> {
    await this.call('insert', { text });
  }

  protected async removeSelection(): Promise<void> {
    await this.call('insert', { text: '' });
  }

  override async getLanguage(): Promise<string | null> {
    const s = await this.call<BridgeState>('getState');
    return normalizeLanguage(s.language);
  }
}
