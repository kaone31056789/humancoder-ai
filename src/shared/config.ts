import type { Settings } from './types';

/**
 * Model IDs change over time on OpenRouter. These are only defaults — every one is
 * user-configurable in Settings, and the options page can pull the live model list.
 */
export const DEFAULT_MODEL = 'qwen/qwen-2.5-coder-32b-instruct';
export const DEFAULT_VISION_MODEL = 'google/gemini-2.5-flash';
export const DEFAULT_EXPLAIN_MODEL = 'google/gemini-2.5-flash';

/** Short curated list for the popup dropdown; the options page offers the full live list. */
export const SUGGESTED_MODELS: { id: string; label: string }[] = [
  { id: 'qwen/qwen-2.5-coder-32b-instruct', label: 'Qwen 2.5 Coder 32B (cheap)' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (best explanations)' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
  { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
];

export const LANGUAGES: { id: string; label: string }[] = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'cpp', label: 'C++' },
  { id: 'c', label: 'C' },
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'java', label: 'Java' },
  { id: 'csharp', label: 'C#' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'php', label: 'PHP' },
  { id: 'sql', label: 'SQL' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
];

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Hard safety limits. AI output exceeding these is rejected, not truncated. */
export const LIMITS = {
  maxActionsPerBatch: 60,
  maxTypeTextLength: 4000,
  maxTotalTypedCharsPerBatch: 12000,
  maxWaitMs: 5000,
  maxKeyRepeat: 50,
  maxDeleteCount: 500,
  maxFindTextLength: 1000,
  maxIterationsCeiling: 20,
  minIterations: 1,
  maxCodeInPrompt: 16000,
  maxPageContext: 3000,
  maxErrorsText: 2000,
  maxPastedCode: 100000,
  maxTaskLength: 4000,
  maxLogEntries: 300,
  wpmMin: 10,
  wpmMax: 400,
  minTimeoutMs: 10000,
  maxTimeoutMs: 180000,
} as const;

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: DEFAULT_MODEL,
  explainModel: DEFAULT_EXPLAIN_MODEL,
  visionModel: DEFAULT_VISION_MODEL,
  language: 'auto',
  typing: { mode: 'natural', wpm: 75, thinkingPauses: true, adaptive: true },
  visionEnabled: false,
  maxIterations: 6,
  includePageContext: true,
  debug: false,
  requestTimeoutMs: 90000,
  privateProviders: false,
};
