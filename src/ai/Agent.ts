// The agent loop: OBSERVE → UNDERSTAND/PLAN (model) → ACT (validated actions) → OBSERVE AGAIN → CORRECT.
// Environment-agnostic: the content script supplies observe/execute; any AIProvider supplies the plan.

import type { LogLevel, Observation, SessionStatus } from '../shared/types';
import { isAIError, type AIProvider } from './provider';
import { describeAction, type AgentAction, type AgentContext, type HistoryEntry } from './schemas';

export interface ActionOutcome {
  ok: boolean;
  message?: string;
}

export interface AgentEnvironment {
  observe(opts: { vision: boolean; reason?: string }): Promise<Observation>;
  execute(action: AgentAction): Promise<ActionOutcome>;
  /** Waits while paused; throws StopError when the user stopped the session. */
  checkpoint(): Promise<void>;
  status(status: SessionStatus, detail: string, iteration?: number): void;
  log(level: LogLevel, msg: string): void;
}

export interface AgentOptions {
  task: string;
  language: string;
  referenceCode: string;
  model: string;
  maxIterations: number;
  visionEnabled: boolean;
  verbose: boolean;
}

export type AgentResultStatus = 'finished' | 'max_iterations' | 'stopped' | 'error';

export interface AgentResult {
  status: AgentResultStatus;
  iterations: number;
  message: string;
}

function joinNotes(a: string | undefined, b: string): string {
  return a ? `${a}\n${b}` : b;
}

export class StopError extends Error {
  constructor() {
    super('Stopped by user');
    this.name = 'StopError';
  }
}

const HISTORY_LIMIT = 6;
const MAX_CONSECUTIVE_FAILURES = 3;
const ERROR_LIKE = /error|exception|traceback|failed|failure|undefined|undeclared|not declared|expected|cannot|unexpected|invalid|segmentation|panic|wrong answer|warning/i;

/** Output panels also show success messages; only error-looking text should trigger corrections. */
export function hasErrorText(errors: string[]): boolean {
  return errors.some((e) => ERROR_LIKE.test(e));
}

export class Agent {
  constructor(
    private readonly provider: AIProvider,
    private readonly env: AgentEnvironment,
    private readonly opts: AgentOptions,
  ) {}

