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
 * Fixture-backed Hunch adapter: replays recorded live responses so the entire
 * forecast brain tests deterministically with zero network. Fixtures are
 * captured verbatim from playhunch.xyz (see test/fixtures/).
 */
export interface MockHunchFixtures {
  catalogue: HunchCatalogue;
  /** marketId → recorded quote response. */
  quotes?: Record<string, HunchQuote>;
  trending?: { trending: HunchTrendingEntry[] };
  /** query → recorded discover response. */
  discoveries?: Record<string, { count: number; matches: HunchDiscoverMatch[] }>;
  /** Fixed readAt stamp so payloads are byte-stable across runs. */
  readAt?: string;
  /**
   * When a quote isn't recorded, synthesize a deterministic seeded-book quote
   * (50/50, zero pool) from the catalogue entry instead of 404ing — lets
   * golden tests exercise the full forecast path for any matched market.
   */
  synthesizeQuotes?: boolean;
  /** JSON(claim) → recorded verify result. Unrecorded claims 404. */
  verifications?: Record<string, HunchVerifyResult>;
  /** Uppercased symbol → recorded mint result. Unrecorded symbols 422. */
  mints?: Record<string, HunchMintResult>;
  /**
   * marketId → sequence of result payloads; each read consumes the next entry
   * (last repeats) so tests can script pending → pending → resolved.
   */
  resultSequences?: Record<string, HunchMarketResult[]>;
  /** marketId → sequence of quotes; each read consumes the next (last repeats). */
  quoteSequences?: Record<string, HunchQuote[]>;
}

export class MockHunchApi implements HunchApi {
  private readonly sequenceCursors = new Map<string, number>();

  constructor(private readonly fixtures: MockHunchFixtures) {}

  private nextInSequence<T>(mapKey: string, sequence: T[]): T | null {
    if (sequence.length === 0) return null;
    const cursor = this.sequenceCursors.get(mapKey) ?? 0;
    this.sequenceCursors.set(mapKey, cursor + 1);
    return sequence[Math.min(cursor, sequence.length - 1)] ?? null;
  }

  private read<T>(data: T, path: string): HunchRead<T> {
    return {
      data,
      url: `https://mock.playhunch.xyz${path}`,
      readAt: this.fixtures.readAt ?? "2026-07-05T00:00:00.000Z",
    };
  }

  async catalogue(): Promise<HunchRead<HunchCatalogue>> {
    return this.read(this.fixtures.catalogue, "/api/partner/catalogue");
  }

  async quote(marketId: string): Promise<HunchRead<HunchQuote>> {
    const sequence = this.fixtures.quoteSequences?.[marketId];
    if (sequence) {
      const next = this.nextInSequence(`quote:${marketId}`, sequence);
      if (next) return this.read(next, `/api/partner/quote?marketId=${marketId}`);
    }
    const quote = this.fixtures.quotes?.[marketId];
    if (quote) {
      return this.read(quote, `/api/partner/quote?marketId=${marketId}`);
    }
    if (this.fixtures.synthesizeQuotes) {
      for (const category of this.fixtures.catalogue.categories) {
        for (const market of category.markets) {
          if (market.id !== marketId) continue;
          const synthesized: HunchQuote = {
            market,
            side: "yes",
            odds: { yesPriceCents: 50, noPriceCents: 50 },
            stats: { totalBets: 0, totalPoolUsd: 0, feeUsd: 0 },
            tokenSnapshot: null,
          };
          return this.read(synthesized, `/api/partner/quote?marketId=${marketId}`);
        }
      }
    }
    throw new HunchApiError(
      "market_not_found",
      404,
      `https://mock.playhunch.xyz/api/partner/quote?marketId=${marketId}`,
    );
  }

  async trending(): Promise<HunchRead<{ trending: HunchTrendingEntry[] }>> {
    return this.read(
      this.fixtures.trending ?? { trending: [] },
      "/api/partner/trending",
    );
  }

  async discover(
    query: string,
  ): Promise<HunchRead<{ count: number; matches: HunchDiscoverMatch[] }>> {
    const found = this.fixtures.discoveries?.[query] ?? { count: 0, matches: [] };
    return this.read(found, `/api/partner/discover?q=${encodeURIComponent(query)}`);
  }

  async result(
    marketId: string,
  ): Promise<HunchRead<{ result: HunchMarketResult }>> {
    const sequence = this.fixtures.resultSequences?.[marketId];
    const next = sequence
      ? this.nextInSequence(`result:${marketId}`, sequence)
      : null;
    if (!next) {
      throw new HunchApiError(
        "market_not_found",
        404,
        `https://mock.playhunch.xyz/api/partner/result?marketId=${marketId}`,
      );
    }
    return this.read(
      { result: next },
      `/api/partner/result?marketId=${marketId}`,
    );
  }

  async verifyClaim(
    claim: HunchVerifyClaim,
  ): Promise<HunchRead<HunchVerifyResult>> {
    const recorded = this.fixtures.verifications?.[JSON.stringify(claim)];
    if (!recorded) {
      throw new HunchApiError(
        "invalid_claim",
        422,
        "https://mock.playhunch.xyz/api/partner/verify",
      );
    }
    return this.read(recorded, "/api/partner/verify");
  }

  async mint(input: {
    symbol: string;
    horizonDays?: number;
    multiplier?: number;
  }): Promise<HunchRead<HunchMintResult>> {
    const recorded = this.fixtures.mints?.[input.symbol.toUpperCase()];
    if (!recorded) {
      throw new HunchApiError(
        "token_not_pinned",
        422,
        "https://mock.playhunch.xyz/api/partner/mint",
      );
    }
    return this.read(recorded, "/api/partner/mint");
  }
}
