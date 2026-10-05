import { useMemo } from 'react';
import { LANGUAGES, SUGGESTED_MODELS } from '../../shared/config';
import type { TypingProfile } from '../../shared/types';
import { TypingControls } from './TypingControls';

interface Props {
  open: boolean;
  onToggle: () => void;
  language: string;
  onLanguage: (l: string) => void;
  /** null hides the model picker (plain typing needs no AI). */
  model: string | null;
  modelLabel: string;
  onModel: (m: string) => void;
  typing: TypingProfile;
  onTyping: (t: TypingProfile) => void;
}

const shortModel = (id: string) => SUGGESTED_MODELS.find((m) => m.id === id)?.label.replace(/\s*\(.*\)$/, '') ?? id.split('/').pop() ?? id;

/** Rarely-changed knobs, folded into one line with a summary of the current values. */
export function OptionsDrawer({ open, onToggle, language, onLanguage, model, modelLabel, onModel, typing, onTyping }: Props) {
  const models = useMemo(() => {
    const list = [...SUGGESTED_MODELS];
    if (model && !list.some((m) => m.id === model)) list.unshift({ id: model, label: model });
    return list;
  }, [model]);

  const lang = LANGUAGES.find((l) => l.id === language)?.label ?? language;
  const speed = typing.mode === 'fast' ? 'Fast' : `${typing.mode === 'natural' ? 'Natural' : 'Steady'} ${typing.wpm} wpm`;
  const summary = [speed, lang === 'Auto-detect' ? 'Auto language' : lang, model ? shortModel(model) : null].filter(Boolean).join(' · ');

  return (
    <section className={`drawer ${open ? 'open' : ''}`}>
      <button className="drawer-head" onClick={onToggle} aria-expanded={open}>
        <span className="drawer-title">Options</span>
        <span className="drawer-summary">{summary}</span>
        <span className="chev">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="drawer-body">
          <div className="row">
            <div className="field">
              <label className="label" htmlFor="lang">
                Language
              </label>
              <select id="lang" className="select" value={language} onChange={(e) => onLanguage(e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            {model !== null && (
              <div className="field">
                <label className="label" htmlFor="model">
                  {modelLabel}
                </label>
                <select id="model" className="select" value={model} onChange={(e) => onModel(e.target.value)}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <TypingControls value={typing} onChange={onTyping} />
        </div>
      )}
    </section>
  );
}
