/** Google Gemini adapter (default provider). */
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { config } from '../config';
import { withTimeout } from '../utils/async';
import type { AiProvider, CompletionRequest } from './provider';

export class GeminiProvider implements AiProvider {
  public readonly name = 'gemini';
  private model: GenerativeModel | null = null;

  constructor(
    private readonly apiKey: string | undefined = config.ai.gemini.apiKey,
    private readonly modelName: string = config.ai.gemini.model,
  ) {
    if (this.apiKey) {
      this.model = new GoogleGenerativeAI(this.apiKey).getGenerativeModel({ model: this.modelName });
    }
  }

  public get isReady(): boolean {
    return this.model !== null;
  }

  async complete(request: CompletionRequest): Promise<string> {
    if (!this.model) throw new Error('GEMINI_API_KEY is not configured.');
    const result = await withTimeout(
      this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `${request.system}\n\n---\n\n${request.user}` }] }],
        generationConfig: {
          maxOutputTokens: request.maxTokens ?? config.ai.maxTokens,
          temperature: request.temperature ?? config.ai.temperature,
        },
      }),
      config.ai.timeoutMs,
      'gemini.generateContent',
    );
    return result.response.text().trim();
  }
}
