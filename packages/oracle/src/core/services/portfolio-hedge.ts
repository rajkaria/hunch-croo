import { z } from "zod";
import type {
  HunchApi,
  HunchCatalogueEntry,
  HunchQuote,
  HunchRead,
  HunchYesNoOdds,
} from "../../ports/hunch.js";
import type { ServiceContext, ServiceHandler } from "../service-registry.js";
import { confidenceFor, type ProvenanceEntry } from "../forecast/composer.js";
import { matchQuestion, MATCH_THRESHOLD } from "../forecast/matcher.js";
import { parseQuestion } from "../forecast/schema.js";
import { priceLeg, round4 } from "../hedge/leg.js";
import { allocatePortfolio, type AllocatorPosition } from "../hedge/allocate.js";

/**
 * `portfolio-hedge` — the Market Desk's NON-CUSTODIAL basket hedge. Give it a
 * book of positions (each: a market + the outcome you're exposed to) and one
 * budget, and it prices a coordinated basket of hedge legs — each priced off the
 * live book, sized by a deterministic allocator (the LLM never sizes it), with
 * portfolio-level aggregates and a ready-to-sign trade call per leg. The desk
 * touches none of your funds; it hands back a plan you execute yourself.
 *
 * Invariants (extending S9 hedge-quote to N legs):
 *  - Non-custodial: every leg is a plan, no placed bet, no payout address.
 *  - The LLM never sizes: `allocatePortfolio` + total/per-leg caps do; over-budget
 *    baskets are scaled proportionally, never silently honoured.
 *  - No fabricated risk math: exposure, premium, payout, coverage ratio, and an
 *    honest same-instrument correlation flag — never an invented covariance/VaR.
 *  - Per-leg fail-soft: one bad market degrades that leg, not the basket; a
 *    catalogue/validation failure (or every priceable leg failing upstream)
 *    rejects the order so escrow refunds — never a fabricated leg.
 */
const PositionSchema = z
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
    side: z.enum(["yes", "no"]).optional(),
    outcome: z.string().trim().min(1).max(60).optional(),
    stakeUsd: z.number().positive().max(100_000).optional(),
    coverageUsd: z.number().positive().max(100_000).optional(),
    exposureUsd: z.number().positive().max(1_000_000).optional(),
    label: z.string().trim().max(80).optional(),
  })
  .refine((v) => Boolean(v.marketSlug) || Boolean(v.question), {
    message: 'each position needs "marketSlug" or "question"',
  })
  .refine((v) => Number(Boolean(v.side)) + Number(Boolean(v.outcome)) === 1, {
    message: 'each position needs exactly one of "side" (yes/no) or "outcome"',
  })
  .refine((v) => !(v.stakeUsd !== undefined && v.coverageUsd !== undefined), {
    message: 'a position cannot set both "stakeUsd" and "coverageUsd"',
  });

export const PortfolioHedgeInputSchema = z
  .object({
    positions: z.array(PositionSchema).min(1).max(20),
    budgetUsd: z.number().positive().max(1_000_000).optional(),
  })
  .refine(
    (v) => {
      const anyExplicit = v.positions.some(
        (p) => p.stakeUsd !== undefined || p.coverageUsd !== undefined,
      );
      if (anyExplicit) {
        // Explicit mode: EVERY position must carry exactly one of stake/coverage.
        return v.positions.every(
          (p) =>
            Number(p.stakeUsd !== undefined) + Number(p.coverageUsd !== undefined) === 1,
        );
      }
      // Budget mode: a top-level budget is required, per-leg sizes are absent.
      return v.budgetUsd !== undefined;
    },
    {
      message:
        'either give every position a "stakeUsd" or "coverageUsd" (explicit mode), or set a top-level "budgetUsd" with no per-position sizes (budget mode)',
    },
  );

