import type {
  HunchApi,
  HunchCatalogue,
  HunchDiscoverMatch,
  HunchQuote,
  HunchRead,
  HunchTrendingEntry,
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
}

export class MockHunchApi implements HunchApi {
  constructor(private readonly fixtures: MockHunchFixtures) {}

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
}
