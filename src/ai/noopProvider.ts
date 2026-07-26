/** Fallback provider used when AI is disabled or unconfigured. */
import type { AiProvider, CompletionRequest } from './provider';

export class NoopProvider implements AiProvider {
  public readonly name = 'none';
  public readonly isReady = false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async complete(_request: CompletionRequest): Promise<string> {
    throw new Error('AI provider is not configured (AI_PROVIDER=none or missing API key).');
  }
}
