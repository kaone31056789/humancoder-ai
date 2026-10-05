import { useState } from 'react';
import type { SavedExplanation } from '../../shared/storage';

interface Props {
  saved: SavedExplanation;
  target: 'page' | 'comments';
  onTarget: (t: 'page' | 'comments') => void;
  onText: (text: string) => void;
  onWrite: () => void;
  /** Why writing is unavailable right now, or null. */
  blockedReason: string | null;
  busy: boolean;
  onClose: () => void;
}

const range = (a: { fromLine: number; toLine: number }) => (a.fromLine === a.toLine ? `L${a.fromLine}` : `L${a.fromLine}–${a.toLine}`);

export function ExplanationPanel({ saved, target, onTarget, onText, onWrite, blockedReason, busy, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const { explanation } = saved;

  const copy = async () => {
    await navigator.clipboard.writeText(saved.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section className="card explanation">
      <div className="card-head">
        <span className="label">Explanation</span>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close explanation">
          ✕
        </button>
      </div>

      {target === 'page' ? (
        <>
          <textarea className="textarea explain-text" rows={7} value={saved.text} onChange={(e) => onText(e.target.value)} spellCheck />
          <div className="hint muted small">Editable. Click into the page's explanation box, reopen this popup, then press Write.</div>
        </>
      ) : (
        <>
          <ul className="annotations">
            {explanation.annotations.map((a, i) => (
              <li key={i}>
                <span className="mono ann-range">{range(a)}</span>
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
          <div className="hint muted small">Each note becomes a comment above its first line in the code editor. Your code itself is not changed.</div>
        </>
      )}

      <div className="write-to">
        <span className="label">Write to</span>
        <div className="seg" role="radiogroup">
          <button role="radio" aria-checked={target === 'page'} className={target === 'page' ? 'active' : ''} onClick={() => onTarget('page')}>
            Text box on page
          </button>
          <button role="radio" aria-checked={target === 'comments'} className={target === 'comments' ? 'active' : ''} onClick={() => onTarget('comments')}>
            Comments in code
          </button>
        </div>
      </div>

      <div className="fix-actions">
        <button className="btn btn-primary btn-sm" onClick={onWrite} disabled={!!blockedReason || busy}>
          {busy ? 'Starting…' : target === 'page' ? '✎ Write into text box' : '✎ Add comments to code'}
        </button>
        <button className="btn btn-sm" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy text'}
        </button>
      </div>
      {blockedReason && <div className="fix-hint muted">{blockedReason}</div>}
    </section>
  );
}
