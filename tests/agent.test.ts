import { describe, expect, it } from 'vitest';
import { Agent, StopError, hasErrorText, type AgentEnvironment } from '../src/ai/Agent';
import { AIError, type AIProvider } from '../src/ai/provider';
import type { AgentAction, AgentContext, AgentResponse } from '../src/ai/schemas';
import type { Observation } from '../src/shared/types';

function harness(responses: (AgentResponse | Error)[], opts: { errorsAfter?: number; failOn?: string; stopAt?: number } = {}) {
  const contexts: AgentContext[] = [];
  const executed: AgentAction[] = [];
  let code = 'int main() {\n}';
  let observes = 0;

  const provider: AIProvider = {
    async generateActions(ctx) {
      contexts.push(ctx);
      const next = responses.shift();
      if (!next) throw new Error('no more scripted responses');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  const env: AgentEnvironment = {
    async observe(): Promise<Observation> {
      observes++;
      return {
        editor: { kind: 'textarea', label: 'Textarea editor', language: 'cpp', lineCount: code.split('\n').length },
        code,
        cursor: { offset: 0, line: 1, column: 1, selectionStart: 0, selectionEnd: 0 },
        selectedText: '',
        errors: opts.errorsAfter !== undefined && observes > opts.errorsAfter ? ["error: expected ';'"] : [],
        pageContext: '',
        warnings: [],
      };
    },
    async execute(action) {
      executed.push(action);
      if (opts.failOn && action.type === opts.failOn) return { ok: false, message: 'text not found in the editor' };
      if (action.type === 'type') code += action.text;
      return { ok: true };
    },
    async checkpoint() {
      if (opts.stopAt !== undefined && executed.length >= opts.stopAt) throw new StopError();
    },
    status() {},
    log() {},
  };
  const agent = new Agent(provider, env, {
    task: 'add a print',
    language: 'cpp',
    referenceCode: '',
    model: 'm',
    maxIterations: 4,
    visionEnabled: false,
    verbose: false,
  });
  return { agent, contexts, executed };
}

describe('Agent loop', () => {
  it('executes actions, re-observes, and finishes when done', async () => {
    const h = harness([
      { thought: 'type it', actions: [{ type: 'type', text: 'x' }, { type: 'inspect' }], done: false },
      { thought: 'looks right', actions: [], done: true },
    ]);
    const r = await h.agent.run();
    expect(r.status).toBe('finished');
    expect(r.iterations).toBe(2);
    expect(h.executed).toEqual([{ type: 'type', text: 'x' }]);
    expect(h.contexts[1].observation.code.endsWith('x')).toBe(true);
    expect(h.contexts[1].history[0].outcome).toMatch(/^ok/);
  });

  it('stops a batch at the first failing action and tells the model', async () => {
    const h = harness(
      [
        { actions: [{ type: 'find', text: 'nope' }, { type: 'type', text: 'never' }], done: false },
        { actions: [], done: true },
      ],
      { failOn: 'find' },
    );
    const r = await h.agent.run();
    expect(r.status).toBe('finished');
    expect(h.executed).toHaveLength(1);
    expect(h.contexts[1].note).toMatch(/failed/);
    expect(h.contexts[1].history[0].outcome).toMatch(/FAILED/);
  });

  it('enforces the iteration limit', async () => {
    const step: AgentResponse = { actions: [{ type: 'key', key: 'ENTER' }], done: false };
    const h = harness([step, step, step, step, step]);
    const r = await h.agent.run();
    expect(r.status).toBe('max_iterations');
    expect(h.contexts).toHaveLength(4);
  });

  it('double-checks a "done" claim when errors are visible, once', async () => {
    const h = harness(
      [
        { actions: [{ type: 'type', text: ';' }], done: true },
        { actions: [], done: true },
      ],
      { errorsAfter: 1 },
    );
    const r = await h.agent.run();
    expect(r.status).toBe('finished');
    expect(h.contexts).toHaveLength(2);
    expect(h.contexts[1].note).toMatch(/errors/i);
  });

  it('treats success output as non-errors', () => {
    expect(hasErrorText(['✓ Compiled successfully'])).toBe(false);
    expect(hasErrorText(['Accepted', 'Output: 3'])).toBe(false);
    expect(hasErrorText(["line 5: error: expected ';'"])).toBe(true);
    expect(hasErrorText(['Traceback (most recent call last):'])).toBe(true);
  });

  it('surfaces AI errors as an error result', async () => {
    const h = harness([new AIError('rate_limited', 'Rate limited by OpenRouter.')]);
    const r = await h.agent.run();
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/Rate limited/);
  });

  it('reports a user stop', async () => {
    const h = harness([{ actions: [{ type: 'type', text: 'a' }, { type: 'type', text: 'b' }], done: false }], { stopAt: 1 });
    const r = await h.agent.run();
    expect(r.status).toBe('stopped');
    expect(h.executed).toHaveLength(1);
  });

  it('gives up after repeated failing batches', async () => {
    const bad: AgentResponse = { actions: [{ type: 'find', text: 'zzz' }], done: false };
    const h = harness([bad, bad, bad, bad], { failOn: 'find' });
    const r = await h.agent.run();
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/failed batches/);
  });
});
