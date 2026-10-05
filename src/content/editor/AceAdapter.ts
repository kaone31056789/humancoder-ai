import { BridgeAdapter } from './BridgeAdapter';

/** Ace editor (`.ace_editor`), e.g. HackerRank, Codewars-style sites. */
export class AceAdapter extends BridgeAdapter {
  static readonly selector = '.ace_editor';
  readonly kind = 'ace' as const;
  readonly label = 'Ace editor';
  protected readonly bridgeKind = 'ace' as const;

  detect(): boolean {
    return this.el.matches(AceAdapter.selector);
  }
}
