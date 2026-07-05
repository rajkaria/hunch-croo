import { z } from "zod";
import type { HunchApi, HunchYesNoOdds } from "../../ports/hunch.js";
import type { ServiceContext, ServiceHandler } from "../service-registry.js";
import { confidenceFor, type ProvenanceEntry } from "../forecast/composer.js";
import { openMarkets } from "../forecast/matcher.js";

/**
 * `sentiment` — crowd conviction for a token, aggregated across every live
 * Hunch YES/NO market that prices it. The lean is a pool-weighted mean of the
 * YES probabilities: markets with more USDC behind them pull harder. Ladders
 * are surfaced as context but excluded from the lean (their outcomes aren't a
 * single bullish/bearish axis).
 */
const SentimentInputSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\$?[a-zA-Z0-9]{1,20}$/, "token symbol like AIXBT or $aixbt"),
});

const MAX_QUOTED_MARKETS = 4;

export function createSentimentService(hunch: HunchApi): ServiceHandler {
  return {
    name: "sentiment",
    async handle(ctx: ServiceContext): Promise<Record<string, unknown>> {
      const parsed = SentimentInputSchema.safeParse(
        ctx.input ?? { token: ctx.requirements.trim() },
      );
      if (!parsed.success) {
        throw new Error(
          `invalid sentiment input: expected {"token": "SYMBOL"} — ${parsed.error.issues[0]?.message ?? "bad input"}`,
        );
      }
      const symbol = parsed.data.token.replace(/^\$/, "").toUpperCase();

      const catalogueRead = await hunch.catalogue();
      const provenance: ProvenanceEntry[] = [
        {
          source: "playhunch.xyz partner catalogue (open markets)",
          url: catalogueRead.url,
          readAt: catalogueRead.readAt,
        },
      ];

      const tokenMarkets = openMarkets(catalogueRead.data, ctx.clock.now()).filter(
        (market) => {
          const symbols = new Set(
            [market.tokenSymbol ?? "", ...(market.tokenSymbols ?? [])].map((s) =>
              s.toUpperCase(),
            ),
          );
          return symbols.has(symbol);
        },
      );

      if (tokenMarkets.length === 0) {
        return {
          service: "sentiment",
          status: "no_signal",
          token: symbol,
          note: "No live Hunch market prices this token yet.",
          spawnHint: {
            service: "spawn",
            note: "The Hunch Market Desk `spawn` service can mint a market for this token — crowd conviction accrues the moment humans start pricing it.",
            input: { token: symbol },
          },
          provenance,
          asOf: ctx.clock.now().toISOString(),
        };
      }

      // Deterministic pick: nearest deadlines first — the most immediate
      // crowd signal — with id as the stable tiebreak.
      const chosen = [...tokenMarkets]
        .sort(
          (a, b) =>
            Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt) ||
            a.id.localeCompare(b.id),
        )
        .slice(0, MAX_QUOTED_MARKETS);

      const signals: Array<Record<string, unknown>> = [];
      let weightedYes = 0;
      let weightSum = 0;
      let poolUsdTotal = 0;
      let betsTotal = 0;

      for (const market of chosen) {
        const quoteRead = await hunch.quote(market.id, { side: "yes", sizeUsd: 1 });
        provenance.push({
          source: "playhunch.xyz partner quote (live parimutuel book)",
          url: quoteRead.url,
          readAt: quoteRead.readAt,
        });
        const quote = quoteRead.data;
        const odds = quote.odds as HunchYesNoOdds;
        const isYesNo = typeof odds.yesPriceCents === "number";
        poolUsdTotal += quote.stats.totalPoolUsd;
        betsTotal += quote.stats.totalBets;
        signals.push({
          marketId: market.id,
          marketSlug: market.slug,
          question: market.question,
          category: market.category,
          deadlineAt: market.deadlineAt,
          url: market.links.app,
          kind: isYesNo ? "yes_no" : "ladder",
          odds: isYesNo
            ? { yes: odds.yesPriceCents, no: odds.noPriceCents }
            : { ...(quote.odds as Record<string, number>) },
          poolUsd: quote.stats.totalPoolUsd,
          totalBets: quote.stats.totalBets,
          inLean: isYesNo,
        });
        if (isYesNo) {
          // +1 keeps unbet books in the mean without letting them dominate.
          const weight = quote.stats.totalPoolUsd + 1;
          weightedYes += (odds.yesPriceCents / 100) * weight;
          weightSum += weight;
        }
      }

      const leanScore = weightSum > 0 ? weightedYes / weightSum : 0.5;
      const rounded = Math.round(leanScore * 100) / 100;
      const lean =
        rounded >= 0.6 ? "bullish" : rounded <= 0.4 ? "bearish" : "neutral";
      const conviction = Math.round(Math.abs(rounded - 0.5) * 200) / 100;

      return {
        service: "sentiment",
        status: "ok",
        token: symbol,
        lean,
        leanScore: rounded,
        conviction,
        quality: confidenceFor(poolUsdTotal, betsTotal),
        marketsConsidered: tokenMarkets.length,
        marketsQuoted: chosen.length,
        poolUsdTotal,
        betsTotal,
        method:
          "pool_weighted_yes: lean = mean of YES prices across the token's live YES/NO books, weighted by pool USD (+1 floor); ladders reported but excluded from the lean",
        signals,
        provenance,
        asOf: ctx.clock.now().toISOString(),
      };
    },
  };
}
