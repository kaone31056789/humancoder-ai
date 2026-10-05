import { useEffect, useRef, useState } from 'react';
import { EMPTY_SESSION, SESSION_KEY, getSession } from '../shared/storage';
import type { SessionState } from '../shared/types';

/** Live view of the session state the background persists in chrome.storage.session. */
export function useSession(): SessionState {
  const [session, setSession] = useState<SessionState>(EMPTY_SESSION);
  useEffect(() => {
    void getSession().then(setSession);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[SESSION_KEY]) {
        setSession({ ...EMPTY_SESSION, ...(changes[SESSION_KEY].newValue as Partial<SessionState> | undefined) });
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return session;
}

export function useActiveTabId(): number | null {
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setId(tab?.id ?? null));
  }, []);
  return id;
}

/** Calls `fn` with the latest value once it has been stable for `ms`. */
export function useDebouncedEffect<T>(value: T, ms: number, fn: (v: T) => void, enabled = true) {
  const first = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!enabled) return;
    const t = setTimeout(() => fnRef.current(value), ms);
    return () => clearTimeout(t);
  }, [value, ms, enabled]);
}
