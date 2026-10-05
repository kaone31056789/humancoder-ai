// Background service worker: owns the API key and all OpenRouter traffic, injects page scripts
// on demand, persists session state for the popup, and captures screenshots for Vision Mode.

import { OpenRouterClient } from '../ai/OpenRouterClient';
import { isAIError } from '../ai/provider';
import type { AgentContext } from '../ai/schemas';
import { LIMITS } from '../shared/config';
import { sendToTab, type BackgroundRequest, type Failure } from '../shared/messages';
import { redactSecrets } from '../shared/redact';
import { getCachedModels, getSession, getSettings, setCachedModels } from '../shared/storage';
import { EXPLANATION_TYPES, type ExplanationType, type ModelInfo, type RunRequest, type Settings } from '../shared/types';
import { ensureInjected, unscriptableReason } from './inject';
import { resetSession, sessionLog, updateSession } from './session';
import { captureRegion } from './vision';

const MODEL_CACHE_MS = 24 * 60 * 60 * 1000;

function fail(e: unknown): Failure {
  if (isAIError(e)) return { ok: false, error: e.message, code: e.code };
  return { ok: false, error: redactSecrets((e as Error)?.message ?? String(e)) };
}

function clientFor(settings: Settings): OpenRouterClient {
  return new OpenRouterClient({
    apiKey: settings.apiKey,
    model: settings.model,
    visionModel: settings.visionModel,
    timeoutMs: settings.requestTimeoutMs,
    denyDataCollection: settings.privateProviders,
    onDebug: settings.debug ? (m) => void sessionLog('debug', `[openrouter] ${m}`) : undefined,
  });
}

/** Calling an extension API every 20s keeps the service worker alive during long model calls. */
async function withKeepAlive<T>(work: Promise<T>): Promise<T> {
  const timer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20000);
  try {
    return await work;
  } finally {
    clearInterval(timer);
  }
}

/** Bounds the sizes of a context coming from the content script before it reaches a prompt. */
function sanitizeContext(ctx: AgentContext, settings: Settings): AgentContext {
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const obs = ctx.observation ?? ({} as AgentContext['observation']);
  return {
    task: s(ctx.task, LIMITS.maxTaskLength),
    language: s(ctx.language, 40) || 'unknown',
    referenceCode: s(ctx.referenceCode, LIMITS.maxPastedCode),
    model: s(ctx.model, 200) || settings.model,
    iteration: Math.max(1, Math.min(LIMITS.maxIterationsCeiling, Number(ctx.iteration) || 1)),
    maxIterations: Math.max(1, Math.min(LIMITS.maxIterationsCeiling, Number(ctx.maxIterations) || 1)),
    note: ctx.note ? s(ctx.note, 1000) : undefined,
    history: Array.isArray(ctx.history) ? ctx.history.slice(-8) : [],
    observation: {
      editor: obs.editor ?? null,
      code: s(obs.code, 2_000_000),
      cursor: obs.cursor ?? null,
      selectedText: s(obs.selectedText, 5000),
      errors: Array.isArray(obs.errors) ? obs.errors.slice(0, 20).map((e) => s(e, 1500)) : [],
      pageContext: s(obs.pageContext, LIMITS.maxPageContext),
      visionNotes: obs.visionNotes ? s(obs.visionNotes, 10000) : undefined,
      warnings: Array.isArray(obs.warnings) ? obs.warnings.slice(0, 10).map((w) => s(w, 300)) : [],
    },
  };
}

