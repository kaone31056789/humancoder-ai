// Protocol between the isolated-world content script and the MAIN-world bridge script.
// Editor objects (Monaco, CodeMirror, Ace instances) only exist in the page's JS world, so the
// content script asks the bridge to perform a fixed set of operations on them.
// The bridge never evaluates code: it dispatches on `op` to hard-coded handlers.

export const BRIDGE_REQ = 'humancoder:bridge:req';
export const BRIDGE_RES = 'humancoder:bridge:res';
export const TARGET_ATTR = 'data-humancoder-target';

export type BridgeKind = 'monaco' | 'codemirror6' | 'codemirror5' | 'ace';
export type BridgeOp = 'ping' | 'probe' | 'getState' | 'setSelection' | 'insert' | 'focus';

export interface BridgeRequest {
  channel: typeof BRIDGE_REQ;
  id: number;
  op: BridgeOp;
  kind?: BridgeKind;
  target?: string;
  args?: { start?: number; end?: number; text?: string };
}

export interface BridgeResponse {
  channel: typeof BRIDGE_RES;
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface BridgeState {
  code: string;
  start: number;
  end: number;
  head: number;
  language: string | null;
  readOnly: boolean;
}
