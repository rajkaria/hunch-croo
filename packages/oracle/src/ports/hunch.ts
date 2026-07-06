/**
 * Hunch partner API port — the read surface the forecast/sentiment/research
 * services depend on. The real adapter speaks HTTPS to playhunch.xyz; the mock
 * adapter replays recorded fixtures so the whole brain tests credential- and
 * network-free.
 *
 * Every read carries its source URL and the upstream-reported timestamp so the
 * provenance chain is built from what the source said, not our local clock.
 */

export interface HunchMarketOutcome {
  key: string;
  label: string;
  shortLabel?: string;
  lowerUsd?: number | null;
  upperUsd?: number | null;
}

export interface HunchMarketRef {
  id: string;
  slug: string;
  question: string;
  shortTitle: string;
  summary: string;
  category: string;
  tokenSymbol: string | null;
  chainId: string | null;
  deadlineAt: string;
  deadlineLabel: string;
  status: string;
  feeBps: number;
  defaultTicketUsd: number;
  virtualLiquidityUsd: number;
  targetMarketCapUsd: number | null;
  outcomes: HunchMarketOutcome[] | null;
  links: { app: string; quote: string; trade: string };
}

export interface HunchCatalogueEntry extends HunchMarketRef {
  categoryKey: string;
  tokenSymbols: string[];
}

export interface HunchCatalogue {
  count: number;
  categories: Array<{
    key: string;
    label: string;
    description: string;
    disclosure: string;
    count: number;
    markets: HunchCatalogueEntry[];
  }>;
}

export interface HunchYesNoOdds {
  yesPriceCents: number;
  noPriceCents: number;
}

export interface HunchMarketStats {
  totalBets: number;
  totalPoolUsd: number;
  yesPoolUsd?: number;
  noPoolUsd?: number;
  feeUsd: number;
}

export interface HunchTokenSnapshot {
  tokenSymbol: string;
  currentMarketCapUsd?: number | null;
  currentPriceUsd?: number | null;
  targetMarketCapUsd?: number | null;
  distanceToTargetPct?: number | null;
  reachedTarget?: boolean;
  source: string;
  sourceUrl: string;
  observedAt: string;
}

export interface HunchLadderOutcome {
  key: string;
  label: string;
  shortLabel?: string;
  lowerUsd?: number | null;
  upperUsd?: number | null;
  impliedPct: number;
  backedUsd: number;
  isCurrent: boolean;
}

export interface HunchLadder {
  outcomes: HunchLadderOutcome[];
  currentBucketKey?: string | null;
  currentMarketCapUsd?: number | null;
  totalBackedUsd?: number;
}

export interface HunchQuote {
  market: HunchMarketRef;
  side: string | null;
  odds: HunchYesNoOdds | Record<string, number>;
  stats: HunchMarketStats;
  tokenSnapshot: HunchTokenSnapshot | null;
  ladder?: HunchLadder;
  quote?: {
    side: string | null;
    priceCents: number;
    grossUsd: number;
    feeUsd: number;
    netUsd: number;
    shares: number;
    feeRecipient?: string;
  };
}

export interface HunchTrendingEntry {
  rank: number;
  heat: number;
  closesInHours: number;
  market: HunchMarketRef;
  odds: HunchYesNoOdds | null;
  outcomeOdds: Record<string, number> | null;
  stats: HunchMarketStats;
  headline: string;
}

export interface HunchDiscoverMatch {
  market: HunchMarketRef;
  odds?: HunchYesNoOdds;
  stats?: HunchMarketStats;
  score?: number;
  reason?: string;
}

/** A read + where it came from + when the upstream says it was generated. */
export interface HunchRead<T> {
  data: T;
  url: string;
  readAt: string;
}

export class HunchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "HunchApiError";
  }
}

/** Structured claim for `/api/partner/verify` (whitelisted families only). */
export type HunchVerifyClaim =
  | { family: "mcap_at_least"; token: string; lineUsd: number; onDay?: string }
  | { family: "price_at_least"; token: string; lineUsd: number; onDay?: string }
  | { family: "mcap_flip"; token: string; versusToken: string }
  | { family: "chain_dex_volume_7d"; chain: string; versusChain: string };

export interface HunchVerifyResult {
  verdict: "yes" | "no" | "indeterminate";
  claim: Record<string, unknown>;
  reading: Record<string, unknown> | null;
  method: string;
  reason?: string;
  provenance: Array<{ source: string; url: string | null; readAt: string; note?: string }>;
  asOf: string;
}

export interface HunchMintResult {
  status: "minted" | "exists";
  marketId?: string;
  market: HunchMarketRef | null;
}

export interface HunchApi {
  catalogue(): Promise<HunchRead<HunchCatalogue>>;
  quote(
    marketId: string,
    opts?: { side?: "yes" | "no"; outcome?: string; sizeUsd?: number },
  ): Promise<HunchRead<HunchQuote>>;
  trending(limit?: number): Promise<HunchRead<{ trending: HunchTrendingEntry[] }>>;
  discover(
    query: string,
    limit?: number,
  ): Promise<HunchRead<{ count: number; matches: HunchDiscoverMatch[] }>>;
  /** POST /api/partner/verify — throws HunchApiError on 4xx (bad claim / unvetted token). */
  verifyClaim(claim: HunchVerifyClaim): Promise<HunchRead<HunchVerifyResult>>;
  /** POST /api/partner/mint — throws HunchApiError on 4xx (not pinned / rate limited). */
  mint(input: {
    symbol: string;
    horizonDays?: number;
    multiplier?: number;
  }): Promise<HunchRead<HunchMintResult>>;
}
