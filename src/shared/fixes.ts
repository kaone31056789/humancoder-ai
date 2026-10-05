import { LIMITS } from './config';
import type { CodeAnalysis } from './types';

export interface FixItem {
  id: string;
  kind: 'issue' | 'suggestion';
  label: string;
  /** Selected by default: real issues yes, optional suggestions no. */
  preselected: boolean;
}

/** Flattens an analysis into selectable fix items. */
export function fixItems(analysis: CodeAnalysis): FixItem[] {
  return [
    ...analysis.issues.map((i, n) => ({
      id: `i${n}`,
      kind: 'issue' as const,
      label: `${i.severity}${i.line ? ` (line ${i.line})` : ''}: ${i.message}`,
      preselected: i.severity !== 'info',
    })),
    ...analysis.suggestions.map((s, n) => ({
      id: `s${n}`,
      kind: 'suggestion' as const,
      label: `suggestion: ${s}`,
      preselected: false,
    })),
  ];
}

/** Agent task for "Fix in editor". */
export function buildFixTask(fixes: string[]): string {
  const task =
    'Apply these fixes to the code in the editor using small, targeted edits. Keep everything else unchanged.\n' +
    fixes.map((f, i) => `${i + 1}. ${f}`).join('\n') +
    '\nThe reference code is the code that was analysed. If the editor is empty, type the reference code with the fixes applied.' +
    ' Inspect the editor to verify before marking the task done.';
  return task.slice(0, LIMITS.maxTaskLength);
}
