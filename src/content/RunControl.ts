import { StopError } from '../ai/Agent';

export type RunState = 'running' | 'paused' | 'stopped';

const timeoutWait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Shared pause / resume / stop switch for the typing engine and the agent loop. */
export class RunControl {
  /**
   * @param wait   timer used by sleep(); the content script passes one that survives background tabs
   * @param hidden when true, sleeps use longer slices (fewer wake-ups) at the cost of slower stop response
   */
  constructor(
    private readonly wait: (ms: number) => Promise<void> = timeoutWait,
    private readonly hidden: () => boolean = () => false,
  ) {}

  private _state: RunState = 'running';
  private _pauseReason = '';
  private resumeWaiters: (() => void)[] = [];
  private listeners = new Set<(state: RunState, reason: string) => void>();

  get state(): RunState {
    return this._state;
  }

  get pauseReason(): string {
    return this._pauseReason;
  }

  onChange(fn: (state: RunState, reason: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(state: RunState, reason = '') {
    if (this._state === 'stopped') return; // terminal
    this._state = state;
    this._pauseReason = state === 'paused' ? reason : '';
    if (state !== 'paused') {
      const waiters = this.resumeWaiters;
      this.resumeWaiters = [];
      waiters.forEach((w) => w());
    }
    this.listeners.forEach((l) => l(state, reason));
  }

  pause(reason = 'Paused'): void {
    if (this._state === 'running') this.set('paused', reason);
  }

  resume(): void {
    if (this._state === 'paused') this.set('running');
  }

  toggle(): void {
    if (this._state === 'paused') this.resume();
    else this.pause();
  }

  stop(): void {
    this.set('stopped');
  }

  /** Blocks while paused; throws StopError once stopped. */
  async checkpoint(): Promise<void> {
    while (this._state === 'paused') {
      await new Promise<void>((r) => this.resumeWaiters.push(r));
    }
    if (this._state === 'stopped') throw new StopError();
  }

  /** Sleeps for `ms` of *running* time: paused time doesn't count, stop interrupts within ~25ms (~250ms when hidden). */
  async sleep(ms: number): Promise<void> {
    let remaining = Math.max(0, ms);
    await this.checkpoint();
    while (remaining > 0) {
      const step = Math.min(remaining, this.hidden() ? 250 : 25);
      await this.wait(step);
      remaining -= step;
      await this.checkpoint();
    }
  }
}
