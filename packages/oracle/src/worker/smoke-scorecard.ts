import { MockCapTransport } from "../adapters/mock/transport.js";
import { MockHunchApi } from "../adapters/mock/hunch.js";
import { createMockLedger } from "../adapters/mock/ledger.js";
import { ProviderLoop } from "../core/provider-loop.js";
import { createRegistry, type ServiceHandler } from "../core/service-registry.js";
import { createScorecardService } from "../core/services/scorecard.js";
import { runSettleSweep } from "../core/track-record/settle-sweep.js";
import { verifyChain } from "../core/track-record/entry.js";
import type { HunchCatalogue, HunchMarketResult } from "../ports/hunch.js";
import { systemClock, type Clock, type OracleLogger } from "../ports/runtime.js";

/**
 * Credential-free scorecard demo — no keys, no network. Drives the REAL provider
 * loop: it sells a set of forecasts (which the loop records to the track-record
 * ledger), settles the ones whose markets have resolved, then prints the public
 * scorecard — Brier, calibration, and the tamper-evident head hash.
 *
 * The point: the desk you can audit. Every sold forecast is on the ledger;
 * only *resolved* markets count toward the score; the chain proves nothing was
 * edited after the fact.
 *
 *   pnpm --filter @hunch/oracle smoke:scorecard
 */

const silent: OracleLogger = { info() {}, warn() {}, error() {} };

interface Sold {
  slug: string;
  marketId: string;
  question: string;
  probYes: number;
  /** null → market still open at settle time (stays pending). */
  resolvesYes: boolean | null;
}

// A little book. Probabilities are the desk's P(yes); outcomes are what really
// happened. Chosen to be roughly calibrated so the reliability table tells a
// believable story (and one still-open market to show honest "pending").
const BOOK: Sold[] = [
  { slug: "aixbt-50m", marketId: "mkt_aixbt", question: "Will $AIXBT reach $50M mcap?", probYes: 0.82, resolvesYes: true },
  { slug: "ansem-flip", marketId: "mkt_ansem", question: "Will $ANSEM flip $PUMP?", probYes: 0.71, resolvesYes: true },
  { slug: "sol-ath", marketId: "mkt_sol", question: "Will SOL make a new ATH this quarter?", probYes: 0.64, resolvesYes: false },
  { slug: "eth-5k", marketId: "mkt_eth", question: "Will ETH close above $5k?", probYes: 0.28, resolvesYes: false },
  { slug: "doge-1", marketId: "mkt_doge", question: "Will DOGE hit $1?", probYes: 0.12, resolvesYes: false },
  { slug: "btc-200k", marketId: "mkt_btc", question: "Will BTC hit $200k this year?", probYes: 0.55, resolvesYes: null },
];

/** A forecast service stub that answers per-slug from the book above. */
const forecastStub: ServiceHandler = {
  name: "forecast",
  handle: async (ctx) => {
    const slug = (ctx.input as { slug?: string } | null)?.slug;
    const f = BOOK.find((b) => b.slug === slug);
    if (!f) throw new Error(`no such market ${slug}`);
    return {
      service: "forecast",
      status: "ok",
      question: f.question,
      probability: f.probYes,
      side: "yes",
      marketId: f.marketId,
      marketSlug: f.slug,
      marketUrl: `https://www.playhunch.xyz/m/${f.slug}`,
      deadlineAt: "2026-12-31T00:00:00.000Z",
      odds: { yes: Math.round(f.probYes * 100), no: Math.round((1 - f.probYes) * 100) },
      confidence: "high",
    };
  },
};

function resolvedResult(marketId: string, yes: boolean): HunchMarketResult {
  return {
    marketId,
    status: "resolved",
    resolvedOutcome: yes ? "yes" : "no",
    resolvedOutcomeLabel: yes ? "Yes" : "No",
    resolvedAt: "2026-11-15T00:00:00.000Z",
    source: "playhunch resolver",
    sourceUrl: `https://www.playhunch.xyz/api/partner/result?marketId=${marketId}`,
    observedMarketCapUsd: null,
    payoutPerShareUsd: null,
    poolUsd: 0,
    winningShares: 0,
    proofUrl: `https://www.playhunch.xyz/proof/${marketId}`,
  };
}

function openResult(marketId: string): HunchMarketResult {
  return { ...resolvedResult(marketId, true), status: "open", resolvedOutcome: null };
}

async function settleTicks() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 10));
}

