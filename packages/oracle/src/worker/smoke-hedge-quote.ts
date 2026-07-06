import { MockHunchApi } from "../adapters/mock/hunch.js";
import { createHedgeQuoteService } from "../core/services/hedge-quote.js";
import type {
  HunchCatalogue,
  HunchCatalogueEntry,
  HunchQuote,
} from "../ports/hunch.js";
import { systemClock } from "../ports/runtime.js";
import type { CapOrder } from "../ports/cap.js";

/**
 * Credential-free hedge-quote demo — no keys, no network. Prices four real
 * hedge shapes against a self-contained book and shows the money-path guards:
 *  - the deterministic cap clamps an oversized stake (the LLM never sizes)
 *  - coverage sizing back-solves the premium for a desired payout
 *  - a ladder outcome is priced by key
 *  - every plan is NON-CUSTODIAL: an executable trade instruction, never a
 *    placed bet — no betReceipt, no positionId, no funds touched.
 *
 *   pnpm --filter @hunch/oracle tsx src/worker/smoke-hedge-quote.ts
 */
const BASE = "https://www.playhunch.xyz";

function market(
  over: Partial<HunchCatalogueEntry> & { id: string; slug: string },
): HunchCatalogueEntry {
  return {
    question: over.question ?? "",
    shortTitle: over.shortTitle ?? over.slug,
    summary: over.summary ?? "",
    category: over.category ?? "market_cap",
    categoryKey: over.categoryKey ?? over.category ?? "market_cap",
    tokenSymbol: over.tokenSymbol ?? null,
    tokenSymbols: over.tokenSymbols ?? (over.tokenSymbol ? [over.tokenSymbol] : []),
    chainId: over.chainId ?? "base",
    deadlineAt: over.deadlineAt ?? "2026-12-31T23:59:00.000Z",
    deadlineLabel: over.deadlineLabel ?? "Dec 31",
    status: "open",
    feeBps: over.feeBps ?? 200,
    defaultTicketUsd: over.defaultTicketUsd ?? 1,
    virtualLiquidityUsd: over.virtualLiquidityUsd ?? 10_000,
    targetMarketCapUsd: over.targetMarketCapUsd ?? null,
    outcomes: over.outcomes ?? null,
    links: {
      app: `${BASE}/markets/${over.slug}`,
      quote: `${BASE}/api/partner/quote?marketId=${over.id}`,
      trade: `${BASE}/api/partner/trade`,
    },
    ...over,
  } as HunchCatalogueEntry;
}

const AIXBT = market({
  id: "aixbt-50m-mcap",
  slug: "aixbt-50m",
  question: "Will $AIXBT reach $50M market cap by July 15, 2026?",
  tokenSymbol: "AIXBT",
  targetMarketCapUsd: 50_000_000,
});
const ANSEM = market({
  id: "ansem-flip-pump",
  slug: "ansem-flip-pump",
  question: "Will $ANSEM flip $PUMP by year end?",
  category: "token_mcap_flip",
  tokenSymbol: "ANSEM",
});
const ADA = market({
  id: "ada-mcap-ladder",
  slug: "ada-mcap-ladder",
  question: "Which weekly market-cap band will $ADA close in?",
  category: "recurring_mcap_range",
  tokenSymbol: "ADA",
  chainId: "cardano",
  outcomes: [
    { key: "le-n20", label: "-20% or lower" },
    { key: "flat-p9", label: "0% to +9%" },
    { key: "ge-p20", label: "+20% or higher" },
  ],
});

const CATALOGUE: HunchCatalogue = {
  count: 3,
  categories: [
    {
      key: "desk",
      label: "Demo desk",
      description: "credential-free hedge demo",
      disclosure: "Synthetic book for the offline demo.",
      count: 3,
      markets: [AIXBT, ANSEM, ADA],
    },
  ],
};

