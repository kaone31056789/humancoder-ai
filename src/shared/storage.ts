import { DEFAULT_SETTINGS, LIMITS } from './config';
import {
  EXPLANATION_TYPES,
  type CodeAnalysis,
  type CodeExplanation,
  type ExplanationType,
  type PublicSettings,
  type SessionState,
  type Settings,
  type TypingMode,
  type TypingProfile,
} from './types';

const SETTINGS_KEY = 'hc_settings';
const DRAFT_KEY = 'hc_draft';
const MODELS_KEY = 'hc_models_cache';
export const SESSION_KEY = 'hc_session';

const clamp = (n: unknown, min: number, max: number, fallback: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, v));
};
const str = (v: unknown, fallback: string, max = 300): string =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

export function sanitizeTyping(raw: Partial<TypingProfile> | undefined): TypingProfile {
  const d = DEFAULT_SETTINGS.typing;
  const modes: TypingMode[] = ['natural', 'steady', 'fast'];
  return {
    mode: modes.includes(raw?.mode as TypingMode) ? (raw!.mode as TypingMode) : d.mode,
    wpm: Math.round(clamp(raw?.wpm, LIMITS.wpmMin, LIMITS.wpmMax, d.wpm)),
    thinkingPauses: bool(raw?.thinkingPauses, d.thinkingPauses),
    adaptive: bool(raw?.adaptive, d.adaptive),
  };
}

/** Coerces anything read from storage (or sent by a UI) into a valid Settings object. */
export function sanitizeSettings(raw: Partial<Settings> | undefined): Settings {
  const d = DEFAULT_SETTINGS;
  return {
    apiKey: typeof raw?.apiKey === 'string' ? raw.apiKey.trim().slice(0, 500) : '',
    model: str(raw?.model, d.model, 200),
    explainModel: str(raw?.explainModel, d.explainModel, 200),
    visionModel: str(raw?.visionModel, d.visionModel, 200),
    language: str(raw?.language, d.language, 40),
    typing: sanitizeTyping(raw?.typing),
    visionEnabled: bool(raw?.visionEnabled, d.visionEnabled),
    maxIterations: Math.round(
      clamp(raw?.maxIterations, LIMITS.minIterations, LIMITS.maxIterationsCeiling, d.maxIterations),
    ),
    includePageContext: bool(raw?.includePageContext, d.includePageContext),
    debug: bool(raw?.debug, d.debug),
    privateProviders: bool(raw?.privateProviders, d.privateProviders),
    requestTimeoutMs: Math.round(
      clamp(raw?.requestTimeoutMs, LIMITS.minTimeoutMs, LIMITS.maxTimeoutMs, d.requestTimeoutMs),
    ),
  };
}

/** Full settings including the API key. Only call from the background worker or options page. */
export async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(data[SETTINGS_KEY] as Partial<Settings> | undefined);
}

export function toPublic(s: Settings): PublicSettings {
  const { apiKey, ...rest } = s;
  return { ...rest, hasApiKey: apiKey.length > 0 };
}

export async function getPublicSettings(): Promise<PublicSettings> {
  return toPublic(await getSettings());
}

/** Merges a partial update. An undefined apiKey keeps the stored key. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = sanitizeSettings({
    ...current,
    ...patch,
    typing: { ...current.typing, ...patch.typing },
    apiKey: patch.apiKey ?? current.apiKey,
  });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function resetSettings(keepApiKey: boolean): Promise<Settings> {
  const current = await getSettings();
  const next = { ...DEFAULT_SETTINGS, apiKey: keepApiKey ? current.apiKey : '' };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

// ---- Popup draft (so closing the popup never loses pasted code) ----

export type PopupMode = 'type' | 'agent' | 'review' | 'explain';

export interface ExplainOptions {
  style: ExplanationType;
  /** Line range as typed by the user; empty = whole code. */
  from: string;
  to: string;
  detailed: boolean;
  /** Where "Write explanation" puts the text. */
  target: 'page' | 'comments';
}

export const DEFAULT_EXPLAIN: ExplainOptions = { style: 'Observation', from: '', to: '', detailed: false, target: 'page' };

export interface PopupDraft {
  code: string;
  task: string;
  mode: PopupMode;
  explain: ExplainOptions;
}

