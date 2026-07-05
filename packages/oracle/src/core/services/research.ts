import { z } from "zod";
import type { HunchApi, HunchCatalogueEntry } from "../../ports/hunch.js";
import type { ServiceContext, ServiceHandler } from "../service-registry.js";
import type { ProvenanceEntry } from "../forecast/composer.js";
import { matchQuestion, openMarkets } from "../forecast/matcher.js";
import { parseQuestion } from "../forecast/schema.js";

/**
 * `research` — the full desk write-up for one market: live odds and pool
 * stats, the token reading backing resolution, the resolution criteria in
 * plain language, related live markets, and trending context. Addressable by
 * exact slug or by free-text question (matched deterministically).
 */
const ResearchInputSchema = z
  .object({
    marketSlug: z.string().trim().min(1).max(120).optional(),
    question: z.string().trim().min(3).max(500).optional(),
  })
  .refine((v) => v.marketSlug || v.question, {
    message: 'provide "marketSlug" or "question"',
  });

const MAX_RELATED = 5;

export function createResearchService(hunch: HunchApi): ServiceHandler {
  return {
    name: "research",
    async handle(ctx: ServiceContext): Promise<Record<string, unknown>> {
      const parsed = ResearchInputSchema.safeParse(
        ctx.input ?? { question: ctx.requirements },
      );
      if (!parsed.success) {
        throw new Error(
          `invalid research input: expected {"marketSlug": string} or {"question": string} — ${parsed.error.issues[0]?.message ?? "bad input"}`,
        );
      }

      const catalogueRead = await hunch.catalogue();
      const provenance: ProvenanceEntry[] = [
        {
          source: "playhunch.xyz partner catalogue (open markets)",
          url: catalogueRead.url,
          readAt: catalogueRead.readAt,
        },
      ];

      // Category disclosures give each market's resolution source in plain
      // language ("Resolves from DexScreener market cap on Base…").
      const disclosureByCategoryKey = new Map<string, string>();
      const entryById = new Map<string, HunchCatalogueEntry>();
      const entryBySlug = new Map<string, HunchCatalogueEntry>();
      for (const category of catalogueRead.data.categories) {
        disclosureByCategoryKey.set(category.key, category.disclosure);
        for (const market of category.markets) {
          entryById.set(market.id, market);
          entryBySlug.set(market.slug, market);
        }
      }

      let marketId: string | null = null;
      let matchScore: number | null = null;
      if (parsed.data.marketSlug) {
        const bySlug =
          entryById.get(parsed.data.marketSlug) ??
          entryBySlug.get(parsed.data.marketSlug);
        // Pass unknown slugs through: the quote endpoint resolves recurring
        // round ids the catalogue doesn't carry verbatim.
        marketId = bySlug?.id ?? parsed.data.marketSlug;
      } else if (parsed.data.question) {
        const result = matchQuestion(
          parseQuestion({ question: parsed.data.question }),
          catalogueRead.data,
          ctx.clock,
        );
        if (!result.best) {
          return {
            service: "research",
            status: "no_market",
            question: parsed.data.question,
            openMarketsSearched: result.openMarkets,
            nearMisses: result.candidates.slice(0, 3).map((c) => ({
              marketSlug: c.market.slug,
              question: c.market.question,
              score: c.score,
            })),
            spawnHint: {
              service: "spawn",
              note: "No live market matches. The Hunch Market Desk `spawn` service can mint one — then this research order becomes answerable.",
              input: {},
            },
            provenance,
            asOf: ctx.clock.now().toISOString(),
          };
        }
        marketId = result.best.market.id;
        matchScore = result.best.score;
      }

      if (!marketId) throw new Error("unreachable: no market resolved");

      const quoteRead = await hunch.quote(marketId, { side: "yes", sizeUsd: 1 });
      provenance.push({
        source: "playhunch.xyz partner quote (live parimutuel book)",
        url: quoteRead.url,
        readAt: quoteRead.readAt,
      });
      const quote = quoteRead.data;
      const market = quote.market;
      if (quote.tokenSnapshot) {
        provenance.push({
          source: quote.tokenSnapshot.source,
          url: quote.tokenSnapshot.sourceUrl,
          readAt: quote.tokenSnapshot.observedAt,
          note: "token reading backing this market's resolution",
        });
      }

      const catalogueEntry = entryById.get(market.id) ?? null;
      const disclosure = catalogueEntry
        ? (disclosureByCategoryKey.get(catalogueEntry.categoryKey) ?? null)
        : null;

      // Related: other open markets sharing a token symbol (or, failing that,
      // the same category), nearest deadline first.
      const symbols = new Set(
        [market.tokenSymbol ?? "", ...(catalogueEntry?.tokenSymbols ?? [])]
          .filter(Boolean)
          .map((s) => s.toUpperCase()),
      );
      const related = openMarkets(catalogueRead.data, ctx.clock.now())
        .filter((m) => m.id !== market.id)
        .map((m) => {
          const mSymbols = [m.tokenSymbol ?? "", ...(m.tokenSymbols ?? [])]
            .filter(Boolean)
            .map((s) => s.toUpperCase());
          const sharesToken = mSymbols.some((s) => symbols.has(s));
          const sharesCategory = m.category === market.category;
          return { m, weight: sharesToken ? 2 : sharesCategory ? 1 : 0 };
        })
        .filter((x) => x.weight > 0)
        .sort(
          (a, b) =>
            b.weight - a.weight ||
            Date.parse(a.m.deadlineAt) - Date.parse(b.m.deadlineAt) ||
            a.m.id.localeCompare(b.m.id),
        )
        .slice(0, MAX_RELATED)
        .map(({ m }) => ({
          marketId: m.id,
          marketSlug: m.slug,
          question: m.question,
          category: m.category,
          deadlineAt: m.deadlineAt,
          url: m.links.app,
        }));

      // Trending context — advisory, so a trending outage never sinks the order.
      let trendingRank: number | null = null;
      try {
        const trendingRead = await hunch.trending(8);
        provenance.push({
          source: "playhunch.xyz partner trending",
          url: trendingRead.url,
          readAt: trendingRead.readAt,
        });
        const hit = trendingRead.data.trending.find(
          (t) => t.market.id === market.id,
        );
        trendingRank = hit?.rank ?? null;
      } catch {
        trendingRank = null;
      }

      return {
        service: "research",
        status: "ok",
        ...(matchScore !== null ? { matchScore } : {}),
        market: {
          marketId: market.id,
          marketSlug: market.slug,
          question: market.question,
          summary: market.summary,
          category: market.category,
          tokenSymbol: market.tokenSymbol,
          chainId: market.chainId,
          status: market.status,
          deadlineAt: market.deadlineAt,
          feeBps: market.feeBps,
          url: market.links.app,
        },
        odds: quote.odds,
        stats: { ...quote.stats },
        ...(quote.ladder
          ? {
              ladder: {
                outcomes: quote.ladder.outcomes.map((o) => ({ ...o })),
                currentBucketKey: quote.ladder.currentBucketKey ?? null,
              },
            }
          : {}),
        tokenSnapshot: quote.tokenSnapshot ? { ...quote.tokenSnapshot } : null,
        resolutionCriteria: {
          summary: market.summary,
          ...(disclosure ? { disclosure } : {}),
          deadlineAt: market.deadlineAt,
          category: market.category,
        },
        related,
        trendingRank,
        provenance,
        asOf: ctx.clock.now().toISOString(),
      };
    },
  };
}
