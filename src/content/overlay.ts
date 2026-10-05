// Small in-page HUD shown while a session runs, so the user can pause/stop without reopening
// the popup (which closes as soon as the page gets focus). Isolated in a closed shadow root.

import type { SessionStatus } from '../shared/types';

const COLORS: Partial<Record<SessionStatus, string>> = {
  planning: '#a78bfa',
  analyzing: '#a78bfa',
  typing: '#3ddc84',
  inspecting: '#38bdf8',
  correcting: '#fbbf24',
  paused: '#fbbf24',
  finished: '#3ddc84',
  stopped: '#94a3b8',
  error: '#f87171',
};

export class Overlay {
  private host: HTMLElement | null = null;
  private dot!: HTMLElement;
  private text!: HTMLElement;
  private pauseBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private hideTimer: number | null = null;

  constructor(private readonly handlers: { onTogglePause: () => void; onStop: () => void }) {}

  private mount() {
    if (this.host?.isConnected) return;
    const host = document.createElement('humancoder-hud');
    host.setAttribute('data-humancoder-overlay', '');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .hud { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; align-items: center; gap: 8px;
          padding: 8px 10px; border-radius: 10px; background: #0d1117ee; border: 1px solid #30363d; color: #e6edf3;
          font: 12px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; box-shadow: 0 6px 24px #0008; max-width: 360px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #3ddc84; flex: none; }
        .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        button { font: inherit; color: #e6edf3; background: #21262d; border: 1px solid #30363d; border-radius: 6px; padding: 3px 8px; cursor: pointer; }
        button:hover { background: #30363d; }
        .brand { color: #3ddc84; font-weight: 700; }
      </style>
      <div class="hud" role="status">
        <span class="dot"></span><span class="brand">HC</span><span class="text"></span>
        <button class="pause" title="Pause / resume (Alt+Shift+P)">Pause</button>
        <button class="stop" title="Stop (Alt+Shift+X)">Stop</button>
      </div>`;
    this.dot = root.querySelector('.dot')!;
    this.text = root.querySelector('.text')!;
    this.pauseBtn = root.querySelector('.pause')!;
    this.stopBtn = root.querySelector<HTMLButtonElement>('.stop')!;
    // mousedown preventDefault keeps focus (and the caret) in the editor.
    for (const b of [this.pauseBtn, this.stopBtn]) b.addEventListener('mousedown', (e) => e.preventDefault());
    this.pauseBtn.addEventListener('click', () => this.handlers.onTogglePause());
    this.stopBtn.addEventListener('click', () => this.handlers.onStop());
    document.documentElement.appendChild(host);
    this.host = host;
  }

  update(status: SessionStatus, detail: string) {
    this.mount();
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.dot.style.background = COLORS[status] ?? '#94a3b8';
    this.text.textContent = `${status}${detail ? ' · ' + detail : ''}`;
    this.pauseBtn.textContent = status === 'paused' ? 'Resume' : 'Pause';
    const terminal = status === 'finished' || status === 'stopped' || status === 'error';
    this.pauseBtn.style.display = terminal ? 'none' : '';
    this.stopBtn.style.display = terminal ? 'none' : '';
    if (terminal) this.hideTimer = window.setTimeout(() => this.remove(), 6000);
  }

  remove() {
    this.host?.remove();
    this.host = null;
  }
}