export async function getDraft(): Promise<PopupDraft> {
  const data = await chrome.storage.local.get(DRAFT_KEY);
  const d = data[DRAFT_KEY] as Partial<PopupDraft> | undefined;
  const e: Partial<ExplainOptions> = d?.explain ?? {};
  return {
    code: typeof d?.code === 'string' ? d.code : '',
    task: typeof d?.task === 'string' ? d.task : '',
    mode: d?.mode === 'agent' || d?.mode === 'explain' || d?.mode === 'review' ? d.mode : 'type',
    explain: {
      style: EXPLANATION_TYPES.includes(e.style as ExplanationType) ? (e.style as ExplanationType) : DEFAULT_EXPLAIN.style,
      from: typeof e.from === 'string' ? e.from : '',
      to: typeof e.to === 'string' ? e.to : '',
      detailed: e.detailed === true,
      target: e.target === 'comments' ? 'comments' : 'page',
    },
  };
}

// ---- Last explanation ----

const EXPLANATION_KEY = 'hc_explanation';

export interface SavedExplanation {
  explanation: CodeExplanation;
  /** The exact code that was explained (comment anchors refer to it). */
  code: string;
  language: string;
  ranged: boolean;
  /** Editable text for a page explanation box. */
  text: string;
}

export async function getSavedExplanation(): Promise<SavedExplanation | null> {
  const data = await chrome.storage.local.get(EXPLANATION_KEY);
  const v = data[EXPLANATION_KEY] as SavedExplanation | undefined;
  return v && v.explanation && typeof v.text === 'string' ? v : null;
}

export async function saveExplanation(value: SavedExplanation | null): Promise<void> {
  if (value) await chrome.storage.local.set({ [EXPLANATION_KEY]: { ...value, code: value.code.slice(0, LIMITS.maxPastedCode) } });
  else await chrome.storage.local.remove(EXPLANATION_KEY);
}

export async function saveDraft(draft: PopupDraft): Promise<void> {
  await chrome.storage.local.set({
    [DRAFT_KEY]: { ...draft, code: draft.code.slice(0, LIMITS.maxPastedCode) },
  });
}

// ---- Last analysis (kept so the popup can offer fixes after being reopened) ----

const ANALYSIS_KEY = 'hc_analysis';

export interface SavedAnalysis {
  analysis: CodeAnalysis;
  /** The exact code that was analysed. */
  code: string;
  language: string;
}

export async function getSavedAnalysis(): Promise<SavedAnalysis | null> {
  const data = await chrome.storage.local.get(ANALYSIS_KEY);
  const v = data[ANALYSIS_KEY] as SavedAnalysis | undefined;
  return v && v.analysis && typeof v.code === 'string' ? v : null;
}

export async function saveAnalysis(value: SavedAnalysis | null): Promise<void> {
  if (value) await chrome.storage.local.set({ [ANALYSIS_KEY]: { ...value, code: value.code.slice(0, LIMITS.maxPastedCode) } });
  else await chrome.storage.local.remove(ANALYSIS_KEY);
}

/** Forgets everything the extension remembers about your work; keeps settings and the API key. */
export async function clearSavedData(): Promise<void> {
  await chrome.storage.local.remove([DRAFT_KEY, ANALYSIS_KEY, EXPLANATION_KEY, MODELS_KEY]);
  await chrome.storage.session.remove(SESSION_KEY);
}

// ---- Model list cache ----

export async function getCachedModels<T>(): Promise<{ at: number; models: T[] } | null> {
  const data = await chrome.storage.local.get(MODELS_KEY);
  return (data[MODELS_KEY] as { at: number; models: T[] } | undefined) ?? null;
}

export async function setCachedModels<T>(models: T[]): Promise<void> {
  await chrome.storage.local.set({ [MODELS_KEY]: { at: Date.now(), models } });
}

// ---- Session state (chrome.storage.session; written by background, read by popup) ----

export const EMPTY_SESSION: SessionState = {
  tabId: null,
  running: false,
  status: 'idle',
  detail: '',
  iteration: 0,
  maxIterations: 0,
  logs: [],
  updatedAt: 0,
};

export async function getSession(): Promise<SessionState> {
  const data = await chrome.storage.session.get(SESSION_KEY);
  return { ...EMPTY_SESSION, ...(data[SESSION_KEY] as Partial<SessionState> | undefined) };
}
