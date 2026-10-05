import { BridgeAdapter } from './BridgeAdapter';

/** CodeMirror 6 (`.cm-editor`), reached through the DOM's `cmView` back-reference. */
export class CodeMirror6Adapter extends BridgeAdapter {
  static readonly selector = '.cm-editor';
  readonly kind = 'codemirror6' as const;
  readonly label = 'CodeMirror 6 editor';
  protected readonly bridgeKind = 'codemirror6' as const;

  detect(): boolean {
    return this.el.matches(CodeMirror6Adapter.selector);
  }
}

/** CodeMirror 5 (`.CodeMirror`), whose wrapper element holds the instance. */
export class CodeMirror5Adapter extends BridgeAdapter {
  static readonly selector = '.CodeMirror';
  readonly kind = 'codemirror5' as const;
  readonly label = 'CodeMirror 5 editor';
  protected readonly bridgeKind = 'codemirror5' as const;

  detect(): boolean {
    return this.el.matches(CodeMirror5Adapter.selector);
  }
}
