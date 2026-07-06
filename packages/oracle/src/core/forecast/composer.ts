import type {
  HunchQuote,
  HunchRead,
  HunchYesNoOdds,
} from "../../ports/hunch.js";
import type { MatchCandidate } from "./matcher.js";

/**
 * Turns a matched market + live quote into the forecast deliverable fields.
 * The probability IS the pool-implied YES price — people with money on the
 * line, not a model's vibes. Confidence is a function of how much money.
 *
 * Never fabricates: when there is no betting history the odds are the seeded
 * 50/50 prior and confidence says so ("prior_only").
 */
export type Confidence = "high" | "medium" | "low" | "prior_only";

export interface ProvenanceEntry {
  source: string;
  url: string;
  readAt: string;
  note?: string;
}

export interface ComposedForecast {
  probability: number;
  side: "yes";
  marketId: string;
  marketSlug: string;
  marketUrl: string;
  marketQuestion: string;
  category: string;
  deadlineAt: string;
  odds: Record<string, number>;
  poolUsd: number;
  totalBets: number;
  confidence: Confidence;
  method: string;
  matchScore: number;
  tokenSnapshot: Record<string, unknown> | null;
  ladder: Record<string, unknown> | null;
  provenance: ProvenanceEntry[];
}

export function confidenceFor(poolUsd: number, totalBets: number): Confidence {
  if (poolUsd >= 100 && totalBets >= 10) return "high";
  if (poolUsd >= 25 && totalBets >= 3) return "medium";
  if (poolUsd > 0) return "low";
  return "prior_only";
}

function isYesNoOdds(odds: HunchQuote["odds"]): odds is HunchYesNoOdds {
  return (
    typeof (odds as HunchYesNoOdds).yesPriceCents === "number" &&
    typeof (odds as HunchYesNoOdds).noPriceCents === "number"
  );
}

export function composeForecast(
  match: MatchCandidate,
  quoteRead: HunchRead<HunchQuote>,
  baseProvenance: ProvenanceEntry[],
): ComposedForecast {
  const quote = quoteRead.data;
  const market = quote.market;
  const stats = quote.stats;

  const provenance: ProvenanceEntry[] = [
    ...baseProvenance,
    {
      source: "playhunch.xyz partner quote (live parimutuel book)",
      url: quoteRead.url,
      readAt: quoteRead.readAt,
    },
  ];
  if (quote.tokenSnapshot) {
    provenance.push({
      source: quote.tokenSnapshot.source,
      url: quote.tokenSnapshot.sourceUrl,
      readAt: quote.tokenSnapshot.observedAt,
      note: "token reading backing this market's resolution",
    });
  }

  let probability: number;
  let odds: Record<string, number>;
  let method: string;
  if (isYesNoOdds(quote.odds)) {
    probability = quote.odds.yesPriceCents / 100;
    odds = { yes: quote.odds.yesPriceCents, no: quote.odds.noPriceCents };
    method =
      "pool_implied_odds: probability = YES price from the live parimutuel pool (virtual liquidity seeded)";
  } else {
    odds = quote.odds;
    const entries = Object.entries(quote.odds).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const top = entries[0];
    probability = top ? top[1] / 100 : 0;
    method =
      "pool_implied_ladder: probability = top outcome's price from the live parimutuel book; see odds for the full ladder";
  }

  return {
    probability,
    side: "yes",
    marketId: market.id,
    marketSlug: market.slug,
    marketUrl: market.links.app,
    marketQuestion: market.question,
    category: market.category,
    deadlineAt: market.deadlineAt,
    odds,
    poolUsd: stats.totalPoolUsd,
    totalBets: stats.totalBets,
    confidence: confidenceFor(stats.totalPoolUsd, stats.totalBets),
    method,
    matchScore: match.score,
    tokenSnapshot: quote.tokenSnapshot
      ? { ...quote.tokenSnapshot }
      : null,
    ladder: quote.ladder
      ? {
          outcomes: quote.ladder.outcomes.map((outcome) => ({ ...outcome })),
          currentBucketKey: quote.ladder.currentBucketKey ?? null,
          currentMarketCapUsd: quote.ladder.currentMarketCapUsd ?? null,
        }
      : null,
    provenance,
  };
}
