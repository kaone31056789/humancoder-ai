import { sendToTab } from '../shared/messages';

/** Explains why a tab can't be scripted, or null if it probably can. */
export function unscriptableReason(url: string | undefined): string | null {
  if (!url) return null; // without the "tabs" permission URLs are hidden; just try
  if (/^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(url)) {
    return 'Browser-internal pages (chrome://, extensions, etc.) cannot be automated.';
  }
  if (/^https:\/\/chromewebstore\.google\.com|^https:\/\/chrome\.google\.com\/webstore/i.test(url)) {
    return 'The Chrome Web Store cannot be automated.';
  }
  return null;
}

/**
 * Injects the MAIN-world bridge and the isolated-world content script into the tab's top frame
 * if they are not already there. Relies on the activeTab grant from the user opening the popup.
 */
export async function ensureInjected(tabId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const ping = await sendToTab(tabId, { type: 'HC_PING' });
  if (ping.ok) return { ok: true };

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['bridge.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (/cannot access|cannot be scripted|permission|activeTab/i.test(msg)) {
      return {
        ok: false,
        error:
          'No permission to access this page. Open the HumanCoder popup on this tab again (that grants access), ' +
          'and for file:// pages enable "Allow access to file URLs" for the extension.',
      };
    }
    return { ok: false, error: `Could not inject into the page: ${msg}` };
  }

  const again = await sendToTab(tabId, { type: 'HC_PING' });
  return again.ok ? { ok: true } : { ok: false, error: 'Injected, but the page script is not responding.' };
}
