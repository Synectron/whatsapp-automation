/** OpenAI (and OpenAI-compatible endpoint) adapter. */
import OpenAI from 'openai';
import { config } from '../config';
import { withTimeout } from '../utils/async';
import type { AiProvider, CompletionRequest } from './provider';

export class OpenAiProvider implements AiProvider {
  public readonly name = 'openai';
  private client: OpenAI | null = null;

  constructor(
    private readonly apiKey: string | undefined = config.ai.openai.apiKey,
    private readonly modelName: string = config.ai.openai.model,
    baseURL: string | undefined = config.ai.openai.baseUrl,
  ) {
    if (this.apiKey) {
      this.client = new OpenAI({ apiKey: this.apiKey, ...(baseURL ? { baseURL } : {}) });
    }
  }

  public get isReady(): boolean {
    return this.client !== null;
  }

  async complete(request: CompletionRequest): Promise<string> {
    if (!this.client) throw new Error('OPENAI_API_KEY is not configured.');
    const response = await withTimeout(
      this.client.chat.completions.create({
        model: this.modelName,
        max_tokens: request.maxTokens ?? config.ai.maxTokens,
        temperature: request.temperature ?? config.ai.temperature,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      }),
      config.ai.timeoutMs,
      'openai.chat.completions',
    );
    return (response.choices[0]?.message?.content ?? '').trim();
  }
}
