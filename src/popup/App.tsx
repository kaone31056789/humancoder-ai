import { useEffect, useState } from 'react';
import { buildCommentInsertions, explanationToText } from '../shared/comments';
import { buildFixTask } from '../shared/fixes';
import { detectLanguage } from '../shared/language';
import { sendToBackground, type BackgroundRequest } from '../shared/messages';
import {
  DEFAULT_EXPLAIN,
  getDraft,
  getPublicSettings,
  getSavedAnalysis,
  getSavedExplanation,
  saveAnalysis,
  saveDraft,
  saveExplanation,
  saveSettings,
  type ExplainOptions,
  type PopupMode,
  type SavedAnalysis,
  type SavedExplanation,
} from '../shared/storage';
import type { PublicSettings, SessionStatus } from '../shared/types';
import { ActionLog } from './components/ActionLog';
import { AnalysisPanel } from './components/AnalysisPanel';
import { CodeBox } from './components/CodeBox';
import { EditorTarget, type DetectState } from './components/EditorTarget';
import { ExplainControls } from './components/ExplainControls';
import { ExplanationPanel } from './components/ExplanationPanel';
import { Icon, type IconName } from './components/Icon';
import { ModeTabs } from './components/ModeTabs';
import { OptionsDrawer } from './components/OptionsDrawer';
import { RunCard } from './components/RunCard';
import { useActiveTabId, useDebouncedEffect, useSession } from './hooks';

type StartRequest = Extract<BackgroundRequest, { type: 'START' }>['request'];
type Busy = null | 'read' | 'start' | 'review' | 'explain' | 'write' | 'fix-editor' | 'fix-pasted';