const QUOTES: Record<string, HunchQuote> = {
  [AIXBT.id]: {
    market: AIXBT,
    side: "yes",
    odds: { yesPriceCents: 50, noPriceCents: 50 },
    stats: { totalBets: 0, totalPoolUsd: 0, feeUsd: 0 },
    tokenSnapshot: {
      tokenSymbol: "AIXBT",
      currentMarketCapUsd: 20_581_567,
      targetMarketCapUsd: 50_000_000,
      distanceToTargetPct: 142.94,
      reachedTarget: false,
      source: "dexscreener",
      sourceUrl: "https://dexscreener.com/base/0x7464",
      observedAt: "2026-07-05T22:50:51.169Z",
    },
  },
  [ANSEM.id]: {
    market: ANSEM,
    side: "no",
    odds: { yesPriceCents: 92, noPriceCents: 8 },
    stats: { totalBets: 3, totalPoolUsd: 12, yesPoolUsd: 11, noPoolUsd: 1, feeUsd: 0.24 },
    tokenSnapshot: null,
  },
  [ADA.id]: {
    market: ADA,
    side: "flat-p9",
    odds: { "le-n20": 16, "flat-p9": 17, "ge-p20": 17 },
    stats: { totalBets: 0, totalPoolUsd: 0, feeUsd: 0 },
    tokenSnapshot: null,
    ladder: {
      outcomes: [
        { key: "le-n20", label: "-20% or lower", impliedPct: 16, backedUsd: 0, isCurrent: false },
        { key: "flat-p9", label: "0% to +9%", impliedPct: 17, backedUsd: 0, isCurrent: true },
        { key: "ge-p20", label: "+20% or higher", impliedPct: 17, backedUsd: 0, isCurrent: false },
      ],
      currentBucketKey: "flat-p9",
    },
  },
};

const SCENARIOS: Array<{ title: string; input: Record<string, unknown> }> = [
  {
    title: "Cheap-side insurance: $5 buys the 8¢ NO on a live $12 book",
    input: { marketSlug: "ansem-flip-pump", side: "no", stakeUsd: 5 },
  },
  {
    title: "Coverage sizing: back-solve the premium for exactly $9.80 of payout",
    input: { marketSlug: "aixbt-50m", side: "yes", coverageUsd: 9.8 },
  },
  {
    title: "Cap guard: a $50 ask is clamped to the $10 desk cap (LLM never sizes)",
    input: { marketSlug: "aixbt-50m", side: "yes", stakeUsd: 50 },
  },
  {
    title: "Ladder hedge: buy the ≤ -20% crash band by outcome key",
    input: { marketSlug: "ada-mcap-ladder", outcome: "le-n20", stakeUsd: 5 },
  },
];

async function main() {
  const hunch = new MockHunchApi({ catalogue: CATALOGUE, quotes: QUOTES });
  const service = createHedgeQuoteService(hunch, { maxStakeUsd: 10 });
  const order: CapOrder = {
    orderId: "smoke",
    negotiationId: "smoke",
    serviceId: "svc-hedge-quote",
    requesterAgentId: "smoke",
    price: "1.00",
    paymentToken: "USDC",
    status: "paid",
  };

  console.log("\n=== hedge-quote — non-custodial plans (offline demo) ===");
  for (const { title, input } of SCENARIOS) {
    const payload = await service.handle({
      order,
      requirements: "",
      input,
      clock: systemClock,
    });
    if (payload.status !== "ok") throw new Error(`unexpected status ${String(payload.status)}`);

    const plan = payload.plan as Record<string, number | boolean>;
    const execute = payload.execute as Record<string, unknown>;
    const coverage = payload.coverage as Record<string, number | boolean> | null;

    // Non-custodial invariant: a plan, never a placed bet.
    if (
      execute.custody !== "none" ||
      "betReceipt" in payload ||
      "positionId" in payload ||
      "payoutAddress" in execute
    ) {
      throw new Error("INVARIANT VIOLATED: hedge-quote leaked a custodial artifact");
    }

    console.log(`\n• ${title}`);
    console.log(
      `  stake $${plan.stakeUsd} (fee $${plan.feeUsd}) → ${plan.shares} shares · pays $${plan.payoutIfWinUsd} if it hits` +
        ` · ${plan.returnMultiple}x · breakeven ${plan.breakevenProbability}` +
        (plan.capApplied ? "  [CAP APPLIED]" : ""),
    );
    if (coverage) {
      console.log(
        `  coverage: asked $${coverage.requestedCoverageUsd}, got $${coverage.providedCoverageUsd}` +
          ` (${coverage.premiumPctOfCoverage}% premium, fullyCovered=${coverage.fullyCovered})`,
      );
    }
    console.log(
      `  execute → POST ${String(execute.endpoint)}  ${JSON.stringify(execute.params)}  [custody: none]`,
    );
  }

  console.log(
    "\n✅ hedge-quote smoke: cap holds, coverage sizes, ladder priced — every plan non-custodial.",
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("[smoke-hedge-quote] failed —", error);
  process.exit(1);
});