function bar(v: number, width = 20): string {
  const n = Math.round(v * width);
  return "█".repeat(n) + "░".repeat(width - n);
}

async function main() {
  const clock: Clock = systemClock;
  const ledger = createMockLedger();
  const transport = new MockCapTransport();
  const registry = createRegistry({ services: { "svc-forecast": forecastStub } });
  const loop = new ProviderLoop({ transport, registry, clock, logger: silent, ledger });
  await loop.start();

  console.log("\n=== scorecard — the desk you can audit (offline demo) ===\n");
  console.log(`Selling ${BOOK.length} forecasts through the real provider loop…`);

  // 1) Sell every forecast. The loop records each delivery to the ledger.
  for (const f of BOOK) {
    transport.createNegotiation({
      serviceId: "svc-forecast",
      requirements: JSON.stringify({ slug: f.slug }),
    });
  }
  await settleTicks();
  for (const order of transport.listCreatedOrders()) transport.payOrder(order.orderId);
  await settleTicks();

  const recordedNow = await ledger.list();
  console.log(`Recorded ${recordedNow.length} forecasts. All pending until their markets resolve.`);

  // 2) Settle: score the forecasts whose markets have resolved.
  const resultSequences: Record<string, HunchMarketResult[]> = {};
  for (const f of BOOK) {
    resultSequences[f.marketId] = [
      f.resolvesYes === null ? openResult(f.marketId) : resolvedResult(f.marketId, f.resolvesYes),
    ];
  }
  const hunch = new MockHunchApi({
    catalogue: { count: 0, categories: [] } as HunchCatalogue,
    resultSequences,
  });
  const swept = await runSettleSweep({ ledger, hunch, clock, logger: silent });
  console.log(`Settle sweep: scored ${swept.scored}, still pending ${swept.pending}.\n`);

  // 3) Print the public scorecard.
  const order = {
    orderId: "scorecard-read",
    negotiationId: "n",
    serviceId: "svc-scorecard",
    requesterAgentId: "smoke",
    price: "0",
    paymentToken: "USDC",
    status: "paid",
  };
  const card = await createScorecardService(ledger).handle({
    order,
    requirements: "",
    input: null,
    clock,
  });
  const roll = card.rollup as {
    total: number;
    resolved: number;
    pending: number;
    hits: number;
    hitRate: number;
    meanBrier: number;
    meanLogLoss: number;
    calibration: Array<{ lo: number; hi: number; n: number; predictedMean: number; observedRate: number }>;
  };

  console.log("── Track record ─────────────────────────────────────────");
  console.log(`  forecasts sold ....... ${roll.total}   (resolved ${roll.resolved}, pending ${roll.pending})`);
  console.log(`  Brier score .......... ${roll.meanBrier.toFixed(4)}   (0 = perfect, 0.25 = coin-flip)`);
  console.log(`  log loss ............. ${roll.meanLogLoss.toFixed(4)}`);
  console.log(`  predicted-outcome hit  ${(roll.hitRate * 100).toFixed(0)}%   (share of resolved where the called outcome occurred)`);

  console.log("\n── Calibration (predicted vs observed, resolved only) ────");
  for (const b of roll.calibration) {
    if (b.n === 0) continue;
    console.log(
      `  ${(b.lo * 100).toFixed(0).padStart(3)}–${(b.hi * 100).toFixed(0).padStart(3)}%  ${bar(b.observedRate)}  ` +
        `predicted ${(b.predictedMean * 100).toFixed(0)}% · observed ${(b.observedRate * 100).toFixed(0)}% · n=${b.n}`,
    );
  }

  // 4) Tamper-evidence: the chain verifies, and the head hash is publishable.
  const list = await ledger.list();
  const integrity = verifyChain(list);
  console.log("\n── Integrity ────────────────────────────────────────────");
  console.log(`  chain verifies ....... ${integrity.ok ? "✅ OK" : `❌ broken at ${integrity.brokenAt}`}`);
  console.log(`  head hash ............ ${card.headHash}`);
  console.log("  (pin this hash; re-request the scorecard later and the head still covers this exact history)\n");

  if (!integrity.ok || roll.resolved !== 5 || roll.pending !== 1) {
    throw new Error("INVARIANT VIOLATED: unexpected scorecard state");
  }
  console.log("✅ scorecard smoke: forecasts recorded, resolved markets scored, chain intact.\n");
  process.exit(0);
}

main().catch((error) => {
  console.error("[smoke-scorecard] failed —", error);
  process.exit(1);
});
