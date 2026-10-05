import { describe, expect, it, vi } from 'vitest';
import { OpenRouterClient } from '../src/ai/OpenRouterClient';
import { AIError } from '../src/ai/provider';
import type { AgentContext } from '../src/ai/schemas';

const context: AgentContext = {
  task: 'print the sum',
  language: 'cpp',
  referenceCode: '',
  model: 'test/model',
  iteration: 1,
  maxIterations: 3,
  history: [],
  observation: {
    editor: { kind: 'textarea', label: 'Textarea editor', language: 'cpp', lineCount: 1 },
    code: 'int main() {}',
    cursor: { offset: 0, line: 1, column: 1, selectionStart: 0, selectionEnd: 0 },
    selectedText: '',
    errors: [],
    pageContext: '',
    warnings: [],
  },
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const completion = (content: string, finish = 'stop') => json(200, { model: 'test/model', choices: [{ message: { content }, finish_reason: finish }] });
const VALID = JSON.stringify({ thought: 't', actions: [{ type: 'type', text: 'x' }], done: false });

function client(responses: (Response | Error)[], extra: Partial<ConstructorParameters<typeof OpenRouterClient>[0]> = {}) {
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  });
  const c = new OpenRouterClient({
    apiKey: 'sk-or-v1-testkey123456',
    model: 'test/model',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
    ...extra,
  });
  return { c, fetchImpl };
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    return (e as AIError).code;
  }
};

describe('OpenRouterClient', () => {
  it('returns validated actions and sends auth + JSON mode', async () => {
    const { c, fetchImpl } = client([completion(VALID)]);
    const r = await c.generateActions(context);
    expect(r.actions).toEqual([{ type: 'type', text: 'x' }]);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-v1-testkey123456');
    expect(JSON.parse(init.body as string).response_format).toEqual({ type: 'json_object' });
  });

  it('fails fast without an API key', async () => {
    const { c, fetchImpl } = client([], { apiKey: '' });
    expect(await codeOf(c.generateActions(context))).toBe('missing_key');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps 401 / 402 / 404 to clear errors without retrying', async () => {
    expect(await codeOf(client([json(401, { error: { message: 'No auth' } })]).c.generateActions(context))).toBe('invalid_key');
    expect(await codeOf(client([json(402, { error: { message: 'credits' } })]).c.generateActions(context))).toBe('insufficient_credits');
    expect(await codeOf(client([json(404, { error: { message: 'No endpoints' } })]).c.generateActions(context))).toBe('model_unavailable');
  });

  it('retries rate limits and server errors, then succeeds', async () => {
    const { c, fetchImpl } = client([json(429, { error: { message: 'slow down' } }, { 'retry-after': '1' }), json(503, {}), completion(VALID)]);
    const r = await c.generateActions(context);
    expect(r.done).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up after the retry budget', async () => {
    const { c, fetchImpl } = client([json(429, {}), json(429, {}), json(429, {})]);
    expect(await codeOf(c.generateActions(context))).toBe('rate_limited');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('handles 200 responses that carry an error object', async () => {
    const { c } = client([json(200, { error: { code: 404, message: 'model gone' } })]);
    expect(await codeOf(c.generateActions(context))).toBe('model_unavailable');
  });

  it('reports timeouts', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { c } = client([abort, abort, abort]);
    expect(await codeOf(c.generateActions(context))).toBe('timeout');
  });

  it('reports network failures', async () => {
    const { c } = client([new TypeError('Failed to fetch'), new TypeError('x'), new TypeError('x')]);
    expect(await codeOf(c.generateActions(context))).toBe('network');
  });

  it('asks the model to repair an invalid reply once', async () => {
    const { c, fetchImpl } = client([completion('here are actions: none'), completion(VALID)]);
    const r = await c.generateActions(context);
    expect(r.actions).toHaveLength(1);
    const second = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string);
    expect(second.messages.at(-1).content).toMatch(/rejected by the validator/);
  });

  it('fails with invalid_response when the repair is also invalid', async () => {
    const bad = JSON.stringify({ actions: [{ type: 'exec', code: 'x' }], done: false });
    const { c } = client([completion(bad), completion(bad)]);
    expect(await codeOf(c.generateActions(context))).toBe('invalid_response');
  });

  it('falls back when a model rejects response_format', async () => {
    const { c, fetchImpl } = client([json(400, { error: { message: 'response_format is not supported' } }), completion(VALID)]);
    await c.generateActions(context);
    const second = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string);
    expect(second.response_format).toBeUndefined();
  });

  it('does not send app-identifying headers', async () => {
    const { c, fetchImpl } = client([completion(VALID)]);
    await c.generateActions(context);
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(Object.keys(headers).map((h) => h.toLowerCase()).sort()).toEqual(['authorization', 'content-type']);
  });

  it('asks for no-data-retention providers only when enabled', async () => {
    const on = client([completion(VALID)], { denyDataCollection: true });
    await on.c.generateActions(context);
    expect(JSON.parse((on.fetchImpl.mock.calls[0][1] as RequestInit).body as string).provider).toEqual({ data_collection: 'deny' });

    const off = client([completion(VALID)]);
    await off.c.generateActions(context);
    expect(JSON.parse((off.fetchImpl.mock.calls[0][1] as RequestInit).body as string).provider).toBeUndefined();
  });

  it('explains when no provider matches the data policy', async () => {
    const { c } = client([json(404, { error: { message: 'No endpoints found matching your data policy' } })], { denyDataCollection: true });
    try {
      await c.generateActions(context);
      expect.unreachable();
    } catch (e) {
      expect((e as AIError).code).toBe('model_unavailable');
      expect((e as Error).message).toMatch(/don't store my data/);
    }
  });

  it('never leaks the API key into error messages', async () => {
    const { c } = client([json(401, { error: { message: 'bad key sk-or-v1-testkey123456' } })]);
    try {
      await c.generateActions(context);
    } catch (e) {
      expect((e as Error).message).not.toContain('testkey123456');
    }
  });
});
