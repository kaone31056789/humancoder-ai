// Strict schemas for everything the model returns. AI output is untrusted: it is parsed,
// validated and size-limited here before anything is executed. There is no action that
// can run code, call browser APIs or navigate — only editor edits from a fixed list.

import { z } from 'zod';
import { LIMITS } from '../shared/config';
import type { CodeAnalysis, Observation } from '../shared/types';

export const KEY_NAMES = [
  'ENTER',
  'TAB',
  'BACKSPACE',
  'DELETE',
  'ARROW_LEFT',
  'ARROW_RIGHT',
  'ARROW_UP',
  'ARROW_DOWN',
  'HOME',
  'END',
  'ESCAPE',
] as const;
export type KeyName = (typeof KEY_NAMES)[number];

const KEY_ALIASES: Record<string, KeyName> = {
  RETURN: 'ENTER',
  NEWLINE: 'ENTER',
  BKSP: 'BACKSPACE',
  DEL: 'DELETE',
  ESC: 'ESCAPE',
  LEFT: 'ARROW_LEFT',
  RIGHT: 'ARROW_RIGHT',
  UP: 'ARROW_UP',
  DOWN: 'ARROW_DOWN',
  ARROWLEFT: 'ARROW_LEFT',
  ARROWRIGHT: 'ARROW_RIGHT',
  ARROWUP: 'ARROW_UP',
  ARROWDOWN: 'ARROW_DOWN',
};

/** Accepts common spellings ("Enter", "ArrowLeft", "arrow-up") and maps them to canonical names. */
export function normalizeKey(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const k = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if ((KEY_NAMES as readonly string[]).includes(k)) return k;
  return KEY_ALIASES[k.replace(/_/g, '')] ?? KEY_ALIASES[k] ?? k;
}

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('type'), text: z.string().min(1).max(LIMITS.maxTypeTextLength) }).strict(),
  z
    .object({
      type: z.literal('key'),
      key: z.preprocess(normalizeKey, z.enum(KEY_NAMES)),
      times: int(1, LIMITS.maxKeyRepeat).optional(),
    })
    .strict(),
  z.object({ type: z.literal('wait'), ms: int(0, LIMITS.maxWaitMs) }).strict(),
  z.object({ type: z.literal('move'), line: int(1, 1_000_000), column: int(1, 100_000) }).strict(),
  // start <= end is checked in AgentResponseSchema (discriminated unions can't hold refined objects).
  z.object({ type: z.literal('select'), start: int(0, 10_000_000), end: int(0, 10_000_000) }).strict(),
  z
    .object({
      type: z.literal('find'),
      text: z.string().min(1).max(LIMITS.maxFindTextLength),
      occurrence: int(1, 1000).optional(),
    })
    .strict(),
  z.object({ type: z.literal('replace'), text: z.string().max(LIMITS.maxTypeTextLength) }).strict(),
  z.object({ type: z.literal('delete'), count: int(1, LIMITS.maxDeleteCount) }).strict(),
  z
    .object({
      type: z.literal('inspect'),
      vision: z.boolean().optional(),
      reason: z.string().max(300).optional(),
    })
    .strict(),
]);

export type AgentAction = z.infer<typeof ActionSchema>;

export const AgentResponseSchema = z
  .object({
    thought: z.string().max(600).optional(),
    actions: z.array(ActionSchema).max(LIMITS.maxActionsPerBatch),
    done: z.boolean(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const typed = r.actions.reduce(
      (n, a) => n + (a.type === 'type' || a.type === 'replace' ? a.text.length : 0),
      0,
    );
    if (typed > LIMITS.maxTotalTypedCharsPerBatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `batch types ${typed} characters; limit is ${LIMITS.maxTotalTypedCharsPerBatch}`,
      });
    }
    r.actions.forEach((a, i) => {
      if (a.type === 'select' && a.start > a.end) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['actions', i], message: 'select.start must be <= select.end' });
      }
    });
    const inspectAt = r.actions.findIndex((a) => a.type === 'inspect');
    if (inspectAt !== -1 && inspectAt !== r.actions.length - 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"inspect" must be the last action in a batch' });
    }
    if (!r.done && r.actions.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'empty action list with done=false' });
    }
  });

