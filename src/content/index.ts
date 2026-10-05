// Content script entry (isolated world). Injected on demand by the background worker via
// chrome.scripting when the user acts from the popup — never automatically on every page.

import type { ContentRequest } from '../shared/messages';
import { SessionRunner } from './runner';

declare global {
  interface Window {
    __humancoderContent?: boolean;
  }
}

if (!window.__humancoderContent) {
  window.__humancoderContent = true;
  const runner = new SessionRunner();

  chrome.runtime.onMessage.addListener((msg: ContentRequest, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    const respond = (p: Promise<unknown> | unknown) =>
      Promise.resolve(p)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: (e as Error)?.message ?? String(e) }));

    switch (msg?.type) {
      case 'HC_PING':
        sendResponse({ ok: true, running: runner.isRunning() });
        return false;
      case 'HC_DETECT':
        respond(runner.detect());
        return true;
      case 'HC_READ':
        respond(runner.read(!!msg.preferCode));
        return true;
      case 'HC_RUN':
        sendResponse(runner.start(msg.request));
        return false;
      case 'HC_CONTROL':
        sendResponse(runner.handleControl(msg.command, msg.typing));
        return false;
      default:
        return false;
    }
  });
}
