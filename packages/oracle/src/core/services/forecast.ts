import type { HunchApi } from "../../ports/hunch.js";
import type { ServiceContext, ServiceHandler } from "../service-registry.js";
import { composeForecast, type ProvenanceEntry } from "../forecast/composer.js";
import { matchQuestion, MATCH_THRESHOLD } from "../forecast/matcher.js";
import { ForecastInputSchema, parseQuestion } from "../forecast/schema.js";

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
        return {
          service: "forecast",
          status: "no_market",
          question: question.raw,
          openMarketsSearched: result.openMarkets,
          bestScore: result.candidates[0]?.score ?? 0,
          threshold: MATCH_THRESHOLD,
          nearMisses: result.candidates.slice(0, 3).map((c) => ({
            marketSlug: c.market.slug,
            question: c.market.question,
            score: c.score,
          })),
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
