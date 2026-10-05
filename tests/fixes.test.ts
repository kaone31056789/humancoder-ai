import { describe, expect, it } from 'vitest';
import { StopError } from '../src/ai/Agent';
import { parseFixedCode } from '../src/ai/schemas';
import { RunControl } from '../src/content/RunControl';
import { buildFixTask, fixItems } from '../src/shared/fixes';
import type { CodeAnalysis } from '../src/shared/types';

const analysis: CodeAnalysis = {
  language: 'cpp',
  summary: 'max average subarray',
  issues: [
    { line: 1, severity: 'warning', message: 'Avoid <bits/stdc++.h>' },
    { line: 26, severity: 'info', message: 'Use cout for consistency' },
  ],
  suggestions: ['Replace printf with cout'],
};

describe('analysis fixes', () => {
  it('preselects real issues but not info notes or suggestions', () => {
    const items = fixItems(analysis);
    expect(items.map((i) => [i.label, i.preselected])).toEqual([
      ['warning (line 1): Avoid <bits/stdc++.h>', true],
      ['info (line 26): Use cout for consistency', false],
      ['suggestion: Replace printf with cout', false],
    ]);
  });

  it('builds a bounded, numbered agent task', () => {
    const task = buildFixTask(['warning (line 1): Avoid <bits/stdc++.h>', 'suggestion: Replace printf with cout']);
    expect(task).toMatch(/1\. warning \(line 1\)/);
    expect(task).toMatch(/2\. suggestion/);
    expect(buildFixTask(Array(200).fill('x'.repeat(100))).length).toBeLessThanOrEqual(4000);
  });

  it('validates corrected-code replies', () => {
    expect(parseFixedCode('{"code":"int main(){}","changes":["removed bits header"]}').ok).toBe(true);
    expect(parseFixedCode('{"code":"","changes":[]}').ok).toBe(false);
    expect(parseFixedCode('{"changes":[]}').ok).toBe(false);
  });
});

describe('RunControl with an injected timer (background-tab mode)', () => {
  it('uses the provided wait function and larger slices when hidden', async () => {
    const calls: number[] = [];
    const control = new RunControl(async (ms) => void calls.push(ms), () => true);
    await control.sleep(600);
    expect(calls).toEqual([250, 250, 100]);
  });

  it('still honours stop between slices', async () => {
    let n = 0;
    const control = new RunControl(async () => {
      if (++n === 2) control.stop();
    }, () => true);
    await expect(control.sleep(5000)).rejects.toBeInstanceOf(StopError);
    expect(n).toBe(2);
  });
});