  async run(): Promise<AgentResult> {
    const { env, opts } = this;
    const history: HistoryEntry[] = [];
    let iteration = 0;
    let note: string | undefined;
    let verificationUsed = false;
    let consecutiveFailures = 0;
    let unchangedSteps = 0;

    try {
      env.status('inspecting', 'Reading editor');
      let obs = await env.observe({ vision: false });
      if (!obs.editor) {
        return { status: 'error', iterations: 0, message: 'No supported editor found on this page. Click into the editor and try again.' };
      }
      env.log('info', `Editor: ${obs.editor.label} (${obs.code.length} chars)`);

      while (iteration < opts.maxIterations) {
        iteration++;
        await env.checkpoint();
        if (iteration === opts.maxIterations && opts.maxIterations > 1) {
          note = joinNotes(
            note,
            'This is the FINAL step. If the task is already complete, reply {"actions":[],"done":true}. ' +
              'Otherwise make the remaining edits now and set done=true if they complete the task.',
          );
        }
        const correcting = hasErrorText(obs.errors) || note !== undefined;
        env.status(correcting && iteration > 1 ? 'correcting' : 'planning', 'Waiting for the model', iteration);

        const context: AgentContext = {
          task: opts.task,
          language: opts.language,
          referenceCode: opts.referenceCode,
          observation: obs,
          history: history.slice(-HISTORY_LIMIT),
          iteration,
          maxIterations: opts.maxIterations,
          model: opts.model,
          note,
        };
        const response = await this.provider.generateActions(context);
        await env.checkpoint();
        note = undefined;
        if (response.thought) env.log('info', `Plan: ${response.thought}`);

        // ---- ACT ----
        const executed: string[] = [];
        let failure: string | null = null;
        let inspectRequest: Extract<AgentAction, { type: 'inspect' }> | null = null;

        for (const [i, action] of response.actions.entries()) {
          await env.checkpoint();
          if (action.type === 'inspect') {
            inspectRequest = action;
            break;
          }
          env.status(correcting ? 'correcting' : 'typing', `Action ${i + 1}/${response.actions.length}: ${action.type}`, iteration);
          env.log('action', `Action: ${describeAction(action, opts.verbose)}`);
          const outcome = await env.execute(action);
          executed.push(describeAction(action));
          if (!outcome.ok) {
            failure = `${describeAction(action)} failed: ${outcome.message ?? 'unknown error'}`;
            env.log('warn', failure);
            break;
          }
        }

        // ---- OBSERVE AGAIN ----
        const codeBefore = obs.code;
        const wantVision = !!inspectRequest?.vision;
        if (wantVision && !opts.visionEnabled) {
          env.log('warn', 'Model asked for a vision inspection but Vision Mode is off; using DOM inspection.');
        }
        env.status('inspecting', inspectRequest?.reason ? `Inspecting: ${inspectRequest.reason}` : 'Inspecting editor', iteration);
        obs = await env.observe({ vision: wantVision && opts.visionEnabled, reason: inspectRequest?.reason });

        if (!obs.editor) {
          return { status: 'error', iterations: iteration, message: 'Lost the editor (page changed or editor removed).' };
        }

        const outcome = failure
          ? `FAILED — ${failure}. Remaining actions skipped.`
          : `ok (${executed.length} action${executed.length === 1 ? '' : 's'})` +
            (hasErrorText(obs.errors) ? '; error messages are now visible' : '');
        history.push({ iteration, thought: response.thought, actions: executed, outcome });

        if (failure) {
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            return { status: 'error', iterations: iteration, message: `Stopping: ${consecutiveFailures} failed batches in a row. Last: ${failure}` };
          }
          note = `An action failed: ${failure}. The rest of that batch was not executed. Re-read the current code and continue.`;
          continue;
        }
        consecutiveFailures = 0;

        if (wantVision && !opts.visionEnabled) {
          note = 'Vision mode is disabled by the user; work from the DOM observation.';
        }

        // Models sometimes keep inspecting without ever declaring completion; nudge them.
        unchangedSteps = obs.code === codeBefore && !response.done ? unchangedSteps + 1 : 0;
        if (unchangedSteps >= 2) {
          note = joinNotes(
            note,
            'The code has not changed in the last ' + unchangedSteps + ' steps. If the task is complete, reply {"actions":[],"done":true} now. ' +
              'If something is still missing, make the edit instead of inspecting again.',
          );
        }

        if (response.done) {
          if (hasErrorText(obs.errors) && !verificationUsed) {
            verificationUsed = true;
            note =
              'You marked the task done, but error/output messages are visible (see VISIBLE ERRORS). ' +
              'If they show a real problem in the code, fix it. If they are stale or unrelated, reply with done=true and no actions.';
            env.log('info', 'Verifying: errors visible after completion, asking the model to double-check');
            continue;
          }
          return { status: 'finished', iterations: iteration, message: response.thought ?? 'Task complete' };
        }
      }

      return {
        status: 'max_iterations',
        iterations: iteration,
        message:
          `Stopped after ${opts.maxIterations} steps: the model never confirmed the task was done. Edits made so far are kept - check the editor. ` +
          'Raise "Maximum agent iterations" in Settings or try a stronger model.',
      };
    } catch (e) {
      if (e instanceof StopError) return { status: 'stopped', iterations: iteration, message: 'Stopped by user' };
      const message = isAIError(e) ? e.message : `Unexpected error: ${(e as Error)?.message ?? String(e)}`;
      return { status: 'error', iterations: iteration, message };
    }
  }
}
