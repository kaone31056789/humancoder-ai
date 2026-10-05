import { AIError, type AIErrorCode, type AIProvider } from '../ai/provider';
import { validateAgentResponse, type AgentContext, type AgentResponse } from '../ai/schemas';
import { sendToBackground } from '../shared/messages';

/**
 * Content-side AIProvider: forwards planning requests to the background worker (which holds the
 * API key and calls OpenRouter) and re-validates the returned actions before they are executed.
 */
export class BackgroundAIProvider implements AIProvider {
  async generateActions(context: AgentContext): Promise<AgentResponse> {
    const res = await sendToBackground({ type: 'AI_ACTIONS', context });
    if (!res.ok) throw new AIError((res.code as AIErrorCode) ?? 'server', res.error);
    const checked = validateAgentResponse(res.response);
    if (!checked.ok) throw new AIError('invalid_response', `Rejected actions from background: ${checked.error}`);
    return checked.value;
  }
}