export type AgentResponse = z.infer<typeof AgentResponseSchema>;

export const AnalysisSchema = z
  .object({
    language: z.string().max(40),
    summary: z.string().max(2000),
    issues: z
      .array(
        z.object({
          line: z.number().int().min(1).optional(),
          severity: z.enum(['error', 'warning', 'info']),
          message: z.string().max(500),
        }),
      )
      .max(30),
    suggestions: z.array(z.string().max(500)).max(15),
  })
  .strip();

export const ExplanationSchema = z
  .object({
    summary: z.string().max(3000),
    annotations: z
      .array(
        z.object({
          fromLine: z.number().int().min(1),
          toLine: z.number().int().min(1),
          text: z.string().min(1).max(3000),
        }).strip(),
      )
      .max(40),
  })
  .strip();

export const FixedCodeSchema = z
  .object({
    code: z.string().min(1).max(LIMITS.maxPastedCode),
    changes: z.array(z.string().max(300)).max(30),
  })
  .strip();

export const VisionNotesSchema = z
  .object({
    editorFound: z.boolean(),
    visibleCode: z.string().max(8000).optional(),
    errors: z.array(z.string().max(500)).max(20).optional(),
    cursor: z.string().max(200).optional(),
    buttons: z.array(z.string().max(100)).max(20).optional(),
    output: z.string().max(2000).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strip();

export type VisionNotes = z.infer<typeof VisionNotesSchema>;

export interface HistoryEntry {
  iteration: number;
  thought?: string;
  actions: string[];
  outcome: string;
}

/** Everything the planner needs for one step. Assembled by the Agent, rendered by prompts.ts. */
export interface AgentContext {
  task: string;
  language: string;
  referenceCode: string;
  observation: Observation;
  history: HistoryEntry[];
  iteration: number;
  maxIterations: number;
  model: string;
  /** Extra guidance from the loop, e.g. "you said done but errors are visible". */
  note?: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Pulls a JSON object out of model text, tolerating code fences and leading/trailing prose. */
export function extractJson(text: string): ParseResult<unknown> {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return { ok: false, error: 'response contains no JSON object' };
  try {
    return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) };
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
  }
}

export function formatZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 6)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

function parseWith<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, text: string): ParseResult<T> {
  const json = extractJson(text);
  if (!json.ok) return json;
  const parsed = schema.safeParse(json.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: formatZodError(parsed.error) };
}

export const parseAgentResponse = (text: string) => parseWith(AgentResponseSchema, text);
export const parseAnalysis = (text: string): ParseResult<CodeAnalysis> => parseWith(AnalysisSchema, text);
export const parseVisionNotes = (text: string) => parseWith(VisionNotesSchema, text);
export const parseFixedCode = (text: string) => parseWith(FixedCodeSchema, text);
export const parseExplanation = (text: string) => parseWith(ExplanationSchema, text);

/** Re-validates an already-parsed object (used by the content script as defence in depth). */
export function validateAgentResponse(value: unknown): ParseResult<AgentResponse> {
  const parsed = AgentResponseSchema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: formatZodError(parsed.error) };
}

export function describeAction(a: AgentAction, verbose = false): string {
  const preview = (s: string) => {
    const one = s.replace(/\n/g, '⏎').replace(/\t/g, '⇥');
    return verbose ? JSON.stringify(one) : JSON.stringify(one.length > 40 ? one.slice(0, 39) + '…' : one);
  };
  switch (a.type) {
    case 'type':
      return `type ${preview(a.text)}`;
    case 'key':
      return a.times && a.times > 1 ? `${a.key} ×${a.times}` : a.key;
    case 'wait':
      return `wait ${a.ms}ms`;
    case 'move':
      return `move to ${a.line}:${a.column}`;
    case 'select':
      return `select ${a.start}-${a.end}`;
    case 'find':
      return `find ${preview(a.text)}${a.occurrence ? ` #${a.occurrence}` : ''}`;
    case 'replace':
      return `replace with ${preview(a.text)}`;
    case 'delete':
      return `delete ${a.count}`;
    case 'inspect':
      return `inspect${a.vision ? ' (vision)' : ''}`;
  }
}
