import type { Rect } from '../shared/types';

const MAX_WIDTH = 1600;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Captures the visible tab once and crops it to the relevant region (editor + error output)
 * so only what the task needs is sent to the vision model. Called only on explicit inspection.
 */
export async function captureRegion(
  windowId: number,
  rect: Rect | null,
  viewport: { width: number; height: number },
): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  // Map CSS pixels to screenshot pixels (accounts for devicePixelRatio and zoom).
  const sx = bitmap.width / Math.max(1, viewport.width);
  const sy = bitmap.height / Math.max(1, viewport.height);
  const r = rect ?? { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const cx = Math.max(0, Math.floor(r.x * sx));
  const cy = Math.max(0, Math.floor(r.y * sy));
  const cw = Math.max(1, Math.min(bitmap.width - cx, Math.ceil(r.width * sx)));
  const ch = Math.max(1, Math.min(bitmap.height - cy, Math.ceil(r.height * sy)));

  const scale = Math.min(1, MAX_WIDTH / cw);
  const canvas = new OffscreenCanvas(Math.round(cw * scale), Math.round(ch * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable for screenshot cropping');
  ctx.drawImage(bitmap, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  return `data:image/jpeg;base64,${toBase64(await out.arrayBuffer())}`;
}
