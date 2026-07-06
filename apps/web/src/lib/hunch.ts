/** Read-only playhunch.xyz partner API reads for the spawned-market gallery. */

const HUNCH_API = process.env.HUNCH_API_URL ?? "https://www.playhunch.xyz";

export interface SpawnedMarket {
  id: string;
  slug: string;
  question: string;
  url: string;
  deadlineAt: string;
  status: string;
  odds: { yesPriceCents: number; noPriceCents: number } | null;
  poolUsd: number;
  totalBets: number;
}

/**
 * Markets the desk has spawned through the production factory. Seeded from
 * env (`SPAWNED_MARKET_IDS`, comma-separated) — the worker appends every paid
 * spawn there; the flywheel's first market is the default seed.
 */
export async function fetchSpawnedMarkets(): Promise<SpawnedMarket[]> {
  const ids = (process.env.SPAWNED_MARKET_IDS ?? "factory-virtual-1b-2026-08-05")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const markets: SpawnedMarket[] = [];
  for (const id of ids) {
    try {
      const response = await fetch(
        `${HUNCH_API}/api/partner/quote?marketId=${encodeURIComponent(id)}&side=yes&sizeUsd=1`,
        { next: { revalidate: 60 } },
      );
      if (!response.ok) continue;
      const body = (await response.json()) as {
        market: {
          id: string;
          slug: string;
          question: string;
          deadlineAt: string;
          status: string;
          links: { app: string };
        };
        odds: { yesPriceCents?: number; noPriceCents?: number };
        stats: { totalPoolUsd: number; totalBets: number };
      };
      markets.push({
        id: body.market.id,
        slug: body.market.slug,
        question: body.market.question,
        url: body.market.links.app,
        deadlineAt: body.market.deadlineAt,
        status: body.market.status,
        odds:
          typeof body.odds.yesPriceCents === "number"
            ? {
                yesPriceCents: body.odds.yesPriceCents,
                noPriceCents: body.odds.noPriceCents ?? 100 - body.odds.yesPriceCents,
              }
            : null,
        poolUsd: body.stats.totalPoolUsd,
        totalBets: body.stats.totalBets,
      });
    } catch {
      // A missing market never breaks the gallery.
    }
  }
  return markets;
}
