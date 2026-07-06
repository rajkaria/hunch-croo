import type {
  HunchApi,
  HunchCatalogue,
  HunchDiscoverMatch,
  HunchMarketResult,
  HunchMintResult,
  HunchQuote,
  HunchRead,
  HunchTrendingEntry,
  HunchVerifyClaim,
  HunchVerifyResult,
} from "../../ports/hunch.js";
import { HunchApiError } from "../../ports/hunch.js";

/**
 * Real Hunch partner-API adapter. Read-only public endpoints — no key needed.
 * Retries once on network/5xx (reads are idempotent); 4xx surfaces immediately
 * as HunchApiError so callers can distinguish "no such market" from an outage.
 */
export interface HunchClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface MetaEnvelope {
  meta?: { generatedAt?: string };
  error?: string;
}

export class HunchClient implements HunchApi {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HunchClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async get<T extends MetaEnvelope>(path: string): Promise<HunchRead<T>> {
    const url = `${this.baseUrl}${path}`;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (response.status >= 500) {
          lastError = new HunchApiError(
            `hunch api ${response.status}`,
            response.status,
            url,
          );
          continue; // retry 5xx once
        }
        const body = (await response.json()) as T;
        if (!response.ok) {
          throw new HunchApiError(
            body.error ?? `hunch api ${response.status}`,
            response.status,
            url,
          );
        }
        return {
          data: body,
          url,
          readAt: body.meta?.generatedAt ?? new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof HunchApiError && error.status < 500) throw error;
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new HunchApiError(String(lastError), 0, url);
  }

  async catalogue(): Promise<HunchRead<HunchCatalogue>> {
    return this.get<HunchCatalogue & MetaEnvelope>("/api/partner/catalogue");
  }

  async quote(
    marketId: string,
    opts?: { side?: "yes" | "no"; outcome?: string; sizeUsd?: number },
  ): Promise<HunchRead<HunchQuote>> {
    const params = new URLSearchParams({ marketId });
    if (opts?.side) params.set("side", opts.side);
    if (opts?.outcome) params.set("outcome", opts.outcome);
    if (opts?.sizeUsd !== undefined) params.set("sizeUsd", String(opts.sizeUsd));
    return this.get<HunchQuote & MetaEnvelope>(
      `/api/partner/quote?${params.toString()}`,
    );
  }

  async trending(
    limit = 8,
  ): Promise<HunchRead<{ trending: HunchTrendingEntry[] }>> {
    return this.get<{ trending: HunchTrendingEntry[] } & MetaEnvelope>(
      `/api/partner/trending?limit=${limit}`,
    );
  }

  async discover(
    query: string,
    limit = 5,
  ): Promise<HunchRead<{ count: number; matches: HunchDiscoverMatch[] }>> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return this.get<{ count: number; matches: HunchDiscoverMatch[] } & MetaEnvelope>(
      `/api/partner/discover?${params.toString()}`,
    );
  }

  /**
   * POST helper. Mutations are NOT retried — the caller decides; mint is
   * idempotent upstream but a double-submit still burns rate-limit budget.
   * Writes get a longer leash than reads: verify replays observation history
   * and mint round-trips the factory, both legitimately slower than a quote.
   */
  private async post<T extends MetaEnvelope>(
    path: string,
    body: unknown,
  ): Promise<HunchRead<T>> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs * 3);
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        signal: controller.signal,
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = (await response.json()) as T;
      if (!response.ok) {
        throw new HunchApiError(
          parsed.error ?? `hunch api ${response.status}`,
          response.status,
          url,
        );
      }
      return {
        data: parsed,
        url,
        readAt: parsed.meta?.generatedAt ?? new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async result(
    marketId: string,
  ): Promise<HunchRead<{ result: HunchMarketResult }>> {
    const params = new URLSearchParams({ marketId });
    return this.get<{ result: HunchMarketResult } & MetaEnvelope>(
      `/api/partner/result?${params.toString()}`,
    );
  }

  async verifyClaim(
    claim: HunchVerifyClaim,
  ): Promise<HunchRead<HunchVerifyResult>> {
    return this.post<HunchVerifyResult & MetaEnvelope>(
      "/api/partner/verify",
      claim,
    );
  }

  async mint(input: {
    symbol: string;
    horizonDays?: number;
    multiplier?: number;
  }): Promise<HunchRead<HunchMintResult>> {
    return this.post<HunchMintResult & MetaEnvelope>("/api/partner/mint", input);
  }
}
