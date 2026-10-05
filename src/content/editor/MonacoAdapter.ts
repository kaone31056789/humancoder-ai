import { BridgeAdapter } from './BridgeAdapter';

/** Monaco (VS Code's editor): LeetCode, many online IDEs. Needs `window.monaco` exposed by the page. */
export class MonacoAdapter extends BridgeAdapter {
  static readonly selector = '.monaco-editor';
  readonly kind = 'monaco' as const;
  readonly label = 'Monaco editor';
  protected readonly bridgeKind = 'monaco' as const;

  detect(): boolean {
    return this.el.matches(MonacoAdapter.selector);
  }
}
