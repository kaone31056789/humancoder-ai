import { Icon } from './Icon';

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onUseEditor: () => void;
  readingEditor: boolean;
  /** e.g. "Read from Monaco editor · cpp" */
  sourceNote?: string | null;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

export function CodeBox({ label, value, onChange, onUseEditor, readingEditor, sourceNote, placeholder, rows = 8, disabled }: Props) {
  const lines = value ? value.split('\n').length : 0;
  return (
    <div className="codebox">
      <div className="codebox-head">
        <label className="label" htmlFor="code">
          {label}
        </label>
        <span className="spacer" />
        {lines > 0 && <span className="muted mono small">{lines} {lines === 1 ? 'line' : 'lines'}</span>}
        <button className="link" onClick={onUseEditor} disabled={readingEditor || disabled} title="Copy the code from the editor on the page">
          {readingEditor ? 'Reading…' : (
            <>
              <Icon name="download" size={12} /> From page
            </>
          )}
        </button>
        {value && (
          <button className="link" onClick={() => onChange('')} disabled={disabled}>
            Clear
          </button>
        )}
      </div>
      <textarea
        id="code"
        className="textarea code"
        rows={rows}
        spellCheck={false}
        placeholder={placeholder ?? 'Paste code here…'}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const t = e.currentTarget;
            t.setRangeText('    ', t.selectionStart, t.selectionEnd, 'end');
            onChange(t.value);
          }
        }}
      />
      {sourceNote && <div className="source-note">{sourceNote}</div>}
    </div>
  );
}