export interface PortfolioHedgeOptions {
  /** Deterministic cap on total basket premium (default $50). */
  maxStakeUsd?: number;
  /** Deterministic per-leg cap so one leg can't eat the budget (default $10). */
  maxLegStakeUsd?: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function isYesNoOdds(odds: HunchQuote["odds"]): odds is HunchYesNoOdds {
  return (
    typeof (odds as HunchYesNoOdds).yesPriceCents === "number" &&
    typeof (odds as HunchYesNoOdds).noPriceCents === "number"
  );
}

function contextNote(confidence: ReturnType<typeof confidenceFor>): string {
  switch (confidence) {
    case "high":
      return "Deep book — real money backs this price. Advisory only.";
    case "medium":
      return "Moderately traded book. Advisory only.";
    case "low":
      return "Thinly traded — a small pool backs this price; it can move fast. Advisory only.";
    default:
      return "No real money has priced this outcome yet — treat as a soft prior and re-quote. Advisory only.";
  }
}

/** A position resolved to a live, priceable outcome. */
interface OkLeg {
  index: number;
  label: string | null;
  quote: HunchQuote;
  priceCents: number;
  price: number;
  feeRate: number;
  outcomeLabel: string | null;
  execTarget: { side: string } | { outcome: string };
  confidence: ReturnType<typeof confidenceFor>;
  matchScore: number | null;
  exposureUsd?: number;
  stakeUsd?: number;
  coverageUsd?: number;
}

/** A position that couldn't be priced — surfaced honestly, never faked. */
interface SkipLeg {
  index: number;
  status: "no_market" | "error";
  payload: Record<string, unknown>;
}

export function createPortfolioHedgeService(
  hunch: HunchApi,
  options: PortfolioHedgeOptions = {},
): ServiceHandler {
  const maxStakeUsd = options.maxStakeUsd ?? 50;
  const maxLegStakeUsd = options.maxLegStakeUsd ?? 10;

  return {
    name: "portfolio-hedge",
    async handle(ctx: ServiceContext): Promise<Record<string, unknown>> {
      const parsed = PortfolioHedgeInputSchema.safeParse(ctx.input);
      if (!parsed.success) {
        throw new Error(
          `invalid portfolio-hedge input: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
            .join("; ")}`,
        );
      }
      const req = parsed.data;

      // One catalogue read backs every leg's matching (a failure here throws →
      // the loop rejects the order → CAPVault refunds).
      const catalogueRead = await hunch.catalogue();
      const provenance: ProvenanceEntry[] = [];
      const seenProvUrls = new Set<string>();
      const addProv = (p: ProvenanceEntry) => {
        if (!seenProvUrls.has(p.url ?? "")) {
          seenProvUrls.add(p.url ?? "");
          provenance.push(p);
        }
      };
      addProv({
        source: "playhunch.xyz partner catalogue (open markets)",
        url: catalogueRead.url,
        readAt: catalogueRead.readAt,
      });

      const entryById = new Map<string, HunchCatalogueEntry>();
      const entryBySlug = new Map<string, HunchCatalogueEntry>();
      for (const category of catalogueRead.data.categories) {
        for (const market of category.markets) {
          entryById.set(market.id, market);
          entryBySlug.set(market.slug, market);
        }
      }

      const okLegs: OkLeg[] = [];
      const skipLegs: SkipLeg[] = [];
      const quoteCache = new Map<string, HunchRead<HunchQuote>>();

      for (let index = 0; index < req.positions.length; index++) {
        const pos = req.positions[index]!;
        const label = pos.label ?? null;
        try {
          // Resolve the market id (slug pass-through or deterministic match).
          let marketId: string;
          let matchScore: number | null = null;
          if (pos.marketSlug) {
            const entry =
              entryBySlug.get(pos.marketSlug) ?? entryById.get(pos.marketSlug);
            marketId = entry?.id ?? pos.marketSlug;
          } else {
            const question = parseQuestion({
              question: pos.question!,
              ...(pos.token ? { token: pos.token } : {}),
              ...(pos.type ? { type: pos.type } : {}),
              ...(pos.horizonDays ? { horizonDays: pos.horizonDays } : {}),
            });
            const discoverRead = await hunch.discover(question.raw, 8).catch(() => null);
            const extras = (discoverRead?.data.matches ?? []).map((m) => ({
              ...m.market,
              categoryKey: m.market.category,
              tokenSymbols: m.market.tokenSymbol ? [m.market.tokenSymbol] : [],
            }));
            if (discoverRead) {
              addProv({
                source: "playhunch.xyz partner discover (live + factory markets)",
                url: discoverRead.url,
                readAt: discoverRead.readAt,
              });
            }
            const result = matchQuestion(question, catalogueRead.data, ctx.clock, extras);
            if (!result.best) {
              const tokenGuess = question.tokenHint ?? question.cashtags[0] ?? null;
              skipLegs.push({
                index,
                status: "no_market",
                payload: {
                  index,
                  label,
                  status: "no_market",
                  question: question.raw,
                  bestScore: result.candidates[0]?.score ?? 0,
                  threshold: MATCH_THRESHOLD,
                  spawnHint: {
                    service: "spawn",
                    note: "No live market prices this leg. `spawn` can mint one on playhunch.xyz — then it becomes hedgeable here.",
                    input: {
                      ...(tokenGuess ? { token: tokenGuess } : {}),
                      ...(question.horizonDays ? { horizonDays: question.horizonDays } : {}),
                    },
                  },
                },
              });
              continue;
            }
            marketId = result.best.market.id;
            matchScore = result.best.score;
          }

          // One live quote per unique market (dedup across legs on the same book).
          let quoteRead = quoteCache.get(marketId);
          if (!quoteRead) {
            quoteRead = await hunch.quote(marketId, { sizeUsd: 1 });
            quoteCache.set(marketId, quoteRead);
          }
          addProv({
            source: "playhunch.xyz partner quote (live parimutuel book)",
            url: quoteRead.url,
            readAt: quoteRead.readAt,
          });
          const quote = quoteRead.data;
          const market = quote.market;
          if (quote.tokenSnapshot) {
            addProv({
              source: quote.tokenSnapshot.source,
              url: quote.tokenSnapshot.sourceUrl,
              readAt: quote.tokenSnapshot.observedAt,
              note: "token reading backing this market's resolution",
            });
          }

          // Resolve the hedged outcome + its live price.
          let priceCents: number;
          let outcomeLabel: string | null = null;
          let execTarget: { side: string } | { outcome: string };
          if (isYesNoOdds(quote.odds)) {
            if (!pos.side) {
              throw new Error(
                `"${market.slug}" is a yes/no market — this position needs "side", not "outcome".`,
              );
            }
            priceCents =
              pos.side === "yes" ? quote.odds.yesPriceCents : quote.odds.noPriceCents;
            outcomeLabel = pos.side.toUpperCase();
            execTarget = { side: pos.side };
          } else {
            if (!pos.outcome) {
              throw new Error(
                `"${market.slug}" is a ladder market — this position needs an "outcome" key.`,
              );
            }
            const oddsRecord = quote.odds as Record<string, number>;
            if (!(pos.outcome in oddsRecord)) {
              throw new Error(
                `unknown outcome "${pos.outcome}" for "${market.slug}" — valid keys: ${Object.keys(oddsRecord).join(", ")}.`,
              );
            }
            priceCents = oddsRecord[pos.outcome]!;
            outcomeLabel =
              quote.ladder?.outcomes.find((o) => o.key === pos.outcome)?.label ?? pos.outcome;
            execTarget = { outcome: pos.outcome };
          }
          if (!(priceCents > 0)) {
            throw new Error(
              `outcome has no live price on "${market.slug}" — cannot hedge a dead outcome.`,
            );
          }

          okLegs.push({
            index,
            label,
            quote,
            priceCents,
            price: priceCents / 100,
            feeRate: market.feeBps / 10_000,
            outcomeLabel,
            execTarget,
            confidence: confidenceFor(quote.stats.totalPoolUsd, quote.stats.totalBets),
            matchScore,
            ...(pos.exposureUsd !== undefined ? { exposureUsd: pos.exposureUsd } : {}),
            ...(pos.stakeUsd !== undefined ? { stakeUsd: pos.stakeUsd } : {}),
            ...(pos.coverageUsd !== undefined ? { coverageUsd: pos.coverageUsd } : {}),
          });
        } catch (error) {
          skipLegs.push({
            index,
            status: "error",
            payload: { index, label, status: "error", reason: String(error) },
          });
        }
      }

      // Every priceable leg failed upstream (not just "no market"): reject so
      // escrow refunds — never deliver an all-broken basket.
      const errorLegs = skipLegs.filter((s) => s.status === "error");
      if (okLegs.length === 0 && errorLegs.length > 0) {
        throw new Error(
          `portfolio-hedge: every priceable leg failed upstream (${errorLegs.length} error(s)); rejecting so escrow refunds`,
        );
      }

      // Deterministic budget allocation across the priceable legs.
      const allocatorPositions: AllocatorPosition[] = okLegs.map((r) => ({
        ...(r.stakeUsd !== undefined ? { stakeUsd: r.stakeUsd } : {}),
        ...(r.coverageUsd !== undefined ? { coverageUsd: r.coverageUsd } : {}),
        ...(r.exposureUsd !== undefined ? { exposureUsd: r.exposureUsd } : {}),
        price: r.price,
        feeRate: r.feeRate,
      }));
      const allocation = allocatePortfolio(allocatorPositions, {
        ...(req.budgetUsd !== undefined ? { budgetUsd: req.budgetUsd } : {}),
        totalCapUsd: maxStakeUsd,
      });

      // Price + assemble each ok leg.
      const okPayloads = okLegs.map((r, i) => {
        const alloc = allocation.allocations[i]!;
        const market = r.quote.market;
        const eco = priceLeg({
          priceCents: r.priceCents,
          feeBps: market.feeBps,
          defaultTicketUsd: market.defaultTicketUsd,
          rawStakeUsd: alloc.stakeUsd,
          maxStakeUsd: maxLegStakeUsd,
        });
        return {
          eco,
          exposureUsd: r.exposureUsd,
          payload: {
            index: r.index,
            label: r.label,
            status: "ok",
            ...(r.matchScore !== null ? { matchScore: r.matchScore } : {}),
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
              ...("side" in r.execTarget
                ? { side: r.execTarget.side }
                : { outcome: r.execTarget.outcome }),
              outcomeLabel: r.outcomeLabel,
              priceCents: r.priceCents,
              impliedProbability: round4(r.price),
            },
            allocation: {
              requestedUsd: alloc.requestedUsd,
              allocatedUsd: alloc.stakeUsd,
              source: alloc.source,
            },
            plan: { ...eco },
            exposureUsd: r.exposureUsd ?? null,
            coverageRatio:
              r.exposureUsd && r.exposureUsd > 0
                ? round4(eco.payoutIfWinUsd / r.exposureUsd)
                : null,
            context: {
              confidence: r.confidence,
              poolUsd: r.quote.stats.totalPoolUsd,
              totalBets: r.quote.stats.totalBets,
              note: contextNote(r.confidence),
            },
            execute: {
              custody: "none",
              note: "A plan, not a placed bet — you execute it and keep custody.",
              endpoint: market.links.trade,
              method: "POST",
              params: { marketId: market.id, ...r.execTarget, sizeUsd: eco.stakeUsd },
              appUrl: market.links.app,
            },
          },
        };
      });

      // Portfolio aggregates over the priced legs.
      const totalPremiumUsd = round2(okPayloads.reduce((a, p) => a + p.eco.stakeUsd, 0));
      const totalPayoutIfAllHitUsd = round2(
        okPayloads.reduce((a, p) => a + p.eco.payoutIfWinUsd, 0),
      );
      const exposures = okPayloads
        .map((p) => p.exposureUsd)
        .filter((x): x is number => x !== undefined);
      const totalExposureUsd = exposures.length
        ? round2(exposures.reduce((a, x) => a + x, 0))
        : null;

      // Honest correlation flag: legs on the same market or token are NOT
      // independent — no fabricated covariance, just the grouping.
      const correlatedGroups = collectCorrelations(okLegs);

      const legs = [...okPayloads.map((p) => p.payload), ...skipLegs.map((s) => s.payload)].sort(
        (a, b) => (a.index as number) - (b.index as number),
      );

      return {
        service: "portfolio-hedge",
        status: okLegs.length > 0 ? "ok" : "no_market",
        custody: "none",
        portfolio: {
          positions: req.positions.length,
          pricedLegs: okLegs.length,
          skippedLegs: skipLegs.length,
          mode: allocation.mode,
          budgetUsd: req.budgetUsd ?? null,
          budgetCapUsd: maxStakeUsd,
          maxLegStakeUsd,
          requestedTotalUsd: allocation.requestedTotalUsd,
          totalPremiumUsd,
          totalPayoutIfAllHitUsd,
          totalExposureUsd,
          coverageRatio:
            totalExposureUsd && totalExposureUsd > 0
              ? round4(totalPayoutIfAllHitUsd / totalExposureUsd)
              : null,
          scaledBy: allocation.scaledBy,
          capApplied: allocation.capApplied,
        },
        correlatedGroups,
        legs,
        disclaimer:
          "Non-custodial portfolio hedge — not investment advice. Prices move with size and time; re-quote before executing. The desk placed no orders and holds none of your funds. Legs sharing a market or token are correlated — the basket is less diversified than it looks.",
        provenance,
        asOf: ctx.clock.now().toISOString(),
      };
    },
  };
}

/** Group priceable legs by shared market id, then shared token symbol. */
function collectCorrelations(
  okLegs: OkLeg[],
): Array<{ kind: "market" | "token"; key: string; legIndexes: number[] }> {
  const groups: Array<{ kind: "market" | "token"; key: string; legIndexes: number[] }> = [];
  const byMarket = new Map<string, number[]>();
  const byToken = new Map<string, number[]>();
  for (const leg of okLegs) {
    const market = leg.quote.market;
    byMarket.set(market.id, [...(byMarket.get(market.id) ?? []), leg.index]);
    if (market.tokenSymbol) {
      byToken.set(market.tokenSymbol, [
        ...(byToken.get(market.tokenSymbol) ?? []),
        leg.index,
      ]);
    }
  }
  for (const [key, legIndexes] of byMarket) {
    if (legIndexes.length > 1) groups.push({ kind: "market", key, legIndexes });
  }
  for (const [key, legIndexes] of byToken) {
    // Skip a token group that's identical to a single-market group already flagged.
    if (legIndexes.length > 1) groups.push({ kind: "token", key, legIndexes });
  }
  return groups;
}
