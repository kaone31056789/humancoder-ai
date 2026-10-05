// Core domain types shared by background, content script, popup and options.

export type TypingMode = 'natural' | 'steady' | 'fast';

export interface TypingProfile {
  mode: TypingMode;
  /** Target speed in words per minute (1 word = 5 characters). */
  wpm: number;
  /** Occasional longer pauses at line starts / before blocks (natural mode only). */
  thinkingPauses: boolean;
  /** Compensate for editor latency and speed up through predictable runs (natural mode only). */
  adaptive: boolean;
}

export interface Settings {
  apiKey: string;
  model: string;
  /** Model for the Explain tab (default Gemini 2.5 Flash). */
  explainModel: string;
  visionModel: string;
  language: string;
  typing: TypingProfile;
  visionEnabled: boolean;
  maxIterations: number;
  includePageContext: boolean;
  debug: boolean;
  requestTimeoutMs: number;
  /** Ask OpenRouter to route only to providers that don't store or train on prompts. */
  privateProviders: boolean;
}

/** Settings with the secret removed — the only form that may leave the background/options pages. */
export type PublicSettings = Omit<Settings, 'apiKey'> & { hasApiKey: boolean };

export interface CursorPosition {
  /** 0-based character offset of the caret (selection head). */
  offset: number;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  selectionStart: number;
  selectionEnd: number;
}

export type EditorKind = 'monaco' | 'codemirror6' | 'codemirror5' | 'ace' | 'textarea' | 'contenteditable';

export interface EditorInfo {
  kind: EditorKind;
  label: string;
  language: string | null;
  lineCount: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the agent sees after each OBSERVE step. */
export interface Observation {
  editor: EditorInfo | null;
  code: string;
  cursor: CursorPosition | null;
  selectedText: string;
  errors: string[];
  pageContext: string;
  visionNotes?: string;
  /** Problems while observing (e.g. editor disappeared). */
  warnings: string[];
}

export type SessionStatus =
  | 'idle'
  | 'detecting'
  | 'analyzing'
  | 'planning'
  | 'typing'
  | 'inspecting'
  | 'correcting'
  | 'paused'
  | 'finished'
  | 'stopped'
  | 'error';

export type LogLevel = 'info' | 'action' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  t: number;
  level: LogLevel;
  msg: string;
}

export interface SessionState {
  tabId: number | null;
  running: boolean;
  status: SessionStatus;
  detail: string;
  iteration: number;
  maxIterations: number;
  logs: LogEntry[];
  updatedAt: number;
}

export type RunMode = 'type' | 'agent' | 'comments';

export interface RunRequest {
  mode: RunMode;
  /** Code pasted into the popup (typed verbatim in 'type' mode; reference material in 'agent' mode). */
  code: string;
  /** Natural-language task for the agent (agent mode). */
  task: string;
  language: string;
  model: string;
  typing: TypingProfile;
  maxIterations: number;
  visionEnabled: boolean;
  includePageContext: boolean;
  debug: boolean;
  /** 'comments' mode: comment blocks to insert above anchor lines (formatted for the language already). */
  comments?: CommentInsertion[];
}

export interface CodeAnalysis {
  language: string;
  summary: string;
  issues: { line?: number; severity: 'error' | 'warning' | 'info'; message: string }[];
  suggestions: string[];
}

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number | null;
  promptPrice: number | null;
  vision: boolean;
}

export const EXPLANATION_TYPES = ['Algorithm', 'Observation', 'Approach', 'Step-by-step', 'Complexity', 'Edge cases'] as const;
export type ExplanationType = (typeof EXPLANATION_TYPES)[number];

export interface Annotation {
  fromLine: number;
  toLine: number;
  text: string;
}

export interface CodeExplanation {
  summary: string;
  annotations: Annotation[];
}

export interface CommentInsertion {
  /** 1-based line the comment goes above, in the code that was explained. */
  line: number;
  /** That line's text, used to find it again if the editor's code shifted. */
  anchor: string;
  /** Ready-to-type comment lines (without indentation). */
  lines: string[];
}