export function App() {
  const tabId = useActiveTabId();
  const session = useSession();
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<PopupMode>('type');
  const [code, setCode] = useState('');
  const [task, setTask] = useState('');
  const [explainOpts, setExplainOpts] = useState<ExplainOptions>(DEFAULT_EXPLAIN);
  const [analysis, setAnalysisState] = useState<SavedAnalysis | null>(null);
  const [explanation, setExplanationState] = useState<SavedExplanation | null>(null);
  const [sourceNote, setSourceNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [target, setTarget] = useState<DetectState | null>(null);
  const [detecting, setDetecting] = useState(false);

  const setAnalysis = (a: SavedAnalysis | null) => {
    setAnalysisState(a);
    void saveAnalysis(a);
  };
  const setExplanation = (e: SavedExplanation | null) => {
    setExplanationState(e);
    void saveExplanation(e);
  };

  useEffect(() => {
    void Promise.all([getPublicSettings(), getDraft(), getSavedAnalysis(), getSavedExplanation()]).then(([s, d, a, ex]) => {
      setSettings(s);
      setCode(d.code);
      setTask(d.task);
      setMode(d.mode);
      setExplainOpts(d.explain);
      setAnalysisState(a);
      setExplanationState(ex);
      setShowReference(!!d.code.trim() && d.mode === 'agent');
      setLoaded(true);
    });
  }, []);

  useDebouncedEffect({ code, task, mode, explain: explainOpts }, 300, (d) => void saveDraft(d), loaded);
  useDebouncedEffect(explanation, 400, (e) => void saveExplanation(e), loaded);

  const sessionHere = session.tabId !== null && session.tabId === tabId;
  const running = sessionHere && session.running;

  // Typing changes apply to a running session immediately and become the new default.
  useDebouncedEffect(
    settings?.typing,
    250,
    (typing) => {
      if (!typing) return;
      void saveSettings({ typing });
      if (running && tabId !== null) void sendToBackground({ type: 'CONTROL', tabId, command: 'setTyping', typing });
    },
    loaded,
  );

  const detect = async () => {
    if (tabId === null) return;
    setDetecting(true);
    const res = await sendToBackground({ type: 'DETECT', tabId });
    setDetecting(false);
    setTarget(res.ok ? { info: res.editor, reason: res.reason } : { info: null, reason: res.error });
  };

  // Check the page's editor as soon as the popup opens, so the target is visible before starting.
  useEffect(() => {
    if (tabId !== null) void detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Errors are easier to understand with the log open.
  useEffect(() => {
    if (sessionHere && session.status === 'error') setLogOpen(true);
  }, [sessionHere, session.status]);

  if (!settings) return <div className="popup loading">Loading…</div>;

  const patchSettings = (patch: Partial<PublicSettings>) => {
    setSettings({ ...settings, ...patch });
    const { typing: _t, hasApiKey: _k, ...persist } = patch;
    if (Object.keys(persist).length) void saveSettings(persist);
  };

  const begin = (b: Busy) => {
    setBusy(b);
    setError(null);
    setInfo(null);
  };

  // ---- shared helpers ----

  const readEditor = async (): Promise<string | null> => {
    if (tabId === null) return null;
    setBusy('read');
    setError(null);
    const res = await sendToBackground({ type: 'READ_EDITOR', tabId, preferCode: true });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    setCode(res.code);
    setSourceNote(`From ${res.editor.label}${res.language ? ` · ${res.language}` : ''}`);
    setTarget({ info: res.editor });
    return res.code;
  };

  /** The pasted code, or the page editor's code when nothing is pasted. */
  const sourceCode = async () => (code.trim() ? code : (await readEditor()) ?? '');
  const langFor = (src: string) => (settings.language === 'auto' ? detectLanguage(src) ?? 'auto' : settings.language);

  const start = async (request: StartRequest) => {
    if (tabId === null) return;
    const res = await sendToBackground({ type: 'START', tabId, request });
    if (!res.ok) setError(res.error);
  };
  const base = () => ({ task: '', code: '', language: settings.language, model: settings.model, typing: settings.typing, includePageContext: settings.includePageContext });

  // ---- actions per tab ----

  const startTyping = async () => {
    begin('start');
    await start({ ...base(), mode: 'type', code });
    setBusy(null);
  };

  const runTask = async () => {
    begin('start');
    await start({ ...base(), mode: 'agent', code, task });
    setBusy(null);
  };

  const review = async () => {
    begin('review');
    setAnalysis(null);
    const src = await sourceCode();
    const language = langFor(src);
    const res = await sendToBackground({ type: 'ANALYZE', code: src, language, model: settings.model });
    setBusy(null);
    if (res.ok) setAnalysis({ analysis: res.analysis, code: src, language });
    else setError(res.error);
  };

  const fixInEditor = async (fixes: string[]) => {
    if (!analysis) return;
    begin('fix-editor');
    await start({ ...base(), mode: 'agent', code: analysis.code, task: buildFixTask(fixes), language: analysis.language });
    setBusy(null);
  };

  const fixPasted = async (fixes: string[]) => {
    if (!analysis) return;
    begin('fix-pasted');
    const res = await sendToBackground({ type: 'FIX_CODE', code: analysis.code, language: analysis.language, fixes, model: settings.model });
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setCode(res.code);
    setSourceNote('Corrected by AI');
    setMode('type');
    setInfo('The corrected code is in the Type tab. Click into the editor on the page, then press Start typing.' + (res.changes.length ? `\nChanges: ${res.changes.join('; ')}` : ''));
  };

  const explain = async () => {
    begin('explain');
    const src = await sourceCode();
    const from = Number(explainOpts.from);
    const to = Number(explainOpts.to || explainOpts.from);
    const ranged = explainOpts.from !== '' && from >= 1;
    const language = langFor(src);
    const res = await sendToBackground({
      type: 'EXPLAIN',
      code: src,
      language,
      style: explainOpts.style,
      range: ranged ? { from, to: Math.max(from, to) } : null,
      detailed: explainOpts.detailed,
      model: settings.explainModel,
    });
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setExplanation({ explanation: res.explanation, code: src, language, ranged, text: explanationToText(res.explanation, ranged) });
  };

  const writeExplanation = async () => {
    if (!explanation) return;
    begin('write');
    if (explainOpts.target === 'page') {
      await start({ ...base(), mode: 'type', code: explanation.text });
    } else {
      const lang = explanation.language === 'auto' ? detectLanguage(explanation.code) ?? 'cpp' : explanation.language;
      const comments = buildCommentInsertions(
        explanation.code,
        lang,
        explanation.explanation.annotations,
        explanation.ranged ? undefined : explanation.explanation.summary,
      );
      await start({ ...base(), mode: 'comments', comments });
    }
    setBusy(null);
  };

  const control = (command: 'toggle' | 'stop') => tabId !== null && void sendToBackground({ type: 'CONTROL', tabId, command });

  // ---- derived UI state ----

  const needsKey = !settings.hasApiKey;
  const aiMode = mode !== 'type';
  const thinking = busy === 'review' || busy === 'explain' || busy === 'fix-pasted';
  const showRun = thinking || (sessionHere && session.status !== 'idle');
  const runStatus: SessionStatus = thinking ? 'analyzing' : session.status;
  const runDetail = thinking
    ? `${busy === 'explain' ? 'Explaining' : busy === 'review' ? 'Reviewing' : 'Fixing'} with ${(busy === 'explain' ? settings.explainModel : settings.model).split('/').pop()}`
    : session.detail;
  const locked = running || busy !== null || tabId === null;
  const writeBlocked = running ? 'Wait for the current run to finish.' : null;

  const primary = (() => {
    switch (mode) {
      case 'type':
        return { icon: 'play' as IconName, label: busy === 'start' ? 'Starting…' : 'Start typing', onClick: startTyping, disabled: locked || !code.trim() };
      case 'agent':
        return { icon: 'sparkles' as IconName, label: busy === 'start' ? 'Starting…' : 'Run AI task', onClick: runTask, disabled: locked || needsKey || !(task.trim() || code.trim()) };
      case 'review':
        return { icon: 'review' as IconName, label: busy === 'review' ? 'Reviewing…' : 'Review code', onClick: review, disabled: locked || needsKey };
      case 'explain':
        return { icon: 'explain' as IconName, label: busy === 'explain' ? 'Explaining…' : 'Explain code', onClick: explain, disabled: locked || needsKey };
    }
  })();

  return (
    <div className="popup">
      <header className="header">
        <div className="brand">
          <span className="logo mono">{'</>'}</span>
          <span className="title mono">HUMANCODER</span>
        </div>
        <button className="icon-btn" onClick={() => chrome.runtime.openOptionsPage()} title="Settings" aria-label="Settings">
          <Icon name="settings" size={17} />
        </button>
      </header>

      {showRun && (
        <RunCard
          status={runStatus}
          detail={runDetail}
          iteration={sessionHere ? session.iteration : 0}
          maxIterations={sessionHere ? session.maxIterations : 0}
          running={running}
          onToggle={() => control('toggle')}
          onStop={() => control('stop')}
          onDismiss={() => void sendToBackground({ type: 'CLEAR_SESSION' })}
        />
      )}

      <ModeTabs mode={mode} onChange={setMode} disabled={running} />

      <EditorTarget state={target} detecting={detecting} onDetect={detect} disabled={tabId === null} />

      {aiMode && needsKey && (
        <div className="banner">
          This tab needs an OpenRouter API key. <a onClick={() => chrome.runtime.openOptionsPage()}>Add it in Settings →</a>
        </div>
      )}

      <main className="mode-body">
        {mode === 'type' && (
          <>
            <CodeBox label="Code to type" value={code} onChange={setCode} onUseEditor={readEditor} readingEditor={busy === 'read'} sourceNote={sourceNote} rows={10} />
            <p className="tip">Click into the editor on the page where the code should go, then press Start.</p>
          </>
        )}

        {mode === 'agent' && (
          <>
            <div className="field">
              <label className="label" htmlFor="task">
                What should the AI do?
              </label>
              <textarea
                id="task"
                className="textarea task"
                rows={3}
                placeholder={'e.g. "Complete the solve() function"\nor "Fix the compile error"'}
                value={task}
                onChange={(e) => setTask(e.target.value)}
              />
            </div>
            {showReference ? (
              <CodeBox label="Reference code (optional)" value={code} onChange={setCode} onUseEditor={readEditor} readingEditor={busy === 'read'} sourceNote={sourceNote} rows={5} />
            ) : (
              <button className="link add-ref" onClick={() => setShowReference(true)}>
                + Add reference code (optional)
              </button>
            )}
            <p className="tip">The AI reads the editor on the page, so click into it first.</p>
          </>
        )}

        {mode === 'review' && (
          <CodeBox
            label="Code to review"
            value={code}
            onChange={setCode}
            onUseEditor={readEditor}
            readingEditor={busy === 'read'}
            sourceNote={sourceNote}
            placeholder="Paste code, or leave empty to review the code in the page's editor."
            rows={7}
          />
        )}

        {mode === 'explain' && (
          <>
            <ExplainControls value={explainOpts} onChange={setExplainOpts} />
            <CodeBox
              label="Code to explain"
              value={code}
              onChange={setCode}
              onUseEditor={readEditor}
              readingEditor={busy === 'read'}
              sourceNote={sourceNote}
              placeholder="Paste code, or leave empty to explain the code in the page's editor."
              rows={6}
            />
          </>
        )}

        {running ? (
          // While a run is active, the main button becomes the controls for it.
          <div className="run-controls">
            <button className="btn btn-lg" onClick={() => control('toggle')}>
              <Icon name={session.status === 'paused' ? 'play' : 'pause'} size={17} />
              {session.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button className="btn btn-lg btn-danger" onClick={() => control('stop')}>
              <Icon name="stop" size={17} />
              Stop
            </button>
          </div>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={primary.onClick} disabled={primary.disabled}>
            <Icon name={primary.icon} size={17} />
            {primary.label}
          </button>
        )}

        {error && <div className="banner error">{error}</div>}
        {info && <div className="banner ok">{info}</div>}

        {mode === 'review' && analysis && (
          <AnalysisPanel
            analysis={analysis.analysis}
            busy={busy === 'fix-editor' ? 'editor' : busy === 'fix-pasted' ? 'pasted' : null}
            blockedReason={needsKey ? 'Add an OpenRouter API key in Settings to apply fixes.' : writeBlocked}
            onFixEditor={fixInEditor}
            onFixPasted={fixPasted}
            onClose={() => setAnalysis(null)}
          />
        )}

        {mode === 'explain' && explanation && (
          <ExplanationPanel
            saved={explanation}
            target={explainOpts.target}
            onTarget={(target) => setExplainOpts({ ...explainOpts, target })}
            onText={(text) => setExplanationState({ ...explanation, text })}
            onWrite={writeExplanation}
            blockedReason={writeBlocked}
            busy={busy === 'write'}
            onClose={() => setExplanation(null)}
          />
        )}
      </main>

      <OptionsDrawer
        open={optionsOpen}
        onToggle={() => setOptionsOpen((o) => !o)}
        language={settings.language}
        onLanguage={(language) => patchSettings({ language })}
        model={mode === 'type' ? null : mode === 'explain' ? settings.explainModel : settings.model}
        modelLabel={mode === 'explain' ? 'Explain model' : 'AI model'}
        onModel={(m) => patchSettings(mode === 'explain' ? { explainModel: m } : { model: m })}
        typing={settings.typing}
        onTyping={(typing) => setSettings({ ...settings, typing })}
      />

      <ActionLog
        logs={sessionHere ? session.logs : []}
        open={logOpen}
        onToggle={() => setLogOpen((o) => !o)}
        canClear={!running}
        onClear={() => void sendToBackground({ type: 'CLEAR_SESSION' })}
      />

      <footer className="foot">
        <span className="mono">Alt+Shift+P</span> pause · <span className="mono">Alt+Shift+X</span> stop
      </footer>
    </div>
  );
}
