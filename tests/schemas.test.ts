import { describe, expect, it } from 'vitest';
import { describeAction, extractJson, normalizeKey, parseAgentResponse } from '../src/ai/schemas';
import { LIMITS } from '../src/shared/config';

const ok = (obj: unknown) => parseAgentResponse(JSON.stringify(obj));

describe('AI action schema validation', () => {
  it('accepts a well-formed batch', () => {
    const r = ok({
      thought: 'add the sum',
      actions: [
        { type: 'find', text: 'cin >> a >> b;' },
        { type: 'key', key: 'END' },
        { type: 'key', key: 'ENTER' },
        { type: 'type', text: '    int result = a + b;' },
        { type: 'inspect', reason: 'verify' },
      ],
      done: false,
    });
    expect(r.ok).toBe(true);
  });

  it('normalises common key spellings', () => {
    expect(normalizeKey('Enter')).toBe('ENTER');
    expect(normalizeKey('ArrowLeft')).toBe('ARROW_LEFT');
    expect(normalizeKey('arrow-up')).toBe('ARROW_UP');
    expect(normalizeKey('Backspace')).toBe('BACKSPACE');
    expect(normalizeKey('esc')).toBe('ESCAPE');
    const r = ok({ actions: [{ type: 'key', key: 'Return' }], done: false });
    expect(r.ok && r.value.actions[0]).toEqual({ type: 'key', key: 'ENTER' });
  });

  it('rejects unknown keys', () => {
    expect(ok({ actions: [{ type: 'key', key: 'F12' }], done: false }).ok).toBe(false);
    expect(ok({ actions: [{ type: 'key', key: 'CTRL+A' }], done: false }).ok).toBe(false);
  });

  it('rejects action types outside the allow-list (e.g. script execution)', () => {
    const r = ok({ actions: [{ type: 'eval', code: 'alert(1)' }], done: false });
    expect(r.ok).toBe(false);
    expect(ok({ actions: [{ type: 'navigate', url: 'https://x' }], done: false }).ok).toBe(false);
  });

  it('rejects unexpected fields (strict objects)', () => {
    expect(ok({ actions: [{ type: 'type', text: 'x', js: 'alert(1)' }], done: false }).ok).toBe(false);
    expect(ok({ actions: [], done: true, script: 'x' }).ok).toBe(false);
  });

  it('enforces limits on text length, waits, repeats and deletes', () => {
    expect(ok({ actions: [{ type: 'type', text: 'x'.repeat(LIMITS.maxTypeTextLength + 1) }], done: false }).ok).toBe(false);
    expect(ok({ actions: [{ type: 'wait', ms: LIMITS.maxWaitMs + 1 }], done: false }).ok).toBe(false);
    expect(ok({ actions: [{ type: 'wait', ms: -5 }], done: false }).ok).toBe(false);
    expect(ok({ actions: [{ type: 'key', key: 'ENTER', times: LIMITS.maxKeyRepeat + 1 }], done: false }).ok).toBe(false);
    expect(ok({ actions: [{ type: 'delete', count: LIMITS.maxDeleteCount + 1 }], done: false }).ok).toBe(false);
    expect(ok({ actions: [{ type: 'delete', count: 1.5 }], done: false }).ok).toBe(false);
    const many = Array.from({ length: LIMITS.maxActionsPerBatch + 1 }, () => ({ type: 'key', key: 'ENTER' }));
    expect(ok({ actions: many, done: false }).ok).toBe(false);
  });

  it('caps the total characters typed in one batch', () => {
    const chunk = { type: 'type', text: 'x'.repeat(LIMITS.maxTypeTextLength) };
    const n = Math.ceil(LIMITS.maxTotalTypedCharsPerBatch / LIMITS.maxTypeTextLength) + 1;
    expect(ok({ actions: Array(n).fill(chunk), done: false }).ok).toBe(false);
  });

  it('validates selection ranges', () => {
    expect(ok({ actions: [{ type: 'select', start: 10, end: 2 }], done: false }).ok).toBe(false);
    expect(ok({ actions: [{ type: 'select', start: -1, end: 2 }], done: false }).ok).toBe(false);
    expect(ok({ actions: [{ type: 'select', start: 2, end: 10 }], done: false }).ok).toBe(true);
  });

  it('requires inspect to be the last action', () => {
    expect(ok({ actions: [{ type: 'inspect' }, { type: 'type', text: 'x' }], done: false }).ok).toBe(false);
  });

  it('rejects an empty, unfinished batch', () => {
    expect(ok({ actions: [], done: false }).ok).toBe(false);
    expect(ok({ actions: [], done: true }).ok).toBe(true);
  });
});

describe('malformed AI responses', () => {
  it('extracts JSON from code fences and surrounding prose', () => {
    const r = parseAgentResponse('Sure! Here you go:\n```json\n{"actions":[],"done":true}\n```\nHope that helps.');
    expect(r.ok).toBe(true);
  });

  it('reports invalid JSON', () => {
    const r = parseAgentResponse('{"actions": [ {"type": "type", "text": "x" ], "done": false}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid JSON/);
  });

  it('reports a reply with no JSON object', () => {
    expect(extractJson('I cannot help with that.').ok).toBe(false);
  });

  it('reports wrong field types', () => {
    const r = parseAgentResponse('{"actions":[{"type":"type","text":42}],"done":"yes"}');
    expect(r.ok).toBe(false);
  });

  it('describes actions compactly for logs', () => {
    expect(describeAction({ type: 'key', key: 'BACKSPACE', times: 3 })).toBe('BACKSPACE ×3');
    expect(describeAction({ type: 'type', text: 'a\nb' })).toBe('type "a⏎b"');
  });
});
