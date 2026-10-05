import type { ExplainOptions } from '../../shared/storage';
import { EXPLANATION_TYPES } from '../../shared/types';

/** Explanation type chips + optional line range. */
export function ExplainControls({ value, onChange, disabled }: { value: ExplainOptions; onChange: (v: ExplainOptions) => void; disabled?: boolean }) {
  const set = (patch: Partial<ExplainOptions>) => onChange({ ...value, ...patch });
  const num = (s: string) => s.replace(/[^\d]/g, '').slice(0, 6);
  return (
    <div className="explain-controls">
      <span className="label">Explanation type</span>
      <div className="chips" role="radiogroup">
        {EXPLANATION_TYPES.map((t) => (
          <button key={t} role="radio" aria-checked={value.style === t} className={`chip ${value.style === t ? 'active' : ''}`} onClick={() => set({ style: t })} disabled={disabled}>
            {t}
          </button>
        ))}
      </div>
      <div className="range-row">
        <span className="muted small">Lines</span>
        <input className="input mini" inputMode="numeric" placeholder="from" aria-label="Lines from" value={value.from} onChange={(e) => set({ from: num(e.target.value) })} disabled={disabled} />
        <span className="muted small">to</span>
        <input className="input mini" inputMode="numeric" placeholder="to" aria-label="Lines to" value={value.to} onChange={(e) => set({ to: num(e.target.value) })} disabled={disabled} />
        <span className="muted small">{value.from ? '' : '(empty = whole code)'}</span>
        <span className="spacer" />
        <label className="check small">
          <input type="checkbox" checked={value.detailed} onChange={(e) => set({ detailed: e.target.checked })} disabled={disabled} />
          Detailed
        </label>
      </div>
    </div>
  );
}