async function handle(msg: BackgroundRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    // ----- popup / options -----
    case 'START': {
      const settings = await getSettings();
      if (msg.request.mode === 'agent' && !settings.apiKey) {
        return { ok: false, error: 'Add your OpenRouter API key in Settings before using the agent.', code: 'missing_key' };
      }
      const tab = await chrome.tabs.get(msg.tabId).catch(() => null);
      const blocked = unscriptableReason(tab?.url);
      if (blocked) return { ok: false, error: blocked, code: 'unsupported_page' };

      const injected = await ensureInjected(msg.tabId);
      if (!injected.ok) return { ok: false, error: injected.error, code: 'inject' };

      const request: RunRequest = {
        ...msg.request,
        code: msg.request.code.slice(0, LIMITS.maxPastedCode),
        task: msg.request.task.slice(0, LIMITS.maxTaskLength),
        comments: Array.isArray(msg.request.comments)
          ? msg.request.comments.slice(0, 40).map((c) => ({
              line: Math.max(1, Math.trunc(Number(c.line)) || 1),
              anchor: String(c.anchor ?? '').slice(0, 500),
              lines: (Array.isArray(c.lines) ? c.lines : []).slice(0, 30).map((l) => String(l).slice(0, 400)),
            }))
          : undefined,
        model: msg.request.model || settings.model,
        maxIterations: settings.maxIterations,
        visionEnabled: settings.visionEnabled,
        debug: settings.debug,
      };
      await resetSession(msg.tabId);
      await updateSession(
        { running: true, status: 'detecting', detail: 'Starting', maxIterations: request.maxIterations },
        [{ t: Date.now(), level: 'info', msg: `Session started (${request.mode} mode)` }],
      );
      const res = await sendToTab(msg.tabId, { type: 'HC_RUN', request });
      if (!res.ok) {
        await updateSession({ running: false, status: 'error', detail: res.error }, [{ t: Date.now(), level: 'error', msg: res.error }]);
      }
      return res;
    }

    case 'CONTROL': {
      const res = await sendToTab(msg.tabId, { type: 'HC_CONTROL', command: msg.command, typing: msg.typing });
      return res.ok ? res : { ok: false, error: 'No running session in this tab.', code: 'idle' };
    }

    case 'DETECT':
    case 'READ_EDITOR': {
      const tab = await chrome.tabs.get(msg.tabId).catch(() => null);
      const blocked = unscriptableReason(tab?.url);
      if (blocked) return { ok: false, error: blocked, code: 'unsupported_page' };
      const injected = await ensureInjected(msg.tabId);
      if (!injected.ok) return { ok: false, error: injected.error, code: 'inject' };
      return sendToTab(msg.tabId, msg.type === 'DETECT' ? { type: 'HC_DETECT' } : { type: 'HC_READ', preferCode: !!msg.preferCode });
    }

    case 'ANALYZE': {
      const settings = await getSettings();
      const code = String(msg.code ?? '').slice(0, LIMITS.maxPastedCode);
      if (!code.trim()) return { ok: false, error: 'Nothing to analyse: paste code or read it from the editor.' };
      try {
        const analysis = await withKeepAlive(clientFor(settings).analyze(code, msg.language || 'auto', msg.model));
        return { ok: true, analysis };
      } catch (e) {
        return fail(e);
      }
    }

    case 'LIST_MODELS': {
      const cached = await getCachedModels<ModelInfo>();
      if (cached && !msg.force && Date.now() - cached.at < MODEL_CACHE_MS) return { ok: true, models: cached.models };
      try {
        const models = await OpenRouterClient.listModels();
        await setCachedModels(models);
        return { ok: true, models };
      } catch (e) {
        if (cached) return { ok: true, models: cached.models };
        return fail(e);
      }
    }

    case 'TEST_KEY': {
      const settings = await getSettings();
      const apiKey = typeof msg.apiKey === 'string' && msg.apiKey.trim() ? msg.apiKey.trim() : settings.apiKey;
      try {
        const info = await new OpenRouterClient({ apiKey, model: settings.model }).keyInfo();
        return { ok: true, ...info };
      } catch (e) {
        return fail(e);
      }
    }

    case 'CLEAR_SESSION': {
      const s = await getSession();
      if (s.running) return { ok: false, error: 'Stop the running session first.' };
      await resetSession(null);
      return { ok: true };
    }

    // ----- content script -----
    case 'AI_ACTIONS': {
      if (!sender.tab) return { ok: false, error: 'Not allowed' };
      const settings = await getSettings();
      try {
        const response = await withKeepAlive(clientFor(settings).generateActions(sanitizeContext(msg.context, settings)));
        return { ok: true, response };
      } catch (e) {
        return fail(e);
      }
    }

    case 'VISION_INSPECT': {
      if (!sender.tab?.windowId) return { ok: false, error: 'Not allowed' };
      const settings = await getSettings();
      if (!settings.visionEnabled) return { ok: false, error: 'Vision Mode is disabled in Settings.' };
      try {
        const image = await captureRegion(sender.tab.windowId, msg.rect, msg.viewport);
        const notes = await withKeepAlive(clientFor(settings).describeScreenshot(image, String(msg.task ?? '')));
        const text = [
          `editor visible: ${notes.editorFound}`,
          notes.cursor && `caret: ${notes.cursor}`,
          notes.errors?.length && `errors:\n${notes.errors.join('\n')}`,
          notes.output && `output:\n${notes.output}`,
          notes.buttons?.length && `buttons: ${notes.buttons.join(', ')}`,
          notes.visibleCode && `visible code:\n${notes.visibleCode}`,
          notes.notes && `notes: ${notes.notes}`,
        ]
          .filter(Boolean)
          .join('\n');
        return { ok: true, notes: text };
      } catch (e) {
        return fail(e);
      }
    }

    case 'TIMER': {
      // Wake-up service for content scripts in hidden tabs (their own timers are throttled).
      if (!sender.tab) return { ok: false, error: 'Not allowed' };
      const ms = Math.max(0, Math.min(5000, Number(msg.ms) || 0));
      await new Promise((r) => setTimeout(r, ms));
      return { ok: true };
    }

    case 'EXPLAIN': {
      const settings = await getSettings();
      const code = String(msg.code ?? '').slice(0, LIMITS.maxPastedCode);
      if (!code.trim()) return { ok: false, error: 'Nothing to explain: paste code or use Read code.' };
      const lineCount = code.split('\n').length;
      let range: { from: number; to: number } | null = null;
      if (msg.range) {
        const from = Math.trunc(Number(msg.range.from));
        const to = Math.trunc(Number(msg.range.to));
        if (!(from >= 1 && to >= from && from <= lineCount)) {
          return { ok: false, error: `Invalid line range: the code has ${lineCount} lines.` };
        }
        range = { from, to: Math.min(to, lineCount) };
      }
      const style = EXPLANATION_TYPES.includes(msg.style as ExplanationType) ? msg.style : 'Observation';
      try {
        const explanation = await withKeepAlive(
          clientFor(settings).explain(code, msg.language || 'auto', style, range, !!msg.detailed, msg.model || settings.explainModel),
        );
        // Keep annotations inside the code (and inside the requested range).
        const lo = range?.from ?? 1;
        const hi = range?.to ?? lineCount;
        explanation.annotations = explanation.annotations
          .map((a) => ({ ...a, fromLine: Math.min(Math.max(a.fromLine, lo), hi), toLine: Math.min(Math.max(a.toLine, lo), hi) }))
          .map((a) => (a.toLine < a.fromLine ? { ...a, toLine: a.fromLine } : a));
        return { ok: true, explanation };
      } catch (e) {
        return fail(e);
      }
    }

    case 'FIX_CODE': {
      const settings = await getSettings();
      const code = String(msg.code ?? '').slice(0, LIMITS.maxPastedCode);
      const fixes = Array.isArray(msg.fixes) ? msg.fixes.slice(0, 40).map((f) => String(f).slice(0, 500)) : [];
      if (!code.trim()) return { ok: false, error: 'There is no code to fix.' };
      if (!fixes.length) return { ok: false, error: 'Select at least one issue or suggestion to fix.' };
      try {
        const result = await withKeepAlive(clientFor(settings).fixCode(code, msg.language || 'auto', fixes, msg.model));
        return { ok: true, ...result };
      } catch (e) {
        return fail(e);
      }
    }

    case 'SESSION_UPDATE': {
      if (!sender.tab?.id) return { ok: false, error: 'Not allowed' };
      const current = await getSession();
      if (current.tabId !== null && current.tabId !== sender.tab.id) return { ok: true }; // stale tab
      await updateSession({ ...msg.patch, tabId: sender.tab.id }, Array.isArray(msg.logs) ? msg.logs.slice(0, 100) : []);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Unknown message' };
}

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse(fail(e)));
  return true;
});

// Page navigation / tab close kills the content script — reflect that instead of looking stuck.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'loading') return;
  const s = await getSession();
  if (s.running && s.tabId === tabId) {
    await updateSession({ running: false, status: 'error', detail: 'The page navigated or reloaded; session aborted.' }, [
      { t: Date.now(), level: 'error', msg: 'Page navigated or reloaded — session aborted' },
    ]);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await getSession();
  if (s.running && s.tabId === tabId) {
    await updateSession({ running: false, status: 'error', detail: 'The tab was closed.' });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const s = await getSession();
  if (!s.running || s.tabId === null) return;
  await sendToTab(s.tabId, { type: 'HC_CONTROL', command: command === 'stop-session' ? 'stop' : 'toggle' });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});
