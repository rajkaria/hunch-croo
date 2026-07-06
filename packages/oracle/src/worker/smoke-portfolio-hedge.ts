import { MockHunchApi } from "../adapters/mock/hunch.js";
import { createPortfolioHedgeService } from "../core/services/portfolio-hedge.js";
import type {
  HunchCatalogue,
  HunchCatalogueEntry,
  HunchQuote,
} from "../ports/hunch.js";
import { systemClock } from "../ports/runtime.js";
import type { CapOrder } from "../ports/cap.js";

/**
 * Credential-free portfolio-hedge demo — no keys, no network. Prices a whole
 * book of positions in one order and shows the S13 guards:
 *  - one budget allocated across many legs by a deterministic rule (LLM never sizes)
 *  - over-budget baskets scaled proportionally, never silently honoured
 *  - an honest same-instrument correlation flag (no fabricated covariance)
 *  - every leg NON-CUSTODIAL: an executable trade call, never a placed bet
 *
 *   pnpm --filter @hunch/oracle smoke:portfolio-hedge
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

const AIXBT = market({ id: "aixbt-50m", slug: "aixbt-50m", question: "Will $AIXBT reach $50M mcap?", tokenSymbol: "AIXBT" });
const ANSEM = market({ id: "ansem-flip-pump", slug: "ansem-flip-pump", question: "Will $ANSEM flip $PUMP?", tokenSymbol: "ANSEM" });
const ADA = market({
  id: "ada-mcap-ladder",
  slug: "ada-mcap-ladder",
  question: "Which band will $ADA close in?",
  tokenSymbol: "ADA",
  outcomes: [
    { key: "le-n20", label: "-20% or lower" },
    { key: "flat-p9", label: "0% to +9%" },
  ],
});

const CATALOGUE: HunchCatalogue = {
  count: 3,
  categories: [
    { key: "desk", label: "Demo", description: "offline", disclosure: "Synthetic book.", count: 3, markets: [AIXBT, ANSEM, ADA] },
  ],
};

const QUOTES: Record<string, HunchQuote> = {
  [AIXBT.id]: { market: AIXBT, side: "yes", odds: { yesPriceCents: 50, noPriceCents: 50 }, stats: { totalBets: 0, totalPoolUsd: 0, feeUsd: 0 }, tokenSnapshot: null },
  [ANSEM.id]: { market: ANSEM, side: "no", odds: { yesPriceCents: 92, noPriceCents: 8 }, stats: { totalBets: 3, totalPoolUsd: 12, feeUsd: 0.24 }, tokenSnapshot: null },
  [ADA.id]: {
    market: ADA,
    side: "le-n20",
    odds: { "le-n20": 16, "flat-p9": 17 },
    stats: { totalBets: 0, totalPoolUsd: 0, feeUsd: 0 },
    tokenSnapshot: null,
    ladder: { outcomes: [{ key: "le-n20", label: "-20% or lower", impliedPct: 16, backedUsd: 0, isCurrent: false }], currentBucketKey: "le-n20" },
  },
};

const order: CapOrder = {
  orderId: "smoke",
  negotiationId: "smoke",
  serviceId: "svc-portfolio-hedge",
  requesterAgentId: "smoke",
  price: "3.00",
  paymentToken: "USDC",
  status: "paid",
};

function assertNonCustodial(legs: Array<Record<string, unknown>>) {
  for (const leg of legs) {
    if (leg.status !== "ok") continue;
    const execute = leg.execute as Record<string, unknown>;
    if (execute.custody !== "none" || "payoutAddress" in execute || "betReceipt" in leg) {
      throw new Error("INVARIANT VIOLATED: a leg leaked a custodial artifact");
    }
  }
}

async function main() {
  const hunch = new MockHunchApi({ catalogue: CATALOGUE, quotes: QUOTES });
  const service = createPortfolioHedgeService(hunch, { maxStakeUsd: 50, maxLegStakeUsd: 10 });

  console.log("\n=== portfolio-hedge — non-custodial basket (offline demo) ===\n");

  // 1) Explicit basket across three markets.
  const basket = await service.handle({
    order,
    requirements: "",
    input: {
      positions: [
        { marketSlug: "ansem-flip-pump", side: "no", stakeUsd: 5, label: "short-ANSEM insurance" },
        { marketSlug: "aixbt-50m", side: "yes", stakeUsd: 5, label: "AIXBT upside" },
        { marketSlug: "ada-mcap-ladder", outcome: "le-n20", stakeUsd: 5, label: "ADA crash band" },
      ],
    },
    clock: systemClock,
  });
  const legs = basket.legs as Array<Record<string, unknown>>;
  const p = basket.portfolio as Record<string, number | string>;
  console.log("• Explicit basket (3 legs, $5 each):");
  for (const leg of legs) {
    const plan = leg.plan as Record<string, number>;
    console.log(
      `  [${leg.label}]  $${plan.stakeUsd} → ${plan.shares} shares · pays $${plan.payoutIfWinUsd} if it hits`,
    );
  }
  console.log(
    `  Σ premium $${p.totalPremiumUsd} → Σ payout-if-all-hit $${p.totalPayoutIfAllHitUsd}  (mode ${p.mode})`,
  );
  assertNonCustodial(legs);

  // 2) Budget mode: one $12 budget split proportional to exposure.
  const budgeted = await service.handle({
    order,
    requirements: "",
    input: {
      budgetUsd: 12,
      positions: [
        { marketSlug: "ansem-flip-pump", side: "no", exposureUsd: 300 },
        { marketSlug: "aixbt-50m", side: "yes", exposureUsd: 100 },
      ],
    },
    clock: systemClock,
  });
  const bl = budgeted.legs as Array<Record<string, unknown>>;
  console.log("\n• Budget mode ($12 split 300:100 by exposure):");
  for (const leg of bl) {
    const alloc = leg.allocation as Record<string, number | string>;
    console.log(`  [exposure] allocated $${alloc.allocatedUsd}  (${alloc.source})`);
  }

  // 3) Correlation flag: two legs on the same market are not independent.
  const correlated = await service.handle({
    order,
    requirements: "",
    input: {
      positions: [
        { marketSlug: "aixbt-50m", side: "yes", stakeUsd: 4 },
        { marketSlug: "aixbt-50m", side: "no", stakeUsd: 4 },
      ],
    },
    clock: systemClock,
  });
  const groups = correlated.correlatedGroups as Array<Record<string, unknown>>;
  console.log("\n• Correlation flag (two legs on aixbt-50m):");
  console.log(`  ${groups.length} correlated group(s): ${groups.map((g) => `${g.kind}:${g.key}`).join(", ")}`);

  if (
    basket.status !== "ok" ||
    p.pricedLegs !== 3 ||
    p.totalPremiumUsd !== 15 ||
    (bl[0]!.allocation as Record<string, number>).allocatedUsd !== 9 ||
    !groups.some((g) => g.kind === "market")
  ) {
    throw new Error("INVARIANT VIOLATED: unexpected portfolio-hedge state");
  }
  console.log(
    "\n✅ portfolio-hedge smoke: basket priced, budget allocated, correlation flagged — every leg non-custodial.\n",
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("[smoke-portfolio-hedge] failed —", error);
  process.exit(1);
});
