import { sendToBackground } from '../shared/messages';
import { redactSecrets } from '../shared/redact';
import type { LogEntry, LogLevel, SessionState, SessionStatus } from '../shared/types';

type Patch = Partial<Omit<SessionState, 'logs' | 'tabId'>>;

/** Batches status/log updates to the background (which persists them for the popup). */
export class Reporter {
  private patch: Patch = {};
  private logs: LogEntry[] = [];
  private timer: number | null = null;
  private listeners = new Set<(status: SessionStatus, detail: string) => void>();

  constructor(private readonly debug: boolean) {}

  onStatus(fn: (status: SessionStatus, detail: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  status(status: SessionStatus, detail = '', iteration?: number) {
    this.patch.status = status;
    this.patch.detail = detail;
    if (iteration !== undefined) this.patch.iteration = iteration;
    this.listeners.forEach((l) => l(status, detail));
    this.schedule();
  }

  set(patch: Patch) {
    Object.assign(this.patch, patch);
    this.schedule();
  }

  log(level: LogLevel, msg: string) {
    if (level === 'debug' && !this.debug) return;
    const clean = redactSecrets(msg).slice(0, 500);
    this.logs.push({ t: Date.now(), level, msg: clean });
    if (this.debug) console.debug('[HumanCoder]', clean);
    this.schedule();
  }

  private schedule() {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => void this.flush(), 150);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!Object.keys(this.patch).length && !this.logs.length) return;
    const patch = this.patch;
    const logs = this.logs;
    this.patch = {};
    this.logs = [];
    await sendToBackground({ type: 'SESSION_UPDATE', patch, logs });
  }
}
