// Runs in the page's MAIN world (injected on demand). Answers a fixed set of editor operations
// requested by the content script via window.postMessage. It never evaluates strings as code.

import {
  BRIDGE_REQ,
  BRIDGE_RES,
  TARGET_ATTR,
  type BridgeRequest,
  type BridgeResponse,
} from '../shared/bridgeProtocol';
import { createDriver } from './drivers';

declare global {
  interface Window {
    __humancoderBridge?: boolean;
  }
}

const MAX_TEXT = 20000;

if (!window.__humancoderBridge) {
  window.__humancoderBridge = true;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const req = event.data as BridgeRequest;
    if (!req || req.channel !== BRIDGE_REQ || typeof req.id !== 'number') return;

    const reply = (res: Omit<BridgeResponse, 'channel' | 'id'>) =>
      window.postMessage({ channel: BRIDGE_RES, id: req.id, ...res } satisfies BridgeResponse, '*');

    try {
      if (req.op === 'ping') return reply({ ok: true, result: 'pong' });

      if (typeof req.target !== 'string' || !/^hc-\d+$/.test(req.target) || !req.kind) {
        return reply({ ok: false, error: 'bad request' });
      }
      const el = document.querySelector<HTMLElement>(`[${TARGET_ATTR}="${req.target}"]`);
      if (!el) return reply({ ok: false, error: 'Editor element is no longer on the page.' });

      const driver = createDriver(req.kind, el);
      const { start, end, text } = req.args ?? {};

      switch (req.op) {
        case 'probe': {
          const state = driver.getState();
          return reply({ ok: true, result: { readOnly: state.readOnly, language: state.language } });
        }
        case 'getState':
          return reply({ ok: true, result: driver.getState() });
        case 'setSelection':
          if (!Number.isInteger(start) || !Number.isInteger(end)) return reply({ ok: false, error: 'bad selection' });
          driver.setSelection(start!, end!);
          return reply({ ok: true });
        case 'insert':
          if (typeof text !== 'string' || text.length > MAX_TEXT) return reply({ ok: false, error: 'bad text' });
          driver.insert(text);
          return reply({ ok: true });
        case 'focus':
          driver.focus();
          return reply({ ok: true });
        default:
          return reply({ ok: false, error: 'unknown op' });
      }
    } catch (e) {
      reply({ ok: false, error: (e as Error)?.message ?? String(e) });
    }
  });
}
