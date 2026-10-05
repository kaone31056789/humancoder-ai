import { describe, expect, it } from 'vitest';
import { Agent, type AgentEnvironment } from '../src/ai/Agent';
import type { AIProvider } from '../src/ai/provider';
import { parseExplanation, type AgentContext } from '../src/ai/schemas';
import { EXPLANATION_FORMATS, buildExplainUserMessage } from '../src/ai/prompts';
import { EXPLANATION_TYPES } from '../src/shared/types';
import { buildCommentInsertions, commentSyntax, explanationToText, formatComment, locateAnchor } from '../src/shared/comments';

const CODE = ['#include <iostream>', 'int main() {', '    int a, b;', '    cin >> a >> b;', '    cout << a + b;', '}'].join('\n');

describe('comments', () => {
  it('uses the right comment syntax per language', () => {
    expect(commentSyntax('cpp').open).toBe('//');
    expect(commentSyntax('python').open).toBe('#');
    expect(commentSyntax('sql').open).toBe('--');
    expect(formatComment('css', 'x')).toEqual(['/* x */']);
  });

  it('wraps long explanations into several comment lines', () => {
    const lines = formatComment('cpp', 'word '.repeat(40), 30);
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(l.startsWith('// ')).toBe(true);
  });

  it('anchors comments to the explained lines', () => {
    const ins = buildCommentInsertions(CODE, 'cpp', [{ fromLine: 4, toLine: 5, text: 'Read and sum.' }, { fromLine: 99, toLine: 99, text: 'out of range' }]);
    expect(ins).toEqual([{ line: 4, anchor: '    cin >> a >> b;', lines: ['// Read and sum.'] }]);
  });

  it('finds anchors after the code shifted', () => {
    const lines = ['// added', ...CODE.split('\n')];
    expect(locateAnchor(lines, 4, '    cin >> a >> b;')).toBe(4);
    expect(locateAnchor(CODE.split('\n'), 4, '    cin >> a >> b;')).toBe(3);
    expect(locateAnchor(CODE.split('\n'), 4, 'not here')).toBe(-1);
  });

  it('formats page-box text', () => {
    const ex = { summary: 'Sums two numbers.', annotations: [{ fromLine: 3, toLine: 4, text: 'Reads input.' }, { fromLine: 5, toLine: 5, text: 'Prints.' }] };
    expect(explanationToText(ex, false)).toBe('Sums two numbers.\n\nLine notes:\n- Lines 3-4: Reads input.\n- Line 5: Prints.');
    const withSummary = buildCommentInsertions(CODE, 'cpp', ex.annotations, 'Algorithm: Direct sum\nComplexity: Time O(1), Space O(1)');
    expect(withSummary[0]).toEqual({ line: 3, anchor: '    int a, b;', lines: ['// Algorithm: Direct sum', '// Complexity: Time O(1), Space O(1)'] });
    expect(explanationToText({ summary: 's', annotations: [{ fromLine: 3, toLine: 4, text: 'Reads input.' }] }, true)).toBe('Reads input.');
  });

  it('gives the model an exact format for every explanation type', () => {
    for (const t of EXPLANATION_TYPES) expect(EXPLANATION_FORMATS[t]).toBeTruthy();
    const msg = buildExplainUserMessage(CODE, 'cpp', 'Algorithm', null, false);
    expect(msg).toMatch(/REQUIRED FORMAT/);
    expect(msg).toMatch(/Algorithm: <name/);
    expect(msg).toMatch(/Why it works:/);
    expect(buildExplainUserMessage(CODE, 'cpp', 'Complexity', { from: 3, to: 4 }, false)).toMatch(/Time: O\(<\.\.\.>\)/);
  });

  it('validates explanation replies', () => {
    expect(parseExplanation('{"summary":"s","annotations":[{"fromLine":1,"toLine":2,"text":"t"}]}').ok).toBe(true);
    expect(parseExplanation('{"summary":"s","annotations":[{"fromLine":0,"toLine":2,"text":"t"}]}').ok).toBe(false);
    expect(parseExplanation('{"annotations":[]}').ok).toBe(false);
  });
});

describe('agent nudges', () => {
  it('tells the model about the final step and about steps without progress', async () => {
    const contexts: AgentContext[] = [];
    const provider: AIProvider = {
      async generateActions(ctx) {
        contexts.push(ctx);
        return { actions: [{ type: 'inspect' }], done: false }; // never finishes, never edits
      },
    };
    const env: AgentEnvironment = {
      observe: async () => ({
        editor: { kind: 'textarea', label: 't', language: 'cpp', lineCount: 1 },
        code: 'x',
        cursor: null,
        selectedText: '',
        errors: [],
        pageContext: '',
        warnings: [],
      }),
      execute: async () => ({ ok: true }),
      checkpoint: async () => {},
      status: () => {},
      log: () => {},
    };
    const r = await new Agent(provider, env, { task: 't', language: 'cpp', referenceCode: '', model: 'm', maxIterations: 4, visionEnabled: false, verbose: false }).run();
    expect(r.status).toBe('max_iterations');
    expect(r.message).toMatch(/Edits made so far are kept/);
    expect(contexts[2].note).toMatch(/has not changed/);
    expect(contexts[3].note).toMatch(/FINAL step/);
  });
});
