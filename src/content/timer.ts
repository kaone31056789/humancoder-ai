// Timing that keeps working when the tab is in the background.
// Chrome throttles page timers in hidden tabs (>= 1s per timer, and about once per minute after
// 5 minutes hidden), which would stall typing. While the page is hidden we ask the background
// service worker — whose timers are not throttled by tab visibility — to wake us up instead.

import { sendToBackground } from '../shared/messages';

export const isHidden = (): boolean => document.visibilityState === 'hidden';

export async function pageAwareWait(ms: number): Promise<void> {
  if (ms <= 0) return;
  if (isHidden()) {
    const res = await sendToBackground({ type: 'TIMER', ms });
    if (res.ok) return;
    // Background unreachable (e.g. extension reloaded): fall back to a regular timer.
  }
  await new Promise((r) => setTimeout(r, ms));
}

/** Yields to the event loop without setTimeout (MessageChannel callbacks are not throttled). */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}
