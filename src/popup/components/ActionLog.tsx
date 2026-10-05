import { useEffect, useRef } from 'react';
import type { LogEntry } from '../../shared/types';

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });

/** Collapsible activity log; folded away unless the user wants the details. */
export function ActionLog({ logs, open, onToggle, onClear, canClear }: { logs: LogEntry[]; open: boolean; onToggle: () => void; onClear: () => void; canClear: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length, open]);
  const errors = logs.filter((l) => l.level === 'error').length;

  return (
    <section className={`drawer log-drawer ${open ? 'open' : ''}`}>
      <button className="drawer-head" onClick={onToggle} aria-expanded={open}>
        <span className="drawer-title">Activity</span>
        <span className="drawer-summary">
          {logs.length ? `${logs.length} entr${logs.length === 1 ? 'y' : 'ies'}` : 'nothing yet'}
          {errors ? <span className="tone-danger"> · {errors} error{errors > 1 ? 's' : ''}</span> : null}
        </span>
        <span className="chev">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="drawer-body">
          <div className="log mono" ref={ref}>
            {logs.length === 0 ? (
              <div className="log-empty">No activity yet.</div>
            ) : (
              logs.map((l, i) => (
                <div key={i} className={`log-row lv-${l.level}`}>
                  <span className="log-t">{time(l.t)}</span>
                  <span className="log-m">{l.msg}</span>
                </div>
              ))
            )}
          </div>
          {logs.length > 0 && (
            <button className="link" onClick={onClear} disabled={!canClear}>
              Clear log
            </button>
          )}
        </div>
      )}
    </section>
  );
}
