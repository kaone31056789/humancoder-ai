// Typed message contracts between popup/options, background worker and content script.

import type { AgentContext, AgentResponse } from '../ai/schemas';
import type {
  CodeAnalysis,
  CodeExplanation,
  EditorInfo,
  LogEntry,
  ModelInfo,
  Rect,
  RunRequest,
  SessionState,
  TypingProfile,
} from './types';

export type ControlCommand = 'pause' | 'resume' | 'toggle' | 'stop' | 'setTyping';

export type Failure = { ok: false; error: string; code?: string };
export type Result<T extends object = object> = ({ ok: true } & T) | Failure;

/** Messages handled by the background service worker. */
export type BackgroundRequest =
  // From popup / options
  | { type: 'START'; tabId: number; request: Omit<RunRequest, 'model' | 'maxIterations' | 'visionEnabled' | 'debug'> & { model?: string } }
  | { type: 'CONTROL'; tabId: number; command: ControlCommand; typing?: TypingProfile }
  | { type: 'DETECT'; tabId: number }
  | { type: 'READ_EDITOR'; tabId: number; preferCode?: boolean }
  | { type: 'ANALYZE'; code: string; language: string; model?: string }
  | { type: 'EXPLAIN'; code: string; language: string; style: string; range: { from: number; to: number } | null; detailed: boolean; model?: string }
  | { type: 'FIX_CODE'; code: string; language: string; fixes: string[]; model?: string }
  | { type: 'LIST_MODELS'; force?: boolean }
  | { type: 'TEST_KEY'; apiKey?: string }
  | { type: 'CLEAR_SESSION' }
  // From the content script
  | { type: 'AI_ACTIONS'; context: AgentContext }
  | { type: 'VISION_INSPECT'; rect: Rect | null; viewport: { width: number; height: number }; dpr: number; task: string }
  | { type: 'SESSION_UPDATE'; patch: Partial<Omit<SessionState, 'logs' | 'tabId'>>; logs?: LogEntry[] }
  | { type: 'TIMER'; ms: number };

export interface BackgroundResponses {
  START: Result;
  CONTROL: Result;
  DETECT: Result<{ editor: EditorInfo | null; reason?: string }>;
  READ_EDITOR: Result<{ code: string; language: string | null; editor: EditorInfo }>;
  ANALYZE: Result<{ analysis: CodeAnalysis }>;
  FIX_CODE: Result<{ code: string; changes: string[] }>;
  EXPLAIN: Result<{ explanation: CodeExplanation }>;
  TIMER: Result;
  LIST_MODELS: Result<{ models: ModelInfo[] }>;
  TEST_KEY: Result<{ label: string; usage: number | null; limit: number | null }>;
  CLEAR_SESSION: Result;
  AI_ACTIONS: Result<{ response: AgentResponse }>;
  VISION_INSPECT: Result<{ notes: string }>;
  SESSION_UPDATE: Result;
}

/** Messages handled by the content script (sent with chrome.tabs.sendMessage). */
export type ContentRequest =
  | { type: 'HC_PING' }
  | { type: 'HC_DETECT' }
  | { type: 'HC_READ'; preferCode?: boolean }
  | { type: 'HC_RUN'; request: RunRequest }
  | { type: 'HC_CONTROL'; command: ControlCommand; typing?: TypingProfile };

export interface ContentResponses {
  HC_PING: Result<{ running: boolean }>;
  HC_DETECT: Result<{ editor: EditorInfo | null; reason?: string }>;
  HC_READ: Result<{ code: string; language: string | null; editor: EditorInfo }>;
  HC_RUN: Result;
  HC_CONTROL: Result;
}

function lastErrorFailure(): Failure | null {
  const err = chrome.runtime.lastError;
  return err ? { ok: false, error: err.message ?? 'Extension messaging failed', code: 'messaging' } : null;
}

export function sendToBackground<M extends BackgroundRequest>(msg: M): Promise<BackgroundResponses[M['type']]> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res: BackgroundResponses[M['type']] | undefined) => {
      const fail = lastErrorFailure();
      if (fail) resolve(fail as BackgroundResponses[M['type']]);
      else resolve(res ?? ({ ok: false, error: 'No response from background', code: 'messaging' } as BackgroundResponses[M['type']]));
    });
  });
}

export function sendToTab<M extends ContentRequest>(tabId: number, msg: M): Promise<ContentResponses[M['type']]> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (res: ContentResponses[M['type']] | undefined) => {
      const fail = lastErrorFailure();
      if (fail) resolve(fail as ContentResponses[M['type']]);
      else resolve(res ?? ({ ok: false, error: 'No response from page', code: 'messaging' } as ContentResponses[M['type']]));
    });
  });
}
