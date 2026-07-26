/** Provider-agnostic AI contract. Adding a vendor means adding one adapter. */
export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AiProvider {
  readonly name: string;
  /** True when credentials are present and the SDK could be constructed. */
  readonly isReady: boolean;
  complete(request: CompletionRequest): Promise<string>;
}
