import { z } from "zod";
import type {
  HunchApi,
  HunchCatalogueEntry,
  HunchQuote,
  HunchYesNoOdds,
} from "../../ports/hunch.js";
import type { ServiceContext, ServiceHandler } from "../service-registry.js";
import { confidenceFor, type ProvenanceEntry } from "../forecast/composer.js";
import { matchQuestion, MATCH_THRESHOLD } from "../forecast/matcher.js";
import { parseQuestion } from "../forecast/schema.js";
import { priceLeg, round2, round4, stakeForCoverage } from "../hedge/leg.js";

/**
 * `hedge-quote` — the Market Desk's NON-CUSTODIAL hedge service. Given a market
 * and the outcome a caller wants to be paid on if a feared scenario happens,
 * the desk prices an executable trade plan: stake, shares, payout, break-even
 * and the exact `/api/partner/trade` call. The desk never touches the caller's
 * funds — it hands back a plan the caller signs itself and keeps custody the
 * whole way.
 *
 * Money-path invariants:
 *  - the LLM never sizes a hedge — a deterministic per-order cap does
 *    (`HEDGE_QUOTE_MAX_STAKE_USD`, default $10). Over-cap requests are clamped,
 *    never silently honoured.
 *  - economics are reproduced deterministically from the live marginal price +
 *    the market fee (fee = stake·feeBps/1e4; net = stake−fee; shares =
 *    net/(price); payout = shares·$1) — verified against recorded quotes.
 *  - no fabricated "edge": the book price IS the desk's probability, so the
 *    desk never claims to beat it. Pool depth / confidence / token reality are
 *    surfaced as advisory context, never a directive to trade.
 *  - fail-soft, never fake: an unknown market or dead outcome throws → the
 *    provider loop rejects the order and CAPVault refunds the escrow.
 */
export const HedgeQuoteInputSchema = z
  .object({
    marketSlug: z.string().trim().min(1).max(120).optional(),
    question: z.string().trim().min(3).max(500).optional(),
    token: z
      .string()
      .trim()
      .regex(/^\$?[a-zA-Z0-9]{1,20}$/)
      .optional(),
    type: z.string().trim().max(50).optional(),
    horizonDays: z.number().int().positive().max(730).optional(),
    /** For yes/no markets: the side that pays in the feared scenario. */
    side: z.enum(["yes", "no"]).optional(),
    /** For ladder / multi-outcome markets: the outcome key that pays. */
    outcome: z.string().trim().min(1).max(60).optional(),
    /** Premium to spend (clamped to the desk cap). */
    stakeUsd: z.number().positive().max(100_000).optional(),
    /** Desired payout if the hedge hits — the desk back-solves the stake. */
    coverageUsd: z.number().positive().max(100_000).optional(),
  })
  .refine((v) => Boolean(v.marketSlug) || Boolean(v.question), {
    message: 'provide "marketSlug" or "question"',
  })
  .refine((v) => Number(Boolean(v.side)) + Number(Boolean(v.outcome)) === 1, {
    message: 'provide exactly one of "side" (yes/no) or "outcome" (a ladder key)',
  })
  .refine(
    (v) =>
      Number(v.stakeUsd !== undefined) + Number(v.coverageUsd !== undefined) === 1,
    { message: 'provide exactly one of "stakeUsd" or "coverageUsd"' },
  );

export interface HedgeQuoteOptions {
  /** Deterministic per-order stake cap in USD (default $10). */
  maxStakeUsd?: number;
}

function isYesNoOdds(odds: HunchQuote["odds"]): odds is HunchYesNoOdds {
  return (
    typeof (odds as HunchYesNoOdds).yesPriceCents === "number" &&
    typeof (odds as HunchYesNoOdds).noPriceCents === "number"
  );
}

function contextNote(
  confidence: ReturnType<typeof confidenceFor>,
): string {
  switch (confidence) {
    case "high":
      return "Deep book — this price reflects meaningful real money. Advisory only; the desk prices the hedge, it does not tell you to take it.";
    case "medium":
      return "Moderately traded book. Advisory only; the desk prices the hedge, it does not tell you to take it.";
    case "low":
      return "Thinly traded — only a small real pool backs this price, so it can move fast. Advisory only, never a directive.";
    default:
      return "No real money has priced this outcome yet — the book is the seeded prior. Treat the hedge price as soft and re-quote before executing. Advisory only, never a directive.";
  }
}

