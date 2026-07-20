import type { HunchApi } from "../../ports/hunch.js";
import type { ServiceContext, ServiceHandler } from "../service-registry.js";
import {
  composeForecast,
  confidenceFor,
  type ProvenanceEntry,
} from "../forecast/composer.js";
import {
  matchQuestion,
  openMarkets,
  MATCH_THRESHOLD,
  type MatchCandidate,
} from "../forecast/matcher.js";
import { ForecastInputSchema, parseQuestion } from "../forecast/schema.js";

/** How many near-miss markets we price before returning a no_market. */
const PRICED_NEAR_MISSES = 3;

/**
 * A near-miss, priced. The market did NOT clear the match threshold, so this is
 * explicitly NOT an answer to the question asked — but it IS a live, real-money
 * reading of the closest thing the book is pricing. Returning slugs and scores
 * alone (the old behaviour) made a no_market worth nothing to the buyer; a
 * priced near-miss lets them decide for themselves whether it is close enough.
 *
 * Fail-soft: a quote that will not read is omitted rather than guessed.
 */
async function priceNearMisses(
  hunch: HunchApi,
  candidates: readonly MatchCandidate[],
): Promise<Array<Record<string, unknown>>> {
  return Promise.all(
    candidates.slice(0, PRICED_NEAR_MISSES).map(async (candidate) => {
      const base = {
        marketSlug: candidate.market.slug,
        question: candidate.market.question,
        score: candidate.score,
        threshold: MATCH_THRESHOLD,
        marketUrl: candidate.market.links.app,
        deadlineAt: candidate.market.deadlineAt,
      };
      const quoteRead = await hunch
        .quote(candidate.market.id, { side: "yes", sizeUsd: 1 })
        .catch(() => null);
      if (!quoteRead) return { ...base, priced: false };
      const { stats, odds } = quoteRead.data;
      const yesCents =
        typeof (odds as { yesPriceCents?: number }).yesPriceCents === "number"
          ? (odds as { yesPriceCents: number }).yesPriceCents
          : null;
      return {
        ...base,
        priced: true,
        // Pool-implied YES price for THIS market — not for the question asked.
        probability: yesCents === null ? null : yesCents / 100,
        poolUsd: stats.totalPoolUsd,
        totalBets: stats.totalBets,
        confidence: confidenceFor(stats.totalPoolUsd, stats.totalBets),
      };
    }),
  );
}

/**
 * `forecast` — the flagship service. Money-weighted probability for a free-text
 * question, matched deterministically against the live Hunch catalogue.
 *
 * Outcomes:
 *  - matched  → probability + odds + pool depth + confidence + provenance
 *  - no match → status:"no_market" + a spawnHint the caller can feed straight
 *               into the `spawn` service (the upsell is part of the schema)
 *  - bad input → throws; the provider loop rejects the order and CAPVault
 *               refunds the escrow (fail-soft, never fake)
 */
export function createForecastService(hunch: HunchApi): ServiceHandler {
  return {
    name: "forecast",
    async handle(ctx: ServiceContext): Promise<Record<string, unknown>> {
      const parsed = ForecastInputSchema.safeParse(
        ctx.input ?? { question: ctx.requirements },
      );
      if (!parsed.success) {
        throw new Error(
          `invalid forecast input: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
            .join("; ")}. Expected {"question": string, "token"?: string, "type"?: string, "horizonDays"?: number}`,
        );
      }

      const question = parseQuestion(parsed.data);
      // Discover rides along because factory-minted (spawned) markets surface
      // there, not in the static catalogue — advisory, so a discover outage
      // never sinks the order.
      const [catalogueRead, discoverRead] = await Promise.all([
        hunch.catalogue(),
        hunch.discover(question.raw, 8).catch(() => null),
      ]);
      const catalogueProvenance: ProvenanceEntry = {
        source: "playhunch.xyz partner catalogue (open markets)",
        url: catalogueRead.url,
        readAt: catalogueRead.readAt,
      };
      const provenance: ProvenanceEntry[] = [catalogueProvenance];
      const extras = (discoverRead?.data.matches ?? []).map((match) => ({
        ...match.market,
        categoryKey: match.market.category,
        tokenSymbols: match.market.tokenSymbol ? [match.market.tokenSymbol] : [],
      }));
      if (discoverRead) {
        provenance.push({
          source: "playhunch.xyz partner discover (live + factory markets)",
          url: discoverRead.url,
          readAt: discoverRead.readAt,
        });
      }

      const result = matchQuestion(
        question,
        catalogueRead.data,
        ctx.clock,
        extras,
      );

      if (!result.best) {
        const tokenGuess = question.tokenHint ?? question.cashtags[0] ?? null;
        // A no_market still has to earn its price. Two things make it useful:
        // the closest live markets PRICED (below), and — when the asked-for
        // token has no book at all — the list of tokens that do, so the buyer
        // can re-ask productively instead of just being told "no".
        const nearMisses = await priceNearMisses(hunch, result.candidates);
        const covered = new Set<string>();
        for (const market of openMarkets(catalogueRead.data, ctx.clock.now())) {
          if (market.tokenSymbol) covered.add(market.tokenSymbol.toUpperCase());
          for (const s of market.tokenSymbols ?? []) covered.add(s.toUpperCase());
        }
        return {
          service: "forecast",
          status: "no_market",
          question: question.raw,
          openMarketsSearched: result.openMarkets,
          bestScore: result.candidates[0]?.score ?? 0,
          threshold: MATCH_THRESHOLD,
          nearMisses,
          coverage: {
            note: "Tokens the desk currently has live, tradeable markets for. Re-ask against one of these for a priced answer, or spawn a market for yours.",
            tokensWithLiveMarkets: [...covered].sort(),
            askedToken: tokenGuess,
            askedTokenCovered: tokenGuess ? covered.has(tokenGuess.toUpperCase()) : null,
          },
          spawnHint: {
            service: "spawn",
            note: "No live market matches this question. The Hunch Market Desk `spawn` service can mint a real market for it on playhunch.xyz — your question becomes a tradeable instrument that humans and agents then price.",
            input: {
              ...(tokenGuess ? { token: tokenGuess } : {}),
              ...(question.usdTargets.length > 0
                ? { targetUsd: question.usdTargets[question.usdTargets.length - 1] }
                : {}),
              ...(question.horizonDays ? { horizonDays: question.horizonDays } : {}),
            },
          },
          provenance,
          asOf: ctx.clock.now().toISOString(),
        };
      }

      const quoteRead = await hunch.quote(result.best.market.id, {
        side: "yes",
        sizeUsd: 1,
      });
      const forecast = composeForecast(result.best, quoteRead, provenance);

      return {
        service: "forecast",
        status: "ok",
        question: question.raw,
        ...forecast,
        asOf: ctx.clock.now().toISOString(),
      };
    },
  };
}
