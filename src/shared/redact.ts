/** Removes anything that looks like an API key / bearer token before text is logged or displayed. */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-or-[A-Za-z0-9_-]{8,}/g, 'sk-or-***')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-***')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1***');
}
