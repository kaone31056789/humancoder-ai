import { LIMITS } from '../../shared/config';
import type { TypingMode, TypingProfile } from '../../shared/types';

const MODES: { id: TypingMode; label: string }[] = [
  { id: 'natural', label: 'Natural' },
  { id: 'steady', label: 'Steady' },
  { id: 'fast', label: 'Fast (no delays)' },
];

export function TypingControls({ value, onChange }: { value: TypingProfile; onChange: (v: TypingProfile) => void }) {
  const set = (patch: Partial<TypingProfile>) => onChange({ ...value, ...patch });
  const natural = value.mode === 'natural';
  const fast = value.mode === 'fast';

  return (
    <div className="typing">
      <div className="row">
        <div className="field">
          <label className="label" htmlFor="mode">
            Typing mode
          </label>
          <select id="mode" className="select" value={value.mode} onChange={(e) => set({ mode: e.target.value as TypingMode })}>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="speed">
            Speed <span className="mono speed-val">{fast ? 'max' : `${value.wpm} wpm`}</span>
          </label>
          <input
            id="speed"
            type="range"
            min={LIMITS.wpmMin}
            max={240}
            step={5}
            value={Math.min(240, value.wpm)}
            disabled={fast}
            onChange={(e) => set({ wpm: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="checks">
        <label className={`check ${natural ? '' : 'disabled'}`}>
          <input type="checkbox" checked={value.thinkingPauses} disabled={!natural} onChange={(e) => set({ thinkingPauses: e.target.checked })} />
          Thinking pauses
        </label>
        <label className={`check ${fast ? 'disabled' : ''}`}>
          <input type="checkbox" checked={value.adaptive} disabled={fast} onChange={(e) => set({ adaptive: e.target.checked })} />
          Adaptive timing
        </label>
      </div>
    </div>
  );
}
