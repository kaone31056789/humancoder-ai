import type { EditorInfo } from '../../shared/types';

export interface DetectState {
  info: EditorInfo | null;
  reason?: string;
}

/** Shows which editor on the page HumanCoder will use, with a re-check button. */
export function EditorTarget({ state, detecting, onDetect, disabled }: { state: DetectState | null; detecting: boolean; onDetect: () => void; disabled: boolean }) {
  const found = !!state?.info;
  const text = detecting
    ? 'Looking for an editor…'
    : state?.info
      ? `${state.info.label} · ${state.info.language ?? 'unknown language'} · ${state.info.lineCount} ${state.info.lineCount === 1 ? 'line' : 'lines'}`
      : state
        ? state.reason ?? 'No editor found'
        : 'Not checked yet';

  return (
    <div className={`target ${found ? 'ok' : state && !detecting ? 'bad' : ''}`} title={state?.reason ?? text}>
      <span className="target-dot" />
      <span className="target-label">Target</span>
      <span className="target-text">{text}</span>
      <button className="link" onClick={onDetect} disabled={detecting || disabled}>
        {detecting ? '…' : found ? 'Re-detect' : 'Detect'}
      </button>
    </div>
  );
}
