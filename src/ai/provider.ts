import type { AgentContext, AgentResponse } from './schemas';

/** The "brain" abstraction. OpenRouterClient implements it in the background worker;
 *  the content script uses a thin proxy that forwards to the background. */
export interface AIProvider {
  generateActions(context: AgentContext): Promise<AgentResponse>;
}

export type AIErrorCode =
  | 'missing_key'
  | 'invalid_key'
  | 'insufficient_credits'
  | 'forbidden'
  | 'rate_limited'
  | 'model_unavailable'
  | 'bad_request'
  | 'timeout'
  | 'network'
  | 'server'
  | 'invalid_response'
  | 'cancelled';

export class AIError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AIError';
  }

  get retryable(): boolean {
    return this.code === 'rate_limited' || this.code === 'server' || this.code === 'network' || this.code === 'timeout';
  }
}

export function isAIError(e: unknown): e is AIError {
  return e instanceof Error && e.name === 'AIError' && 'code' in e;
}
