import { LIMITS } from '../shared/config';
import { redactSecrets } from '../shared/redact';
import { EMPTY_SESSION, SESSION_KEY, getSession } from '../shared/storage';
import type { LogEntry, LogLevel, SessionState } from '../shared/types';

// chrome.storage.session holds the live session so the popup can show it after being reopened.
// Writes are serialised through a promise chain to avoid lost updates.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export function updateSession(patch: Partial<SessionState>, logs: LogEntry[] = []): Promise<SessionState> {
  return enqueue(async () => {
    const current = await getSession();
    const merged: SessionState = {
      ...current,
      ...patch,
      logs: [...current.logs, ...logs.map((l) => ({ ...l, msg: redactSecrets(String(l.msg)).slice(0, 500) }))].slice(
        -LIMITS.maxLogEntries,
      ),
      updatedAt: Date.now(),
    };
    await chrome.storage.session.set({ [SESSION_KEY]: merged });
    return merged;
  });
}

export function resetSession(tabId: number | null): Promise<SessionState> {
  return enqueue(async () => {
    const fresh: SessionState = { ...EMPTY_SESSION, tabId, updatedAt: Date.now() };
    await chrome.storage.session.set({ [SESSION_KEY]: fresh });
    return fresh;
  });
}

export function sessionLog(level: LogLevel, msg: string): Promise<SessionState> {
  return updateSession({}, [{ t: Date.now(), level, msg }]);
}
