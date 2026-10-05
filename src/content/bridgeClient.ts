import {
  BRIDGE_REQ,
  BRIDGE_RES,
  type BridgeKind,
  type BridgeOp,
  type BridgeRequest,
  type BridgeResponse,
} from '../shared/bridgeProtocol';

let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const res = event.data as BridgeResponse;
    if (!res || res.channel !== BRIDGE_RES || typeof res.id !== 'number') return;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    clearTimeout(p.timer);
    if (res.ok) p.resolve(res.result);
    else p.reject(new Error(res.error ?? 'Bridge error'));
  });
}

/** Calls an operation on the MAIN-world bridge. Rejects on error or after `timeoutMs`. */
export function bridgeCall<T = unknown>(
  op: BridgeOp,
  opts: { kind?: BridgeKind; target?: string; args?: BridgeRequest['args'] } = {},
  timeoutMs = 3000,
): Promise<T> {
  listen();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error('The page bridge did not respond (page scripts may be blocked or the page is busy).'));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    const req: BridgeRequest = { channel: BRIDGE_REQ, id, op, ...opts };
    window.postMessage(req, '*');
  });
}
