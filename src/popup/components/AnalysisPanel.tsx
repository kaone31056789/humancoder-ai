import { useEffect, useMemo, useState } from 'react';
import { fixItems } from '../../shared/fixes';
import type { CodeAnalysis } from '../../shared/types';
import { Icon } from './Icon';

interface Props {
  analysis: CodeAnalysis;
  /** Why fixing is unavailable (no key, session running…), or null when it's allowed. */
  blockedReason: string | null;
  busy: 'editor' | 'pasted' | null;
  onFixEditor: (fixes: string[]) => void;
  onFixPasted: (fixes: string[]) => void;
  onClose: () => void;
}

export function AnalysisPanel({ analysis, blockedReason, busy, onFixEditor, onFixPasted, onClose }: Props) {
  const items = useMemo(() => fixItems(analysis), [analysis]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set(items.filter((i) => i.preselected).map((i) => i.id))), [items]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const chosen = items.filter((i) => selected.has(i.id)).map((i) => i.label);
  const disabled = !!blockedReason || busy !== null || chosen.length === 0;

  return (
    <section className="card analysis">
      <div className="card-head">
        <span className="label">Analysis · {analysis.language}</span>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close analysis">
          ✕
        </button>
      </div>
      <p className="analysis-summary">{analysis.summary}</p>

      {items.length === 0 ? (
        <p className="no-issues">✓ No issues found.</p>
      ) : (
        <ul className="fix-list">
          {analysis.issues.map((issue, k) => (
            <li key={`i${k}`} className={`sev-${issue.severity}`}>
              <label className="fix-item">
                <input type="checkbox" checked={selected.has(`i${k}`)} onChange={() => toggle(`i${k}`)} />
                <span className="sev mono">{issue.severity}</span>
                {issue.line ? <span className="mono muted">L{issue.line}</span> : null}
                <span>{issue.message}</span>
              </label>
            </li>
          ))}
          {analysis.suggestions.map((s, k) => (
            <li key={`s${k}`} className="suggestion">
              <label className="fix-item">
                <input type="checkbox" checked={selected.has(`s${k}`)} onChange={() => toggle(`s${k}`)} />
                <span className="sev mono sev-sugg">tip</span>
                <span>{s}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <>
          <div className="fix-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={disabled}
              onClick={() => onFixEditor(chosen)}
              title="Run the agent: it edits the code in the page's editor with small, verified changes"
            >
              <Icon name="sparkles" size={14} />
              {busy === 'editor' ? 'Starting…' : `Fix in editor (${chosen.length})`}
            </button>
            <button
              className="btn btn-sm"
              disabled={disabled}
              onClick={() => onFixPasted(chosen)}
              title="Rewrite the code in the Code input box; then use Start Writing to type it"
            >
              {busy === 'pasted' ? 'Fixing…' : 'Fix pasted code'}
            </button>
          </div>
          {blockedReason && <div className="fix-hint muted">{blockedReason}</div>}
        </>
      )}
    </section>
  );
}