export function createHedgeQuoteService(
  hunch: HunchApi,
  options: HedgeQuoteOptions = {},
): ServiceHandler {
  const maxStakeUsd = options.maxStakeUsd ?? 10;
  return {
    name: "hedge-quote",
    async handle(ctx: ServiceContext): Promise<Record<string, unknown>> {
      const parsed = HedgeQuoteInputSchema.safeParse(ctx.input);
      if (!parsed.success) {
        throw new Error(
          `invalid hedge-quote input: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
            .join("; ")}. Expected {"marketSlug"|"question", "side"|"outcome", "stakeUsd"|"coverageUsd"}`,
        );
      }
      const req = parsed.data;

      // Catalogue resolves slugs → ids and backs deterministic question
      // matching (identical to research/forecast).
      const catalogueRead = await hunch.catalogue();
      const provenance: ProvenanceEntry[] = [
        {
          source: "playhunch.xyz partner catalogue (open markets)",
          url: catalogueRead.url,
          readAt: catalogueRead.readAt,
        },
      ];
      const entryById = new Map<string, HunchCatalogueEntry>();
      const entryBySlug = new Map<string, HunchCatalogueEntry>();
      for (const category of catalogueRead.data.categories) {
        for (const market of category.markets) {
          entryById.set(market.id, market);
          entryBySlug.set(market.slug, market);
        }
      }

      let marketId: string;
      let matchScore: number | null = null;
      if (req.marketSlug) {
        const entry = entryBySlug.get(req.marketSlug) ?? entryById.get(req.marketSlug);
        // Unknown slugs pass through — recurring rounds resolve at the quote
        // endpoint even when the catalogue doesn't carry them verbatim.
        marketId = entry?.id ?? req.marketSlug;
      } else {
        const question = parseQuestion({
          question: req.question!,
          ...(req.token ? { token: req.token } : {}),
          ...(req.type ? { type: req.type } : {}),
          ...(req.horizonDays ? { horizonDays: req.horizonDays } : {}),
        });
        // Discover rides along: factory-minted (spawned) markets surface there,
        // so a freshly spawned market is hedgeable — advisory, so an outage
        // never sinks the order.
        const discoverRead = await hunch.discover(question.raw, 8).catch(() => null);
        const extras = (discoverRead?.data.matches ?? []).map((m) => ({
          ...m.market,
          categoryKey: m.market.category,
          tokenSymbols: m.market.tokenSymbol ? [m.market.tokenSymbol] : [],
        }));
        if (discoverRead) {
          provenance.push({
            source: "playhunch.xyz partner discover (live + factory markets)",
            url: discoverRead.url,
            readAt: discoverRead.readAt,
          });
        }
        const result = matchQuestion(question, catalogueRead.data, ctx.clock, extras);
        if (!result.best) {
          const tokenGuess = question.tokenHint ?? question.cashtags[0] ?? null;
          return {
            service: "hedge-quote",
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
              note: "No live market prices this risk. The Hunch Market Desk `spawn` service can mint one on playhunch.xyz — then it becomes hedgeable here.",
              input: {
                ...(tokenGuess ? { token: tokenGuess } : {}),
                ...(question.horizonDays ? { horizonDays: question.horizonDays } : {}),
              },
            },
            provenance,
            asOf: ctx.clock.now().toISOString(),
          };
        }
        marketId = result.best.market.id;
        matchScore = result.best.score;
      }

      // One live read — the odds carry the marginal price for every outcome;
      // economics are computed from it, not from any sized echo.
      const quoteRead = await hunch.quote(marketId, { sizeUsd: 1 });
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

      // Resolve the hedged outcome + its price, validated against the book shape.
      let priceCents: number;
      let outcomeLabel: string | null = null;
      let execTarget: { side: string } | { outcome: string };
      if (isYesNoOdds(quote.odds)) {
        if (!req.side) {
          throw new Error(
            `"${market.slug}" is a yes/no market — specify "side": "yes" or "no", not an outcome.`,
          );
        }
        priceCents = req.side === "yes" ? quote.odds.yesPriceCents : quote.odds.noPriceCents;
        outcomeLabel = req.side.toUpperCase();
        execTarget = { side: req.side };
      } else {
        if (!req.outcome) {
          const keys = Object.keys(quote.odds);
          throw new Error(
            `"${market.slug}" is a ladder/multi-outcome market — specify an "outcome" key, one of: ${keys.join(", ")}.`,
          );
        }
        const oddsRecord = quote.odds as Record<string, number>;
        if (!(req.outcome in oddsRecord)) {
          throw new Error(
            `unknown outcome "${req.outcome}" for "${market.slug}" — valid keys: ${Object.keys(oddsRecord).join(", ")}.`,
          );
        }
        priceCents = oddsRecord[req.outcome]!;
        outcomeLabel =
          quote.ladder?.outcomes.find((o) => o.key === req.outcome)?.label ?? req.outcome;
        execTarget = { outcome: req.outcome };
      }
      if (!(priceCents > 0)) {
        throw new Error(
          `outcome has no live price on "${market.slug}" — cannot price a hedge against a dead outcome.`,
        );
      }

      const price = priceCents / 100;
      const feeRate = market.feeBps / 10_000;

      // Size the premium. coverageUsd back-solves the stake needed for the
      // desired payout, then the shared leg pricer clamps + derives economics
      // (one implementation, shared with portfolio-hedge).
      const rawStake =
        req.stakeUsd !== undefined
          ? req.stakeUsd
          : stakeForCoverage(req.coverageUsd!, price, feeRate);
      const plan = priceLeg({
        priceCents,
        feeBps: market.feeBps,
        defaultTicketUsd: market.defaultTicketUsd,
        rawStakeUsd: rawStake,
        maxStakeUsd,
      });
      const { stakeUsd, payoutIfWinUsd } = plan;

      let coverage: Record<string, unknown> | null = null;
      if (req.coverageUsd !== undefined) {
        const fullyCovered = payoutIfWinUsd + 1e-9 >= req.coverageUsd;
        coverage = {
          requestedCoverageUsd: round2(req.coverageUsd),
          providedCoverageUsd: payoutIfWinUsd,
          premiumUsd: stakeUsd,
          premiumPctOfCoverage: round2((stakeUsd / payoutIfWinUsd) * 100),
          fullyCovered,
        };
      }

      const confidence = confidenceFor(quote.stats.totalPoolUsd, quote.stats.totalBets);

      return {
        service: "hedge-quote",
        status: "ok",
        custody: "none",
        ...(matchScore !== null ? { matchScore } : {}),
        market: {
          marketId: market.id,
          marketSlug: market.slug,
          question: market.question,
          category: market.category,
          tokenSymbol: market.tokenSymbol,
          deadlineAt: market.deadlineAt,
          feeBps: market.feeBps,
          url: market.links.app,
        },
        hedge: {
          ...("side" in execTarget ? { side: execTarget.side } : { outcome: execTarget.outcome }),
          outcomeLabel,
          priceCents,
          impliedProbability: round4(price),
        },
        plan,
        coverage,
        context: {
          confidence,
          poolUsd: quote.stats.totalPoolUsd,
          totalBets: quote.stats.totalBets,
          tokenSnapshot: quote.tokenSnapshot ? { ...quote.tokenSnapshot } : null,
          note: contextNote(confidence),
        },
        execute: {
          custody: "none",
          note: "This is a plan, not a placed bet. The desk holds none of your funds — you execute the trade yourself and keep custody throughout.",
          endpoint: market.links.trade,
          method: "POST",
          params: { marketId: market.id, ...execTarget, sizeUsd: stakeUsd },
          appUrl: market.links.app,
        },
        disclaimer:
          "Non-custodial hedge plan — not investment advice. Prices move with size and time; re-quote before executing. The desk placed no order and holds none of your funds.",
        provenance,
        asOf: ctx.clock.now().toISOString(),
      };
    },
  };
}
