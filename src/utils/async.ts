/** Small async primitives: sleep, timeout, retry with exponential backoff. */
import { toError } from './errors';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Rejects if `promise` does not settle within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
  shouldRetry?: (error: Error) => boolean;
}

/**
 * Computes an exponential backoff delay (optionally jittered) for `attempt`
 * (1-based), clamped to `maxDelayMs`.
 */
export function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  factor = 2,
  jitter = false,
): number {
  const raw = baseDelayMs * Math.pow(factor, Math.max(0, attempt - 1));
  const clamped = Math.min(raw, maxDelayMs);
  if (!jitter) return Math.round(clamped);
  // Full jitter keeps retries from synchronising across queue workers.
  return Math.round(clamped / 2 + Math.random() * (clamped / 2));
}

/** Runs `fn`, retrying failures with exponential backoff. */
export async function retry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 30_000,
    factor = 2,
    jitter = true,
    onRetry,
    shouldRetry = () => true,
  } = options;

  let lastError: Error = new Error('retry: no attempts made');
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = toError(err);
      if (attempt >= attempts || !shouldRetry(lastError)) break;
      const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs, factor, jitter);
      onRetry?.(lastError, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}
