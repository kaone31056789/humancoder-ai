import { OPENROUTER_BASE_URL } from '../shared/config';
import { redactSecrets } from '../shared/redact';
import type { CodeAnalysis, CodeExplanation, ModelInfo } from '../shared/types';
import {
  AGENT_SYSTEM_PROMPT,
  ANALYSIS_SYSTEM_PROMPT,
  EXPLAIN_SYSTEM_PROMPT,
  FIX_SYSTEM_PROMPT,
  VISION_SYSTEM_PROMPT,
  buildAgentUserMessage,
  buildAnalysisUserMessage,
  buildExplainUserMessage,
  buildFixUserMessage,
  buildRepairMessage,
  buildVisionUserText,
} from './prompts';
import { AIError, type AIProvider } from './provider';
import {
  parseAgentResponse,
  parseAnalysis,
  parseExplanation,
  parseFixedCode,
  parseVisionNotes,
  type AgentContext,
  type AgentResponse,
  type ParseResult,
  type VisionNotes,
} from './schemas';

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatOptions {
  model: string;
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResult {
  text: string;
  finishReason: string | null;
}

export interface OpenRouterClientOptions {
  apiKey: string;
  model: string;
  visionModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onDebug?: (msg: string) => void;
  /** Only use providers that don't retain or train on request data. */
  denyDataCollection?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class OpenRouterClient implements AIProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: OpenRouterClientOptions) {
    // Bind so `fetch` keeps its global receiver when called as a method.
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private debug(msg: string) {
    this.opts.onDebug?.(redactSecrets(msg));
  }

  /** One chat completion with timeout, retry on 429/5xx/network, and JSON-mode fallback. */
  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResult> {
    if (!this.opts.apiKey) {
      throw new AIError('missing_key', 'No OpenRouter API key set. Open Settings and add your key.');
    }
    const maxRetries = this.opts.maxRetries ?? 2;
    let jsonMode = options.jsonMode ?? false;
    let attempt = 0;

    for (;;) {
      try {
        return await this.chatOnce(messages, { ...options, jsonMode });
      } catch (e) {
        if (!(e instanceof AIError)) throw e;
        // Some models reject response_format; retry once without it (we parse JSON leniently anyway).
        if (jsonMode && e.code === 'bad_request' && /response_format|json/i.test(e.message)) {
          this.debug('Model rejected JSON mode; retrying without response_format');
          jsonMode = false;
          continue;
        }
        if (!e.retryable || attempt >= maxRetries) throw e;
        const wait = Math.min(e.retryAfterMs ?? 1500 * 2 ** attempt, 10000);
        attempt++;
        this.debug(`${e.code}: retrying in ${wait}ms (attempt ${attempt}/${maxRetries})`);
        await this.sleep(wait);
      }
    }
  }

  private async chatOnce(messages: ChatMessage[], options: ChatOptions): Promise<ChatResult> {
    const controller = new AbortController();
    const timeoutMs = this.opts.timeoutMs ?? 90000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const body: Record<string, unknown> = {
      model: options.model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 4000,
    };
    if (options.jsonMode) body.response_format = { type: 'json_object' };
    if (this.opts.denyDataCollection) body.provider = { data_collection: 'deny' };

    let res: Response;
    try {
      res = await this.fetchImpl(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        throw new AIError('timeout', `OpenRouter did not respond within ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new AIError('network', `Network error contacting OpenRouter: ${redactSecrets((e as Error).message)}`);
    } finally {
      clearTimeout(timer);
    }

    let payload: any = null;
    const raw = await res.text().catch(() => '');
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (!res.ok) throw mapHttpError(res.status, payload, res.headers.get('retry-after'), options.model);
    // OpenRouter can return 200 with an error object (e.g. upstream provider failure).
    if (payload?.error) {
      const status = typeof payload.error.code === 'number' ? payload.error.code : 502;
      throw mapHttpError(status, payload, null, options.model);
    }

    const choice = payload?.choices?.[0];
    const text: unknown = choice?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new AIError('invalid_response', 'The model returned an empty response.');
    }
    this.debug(`model=${payload?.model ?? options.model} finish=${choice?.finish_reason ?? '?'} chars=${text.length}`);
    return { text, finishReason: choice?.finish_reason ?? null };
  }

  /** Chat + parse + one repair round-trip if the reply fails validation. */
  private async chatStructured<T>(
    messages: ChatMessage[],
    options: ChatOptions,
    parse: (text: string) => ParseResult<T>,
  ): Promise<T> {
    const first = await this.chat(messages, { ...options, jsonMode: true });
    const parsed = parse(first.text);
    if (parsed.ok) return parsed.value;

    const reason = first.finishReason === 'length' ? `${parsed.error} (reply was cut off — use fewer, shorter actions)` : parsed.error;
    this.debug(`Invalid structured reply: ${reason}. Asking the model to repair it.`);
    const second = await this.chat(
      [...messages, { role: 'assistant', content: first.text.slice(0, 8000) }, { role: 'user', content: buildRepairMessage(reason) }],
      { ...options, jsonMode: true },
    );
    const reparsed = parse(second.text);
    if (reparsed.ok) return reparsed.value;
    throw new AIError('invalid_response', `The model's reply did not match the action schema: ${reparsed.error}`);
  }

  async generateActions(context: AgentContext): Promise<AgentResponse> {
    return this.chatStructured(
      [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        { role: 'user', content: buildAgentUserMessage(context) },
      ],
      { model: context.model || this.opts.model, maxTokens: 6000 },
      parseAgentResponse,
    );
  }

  async analyze(code: string, language: string, model?: string): Promise<CodeAnalysis> {
    return this.chatStructured(
      [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: buildAnalysisUserMessage(code, language) },
      ],
      { model: model || this.opts.model, maxTokens: 2500 },
      parseAnalysis,
    );
  }

  /** Returns the full corrected code for the selected analysis findings (used for pasted code). */
  async fixCode(code: string, language: string, fixes: string[], model?: string): Promise<{ code: string; changes: string[] }> {
    return this.chatStructured(
      [
        { role: 'system', content: FIX_SYSTEM_PROMPT },
        { role: 'user', content: buildFixUserMessage(code, language, fixes) },
      ],
      { model: model || this.opts.model, maxTokens: 8000 },
      parseFixedCode,
    );
  }

  async explain(
    code: string,
    language: string,
    style: string,
    range: { from: number; to: number } | null,
    detailed: boolean,
    model?: string,
  ): Promise<CodeExplanation> {
    return this.chatStructured(
      [
        { role: 'system', content: EXPLAIN_SYSTEM_PROMPT },
        { role: 'user', content: buildExplainUserMessage(code, language, style, range, detailed) },
      ],
      { model: model || this.opts.model, maxTokens: 5000, temperature: 0.2 },
      parseExplanation,
    );
  }

  async describeScreenshot(imageDataUrl: string, task: string): Promise<VisionNotes> {
    const model = this.opts.visionModel;
    if (!model) throw new AIError('bad_request', 'No vision model configured.');
    return this.chatStructured(
      [
        { role: 'system', content: VISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildVisionUserText(task) },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      { model, maxTokens: 3000 },
      parseVisionNotes,
    );
  }

  /** GET /key — validates the key and reports usage/limit. */
  async keyInfo(): Promise<{ label: string; usage: number | null; limit: number | null }> {
    if (!this.opts.apiKey) throw new AIError('missing_key', 'No API key entered.');
    let res: Response;
    try {
      res = await this.fetchImpl(`${OPENROUTER_BASE_URL}/key`, {
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
      });
    } catch (e) {
      throw new AIError('network', `Network error: ${(e as Error).message}`);
    }
    const payload: any = await res.json().catch(() => null);
    if (!res.ok) throw mapHttpError(res.status, payload, null, '');
    const d = payload?.data ?? {};
    return {
      label: typeof d.label === 'string' ? redactSecrets(d.label) : 'API key',
      usage: typeof d.usage === 'number' ? d.usage : null,
      limit: typeof d.limit === 'number' ? d.limit : null,
    };
  }

  /** Public model catalogue (no key required). */
  static async listModels(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<ModelInfo[]> {
    let res: Response;
    try {
      res = await fetchImpl(`${OPENROUTER_BASE_URL}/models`);
    } catch (e) {
      throw new AIError('network', `Could not load models: ${(e as Error).message}`);
    }
    if (!res.ok) throw mapHttpError(res.status, await res.json().catch(() => null), null, '');
    const payload: any = await res.json();
    const list: any[] = Array.isArray(payload?.data) ? payload.data : [];
    return list
      .filter((m) => typeof m?.id === 'string')
      .map((m) => ({
        id: m.id as string,
        name: typeof m.name === 'string' ? m.name : m.id,
        contextLength: typeof m.context_length === 'number' ? m.context_length : null,
        promptPrice: m.pricing?.prompt != null ? Number(m.pricing.prompt) : null,
        vision: Array.isArray(m.architecture?.input_modalities)
          ? m.architecture.input_modalities.includes('image')
          : /image/.test(String(m.architecture?.modality ?? '')),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}

export function mapHttpError(status: number, payload: any, retryAfter: string | null, model: string): AIError {
  const detail = redactSecrets(String(payload?.error?.message ?? payload?.message ?? '').slice(0, 300));
  const suffix = detail ? ` (${detail})` : '';
  const retryAfterMs = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : undefined;
  switch (true) {
    case status === 401:
      return new AIError('invalid_key', `OpenRouter rejected the API key. Check it in Settings.${suffix}`, status);
    case status === 402:
      return new AIError('insufficient_credits', `Your OpenRouter account has insufficient credits.${suffix}`, status);
    case status === 403:
      return new AIError('forbidden', `Request refused by OpenRouter (moderation or key restrictions).${suffix}`, status);
    case status === 404 && /data policy|data_collection|privacy/i.test(detail):
      return new AIError(
        'model_unavailable',
        `No provider for "${model}" meets the "don't store my data" setting. Pick another model, or turn that setting off in Settings → Privacy.`,
        status,
      );
    case status === 404:
      return new AIError('model_unavailable', `Model "${model}" was not found on OpenRouter. Pick another in Settings.${suffix}`, status);
    case status === 408:
      return new AIError('timeout', `The request timed out upstream.${suffix}`, status);
    case status === 429:
      return new AIError('rate_limited', `Rate limited by OpenRouter. Wait a moment and try again.${suffix}`, status, retryAfterMs);
    case status === 502 || status === 503:
      return new AIError('server', `Model "${model}" is temporarily unavailable upstream.${suffix}`, status, retryAfterMs);
    case status >= 500:
      return new AIError('server', `OpenRouter server error ${status}.${suffix}`, status);
    case status === 400 && /model/i.test(detail) && /(not|invalid|unavailable|exist)/i.test(detail):
      return new AIError('model_unavailable', `Model "${model}" is not available.${suffix}`, status);
    default:
      return new AIError('bad_request', `OpenRouter rejected the request (${status}).${suffix}`, status);
  }
}
