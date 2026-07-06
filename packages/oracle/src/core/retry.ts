import type { Sleeper } from "../ports/runtime.js";

export interface RetryOptions {
  /** Number of RETRIES after the first attempt (total attempts = retries + 1). */
  retries: number;
  /** Base backoff in ms; delay before retry N (1-indexed) is baseMs * 2^(N-1). */
  baseMs: number;
  sleeper: Sleeper;
  /** Retry only when this returns true. Default: retry every error. Use to skip
   *  terminal errors (bad input, 4xx) so we never pointlessly hammer CAP. */
  shouldRetry?: (error: unknown) => boolean;
  /** Called with the 1-indexed attempt number just before each backoff. */
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Bounded retry with exponential backoff over an injected Sleeper (so tests run
 * instantly). Used to ride out transient CAP transport blips (network drops,
 * 429/5xx) without leaving escrow stuck — a genuinely failed call still throws
 * after the budget, and the periodic sweep is the final backstop.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const shouldRetry = opts.shouldRetry ?? (() => true);
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === opts.retries || !shouldRetry(error)) throw error;
      opts.onRetry?.(attempt + 1, error);
      await opts.sleeper.sleep(opts.baseMs * 2 ** attempt);
    }
  }
  throw lastError;
}
