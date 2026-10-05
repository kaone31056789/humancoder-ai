import type { SessionStatus } from '../../shared/types';
import { Icon } from './Icon';

const META: Record<SessionStatus, { icon: string; label: string; tone: string }> = {
  idle: { icon: '○', label: 'Idle', tone: 'muted' },
  detecting: { icon: '●', label: 'Finding the editor', tone: 'info' },
  analyzing: { icon: '●', label: 'AI is thinking', tone: 'violet' },
  planning: { icon: '●', label: 'Planning', tone: 'violet' },
  typing: { icon: '●', label: 'Typing', tone: 'accent' },
  inspecting: { icon: '●', label: 'Checking the editor', tone: 'info' },
  correcting: { icon: '●', label: 'Fixing mistakes', tone: 'warn' },
  paused: { icon: '❚❚', label: 'Paused', tone: 'warn' },
  finished: { icon: '✓', label: 'Done', tone: 'accent' },
  stopped: { icon: '■', label: 'Stopped', tone: 'muted' },
  error: { icon: '✕', label: 'Something went wrong', tone: 'danger' },
};

const ACTIVE = new Set<SessionStatus>(['detecting', 'analyzing', 'planning', 'typing', 'inspecting', 'correcting']);

interface Props {
  status: SessionStatus;
  detail: string;
  iteration: number;
  maxIterations: number;
  /** A page session is running (pause/stop apply). */
  running: boolean;
  onToggle: () => void;
  onStop: () => void;
  onDismiss: () => void;
}

/** One card that shows what's happening right now, with the only controls that matter at that moment. */
export function RunCard({ status, detail, iteration, maxIterations, running, onToggle, onStop, onDismiss }: Props) {
  const m = META[status];
  const terminal = status === 'finished' || status === 'stopped' || status === 'error';
  return (
    <section className={`run-card tone-border-${m.tone}`} aria-live="polite">
      <div className="run-top">
        <span className={`run-dot tone-${m.tone} ${ACTIVE.has(status) ? 'pulse' : ''}`}>{m.icon}</span>
        <span className={`run-label tone-${m.tone}`}>{m.label}</span>
        {maxIterations > 0 && iteration > 0 && !terminal && (
          <span className="run-step mono">
            step {iteration}/{maxIterations}
          </span>
        )}
        <span className="spacer" />
        {running && (
          <>
            <button className="btn btn-sm" onClick={onToggle}>
              <Icon name={status === 'paused' ? 'play' : 'pause'} size={13} />
              {status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button className="btn btn-sm btn-danger" onClick={onStop}>
              <Icon name="stop" size={13} />
              Stop
            </button>
          </>
        )}
        {terminal && (
          <button className="btn btn-ghost btn-sm" onClick={onDismiss} aria-label="Dismiss">
            ✕
          </button>
        )}
      </div>
      {detail && <div className="run-detail">{detail}</div>}
    </section>
  );
}
