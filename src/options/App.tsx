import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, LANGUAGES, LIMITS } from '../shared/config';
import { sendToBackground } from '../shared/messages';
import { clearSavedData, getPublicSettings, getSession, resetSettings, saveSettings, toPublic } from '../shared/storage';
import type { ModelInfo, PublicSettings, TypingMode } from '../shared/types';

type Notice = { tone: 'ok' | 'error' | 'info'; text: string } | null;

function Section({ step, title, hint, children }: { step?: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        {step !== undefined && <span className="step mono">{step}</span>}
        <div>
          <h2>{title}</h2>
          {hint && <p className="muted">{hint}</p>}
        </div>
      </div>
      <div className="section-body">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="opt-field">
      <span className="label">{label}</span>
      {children}
      {hint && <div className="hint muted">{hint}</div>}
    </div>
  );
}

function ModelField(props: { label: string; value: string; onChange: (v: string) => void; models: ModelInfo[]; listId: string; hint: string; disabled?: boolean }) {
  const { label, value, onChange, models, listId, hint, disabled } = props;
  return (
    <Field label={label} hint={hint}>
      <input className="input mono" list={listId} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} spellCheck={false} />
      <datalist id={listId}>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </datalist>
    </Field>
  );
}

export function App() {
  const [s, setS] = useState<PublicSettings | null>(null);
  const [newKey, setNewKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [testing, setTesting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    void getPublicSettings().then(setS);
    void sendToBackground({ type: 'LIST_MODELS' }).then((r) => r.ok && setModels(r.models));
  }, []);

  const visionModels = useMemo(() => models.filter((m) => m.vision), [models]);

  if (!s) return <div className="page muted">Loading…</div>;

  const set = (patch: Partial<PublicSettings>) => {
    setS({ ...s, ...patch });
    setDirty(true);
  };

  const save = async () => {
    const { hasApiKey: _ignored, ...rest } = s;
    const saved = await saveSettings({ ...rest, ...(newKey.trim() ? { apiKey: newKey.trim() } : {}) });
    setS(toPublic(saved));
    setNewKey('');
    setShowKey(false);
    setDirty(false);
    setNotice({ tone: 'ok', text: 'Saved.' });
  };

  const removeKey = async () => {
    const saved = await saveSettings({ apiKey: '' });
    setS(toPublic(saved));
    setNotice({ tone: 'info', text: 'API key removed.' });
  };

  const testKey = async () => {
    setTesting(true);
    setNotice(null);
    const res = await sendToBackground({ type: 'TEST_KEY', apiKey: newKey.trim() || undefined });
    setTesting(false);
    if (!res.ok) return setNotice({ tone: 'error', text: res.error });
    const usage = res.usage != null ? ` · used $${res.usage.toFixed(4)}` : '';
    const limit = res.limit != null ? ` of $${res.limit}` : '';
    setNotice({ tone: 'ok', text: `Key works${usage}${limit}.${newKey.trim() ? ' Press Save to keep it.' : ''}` });
  };

  const clearData = async () => {
    if ((await getSession()).running) return setNotice({ tone: 'error', text: 'Stop the running session first.' });
    if (!confirm('Forget pasted code, tasks, review/explain results, the activity log and the cached model list? Settings and your API key are kept.')) return;
    await clearSavedData();
    setNotice({ tone: 'ok', text: 'Saved data cleared.' });
  };

  const refreshModels = async () => {
    const res = await sendToBackground({ type: 'LIST_MODELS', force: true });
    if (res.ok) {
      setModels(res.models);
      setNotice({ tone: 'info', text: `Loaded ${res.models.length} models from OpenRouter.` });
    } else setNotice({ tone: 'error', text: res.error });
  };

  const reset = async () => {
    if (!confirm('Reset all settings to defaults? Your API key is kept.')) return;
    const saved = await resetSettings(true);
    setS(toPublic(saved));
    setDirty(false);
    setNotice({ tone: 'info', text: 'Settings reset to defaults (API key kept).' });
  };

  const modelHint = (id: string, fallback: string) => {
    const m = models.find((x) => x.id === id);
    if (!m) return models.length ? 'Not in the OpenRouter list — check the ID.' : fallback;
    const price = m.promptPrice != null ? ` · $${(m.promptPrice * 1e6).toFixed(2)}/M tokens` : '';
    return `${m.name}${price}${m.vision ? ' · reads images' : ''}`;
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="brand">
          <span className="logo mono">{'</>'}</span>
          <div>
            <h1 className="mono">HUMANCODER</h1>
            <p className="muted">Settings</p>
          </div>
        </div>
        <div className="head-actions">
          {dirty && <span className="unsaved">Unsaved changes</span>}
          <button className="btn btn-primary" onClick={save} disabled={!dirty && !newKey.trim()}>
            Save
          </button>
        </div>
      </header>

      {notice && <div className={`notice ${notice.tone}`}>{notice.text}</div>}

      <section className="quickstart">
        <h2>Quick start</h2>
        <ol>
          <li>
            <b>Add your OpenRouter key</b> below (only the AI tabs need it; plain typing works without one).
          </li>
          <li>
            On a coding site, <b>click into the editor</b>, then open the HumanCoder popup from the toolbar.
          </li>
          <li>
            Pick a tab — <b>Type</b>, <b>AI Task</b>, <b>Review</b> or <b>Explain</b> — and press its big button.
          </li>
        </ol>
      </section>

      <Section step={1} title="Connect OpenRouter" hint="Stored only in this browser and sent only to openrouter.ai.">
        <Field
          label="API key"
          hint={
            <>
              Get one at <span className="mono">openrouter.ai/keys</span>. {s.hasApiKey ? '✓ A key is saved — type a new one to replace it.' : 'No key saved yet.'}
            </>
          }
        >
          <div className="inline">
            <input
              className="input mono"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder={s.hasApiKey ? '•••••••••••••••• (saved)' : 'sk-or-v1-…'}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
            <button className="btn" onClick={() => setShowKey((v) => !v)} disabled={!newKey}>
              {showKey ? 'Hide' : 'Show'}
            </button>
            <button className="btn" onClick={testKey} disabled={testing || (!newKey.trim() && !s.hasApiKey)}>
              {testing ? 'Testing…' : 'Test'}
            </button>
            {s.hasApiKey && (
              <button className="btn btn-danger" onClick={removeKey}>
                Remove
              </button>
            )}
          </div>
        </Field>
      </Section>

      <Section step={2} title="AI models" hint="Any OpenRouter model ID works. Start typing to search the list.">
        <ModelField
          label="Coding model — AI Task & Review"
          value={s.model}
          onChange={(model) => set({ model })}
          models={models}
          listId="m-code"
          hint={modelHint(s.model, 'e.g. qwen/qwen-2.5-coder-32b-instruct')}
        />
        <ModelField
          label="Explain model — Explain tab"
          value={s.explainModel}
          onChange={(explainModel) => set({ explainModel })}
          models={models}
          listId="m-explain"
          hint={modelHint(s.explainModel, 'Default: google/gemini-2.5-flash. Try google/gemini-2.5-pro for deeper algorithm explanations.')}
        />
        <button className="link" onClick={refreshModels}>
          ↻ Refresh model list from OpenRouter
        </button>
      </Section>

      <Section step={3} title="Typing" hint="How text is typed into the page. You can also change this from the popup's Options.">
        <div className="grid2">
          <Field label="Style">
            <select className="select" value={s.typing.mode} onChange={(e) => set({ typing: { ...s.typing, mode: e.target.value as TypingMode } })}>
              <option value="natural">Natural — varied, human-like rhythm</option>
              <option value="steady">Steady — even pace</option>
              <option value="fast">Fast — no delays</option>
            </select>
          </Field>
          <Field label={`Speed — ${s.typing.wpm} words per minute`}>
            <input
              type="range"
              min={LIMITS.wpmMin}
              max={240}
              step={5}
              value={Math.min(240, s.typing.wpm)}
              disabled={s.typing.mode === 'fast'}
              onChange={(e) => set({ typing: { ...s.typing, wpm: Number(e.target.value) } })}
            />
          </Field>
        </div>
        <div className="checks-row">
          <label className="check">
            <input type="checkbox" checked={s.typing.thinkingPauses} disabled={s.typing.mode !== 'natural'} onChange={(e) => set({ typing: { ...s.typing, thinkingPauses: e.target.checked } })} />
            Thinking pauses
          </label>
          <label className="check">
            <input type="checkbox" checked={s.typing.adaptive} disabled={s.typing.mode === 'fast'} onChange={(e) => set({ typing: { ...s.typing, adaptive: e.target.checked } })} />
            Adaptive timing
          </label>
        </div>
        <Field label="Default language">
          <select className="select narrow" value={s.language} onChange={(e) => set({ language: e.target.value })}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section step={4} title="Privacy" hint="What leaves your browser, and what the extension remembers.">
        <ul className="facts">
          <li>Your code and prompts go only to OpenRouter (and the AI provider it picks), and only when you press an AI button.</li>
          <li>Requests don't include an app name or website, so OpenRouter can't tell which app sent them.</li>
          <li>Nothing is collected by the extension itself: no analytics, no tracking.</li>
        </ul>
        <label className="check">
          <input type="checkbox" checked={s.privateProviders} onChange={(e) => set({ privateProviders: e.target.checked })} />
          Don't store my data: only use AI providers that don't keep or train on prompts
        </label>
        <div className="hint muted">Some models have no such provider. If a request fails because of this, pick another model or turn it off.</div>
        <div>
          <button className="btn" onClick={clearData}>
            Clear saved data
          </button>
          <span className="hint muted inline-hint">Pasted code, tasks, results, activity log. Keeps settings &amp; key.</span>
        </div>
      </Section>

      <section className="section advanced">
        <button className="adv-toggle" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
          <h2>Advanced</h2>
          <span className="muted">{advanced ? 'Hide' : 'Agent limits, vision, timeouts, diagnostics'} {advanced ? '▴' : '▾'}</span>
        </button>
        {advanced && (
          <div className="section-body">
            <Field label="Max AI Task steps" hint={`1–${LIMITS.maxIterationsCeiling}. Each step is one AI call plus its edits. Raise this if tasks stop early.`}>
              <input
                className="input narrow"
                type="number"
                min={LIMITS.minIterations}
                max={LIMITS.maxIterationsCeiling}
                value={s.maxIterations}
                onChange={(e) => set({ maxIterations: Number(e.target.value) })}
              />
            </Field>
            <label className="check">
              <input type="checkbox" checked={s.includePageContext} onChange={(e) => set({ includePageContext: e.target.checked })} />
              Let AI Task read the problem description on the page
            </label>
            <label className="check">
              <input type="checkbox" checked={s.visionEnabled} onChange={(e) => set({ visionEnabled: e.target.checked })} />
              Vision mode — allow screenshot inspections of the editor area when the page can't be read directly
            </label>
            {s.visionEnabled && (
              <ModelField
                label="Vision model"
                value={s.visionModel}
                onChange={(visionModel) => set({ visionModel })}
                models={visionModels}
                listId="m-vision"
                hint={modelHint(s.visionModel, 'Must accept images, e.g. google/gemini-2.5-flash')}
              />
            )}
            <Field label="AI request timeout (seconds)">
              <input
                className="input narrow"
                type="number"
                min={LIMITS.minTimeoutMs / 1000}
                max={LIMITS.maxTimeoutMs / 1000}
                value={Math.round(s.requestTimeoutMs / 1000)}
                onChange={(e) => set({ requestTimeoutMs: Number(e.target.value) * 1000 })}
              />
            </Field>
            <label className="check">
              <input type="checkbox" checked={s.debug} onChange={(e) => set({ debug: e.target.checked })} />
              Debug logging (more detail in Activity; API keys are always hidden)
            </label>
            <div>
              <button className="btn btn-danger" onClick={reset}>
                Reset all settings
              </button>
            </div>
          </div>
        )}
      </section>

      <p className="muted foot">
        Defaults: coding <span className="mono">{DEFAULT_SETTINGS.model}</span>, explain <span className="mono">{DEFAULT_SETTINGS.explainModel}</span>.
      </p>
    </div>
  );
}
