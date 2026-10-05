import type { PopupMode } from '../../shared/storage';
import { Icon, type IconName } from './Icon';

export const MODES: { id: PopupMode; icon: IconName; label: string; hint: string }[] = [
  { id: 'type', icon: 'keyboard', label: 'Type', hint: 'Types your code into the editor on the page, keystroke by keystroke.' },
  { id: 'agent', icon: 'sparkles', label: 'AI Task', hint: 'Tell the AI what to change. It edits the editor and checks its own work.' },
  { id: 'review', icon: 'review', label: 'Review', hint: 'Finds problems in your code, then fixes the ones you pick.' },
  { id: 'explain', icon: 'explain', label: 'Explain', hint: 'Explains code, then writes it into a text box or as code comments.' },
];

export function ModeTabs({ mode, onChange, disabled }: { mode: PopupMode; onChange: (m: PopupMode) => void; disabled: boolean }) {
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  return (
    <nav>
      <div className="mode-tabs" role="tablist">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            className={mode === m.id ? 'active' : ''}
            onClick={() => onChange(m.id)}
            disabled={disabled && mode !== m.id}
          >
            <Icon name={m.icon} size={20} className="mode-icon" />
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <p className="mode-hint">{current.hint}</p>
    </nav>
  );
}
