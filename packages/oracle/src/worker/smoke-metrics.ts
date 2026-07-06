import { MockCapTransport } from "../adapters/mock/transport.js";
import { MockHunchApi } from "../adapters/mock/hunch.js";
import { createMockLedger } from "../adapters/mock/ledger.js";
import { ProviderLoop } from "../core/provider-loop.js";
import { createRegistry, type ServiceHandler } from "../core/service-registry.js";
import { buildMetrics } from "../core/metrics/snapshot.js";
import { formatPrometheus } from "../core/metrics/registry.js";
import { SERVICE_PRICING } from "../core/pricing.js";
import { rollup } from "../core/track-record/scoring.js";
import { runSettleSweep } from "../core/track-record/settle-sweep.js";
import type { HunchCatalogue, HunchMarketResult } from "../ports/hunch.js";
import { systemClock, type Clock, type OracleLogger } from "../ports/runtime.js";

/**
 * Credential-free observability demo — no keys, no network. Drives the REAL
 * provider loop selling a handful of orders (which increments the per-service
 * counters and records forecasts to the ledger), settles a couple, then renders
 * the exact Prometheus exposition the /metrics endpoint would serve and asserts
 * the key families.
 *
 *   pnpm --filter @hunch/oracle smoke:metrics
 */

const silent: OracleLogger = { info() {}, warn() {}, error() {} };

const forecastStub: ServiceHandler = {
  name: "forecast",
  handle: async (ctx) => {
    const slug = (ctx.input as { slug?: string } | null)?.slug ?? "aixbt-50m";
    const prob = { "aixbt-50m": 0.82, "sol-ath": 0.4, "eth-5k": 0.3 }[slug] ?? 0.5;
    return {
      service: "forecast",
      status: "ok",
      question: `Will ${slug} resolve yes?`,
      probability: prob,
      side: "yes",
      marketId: `mkt_${slug}`,
      marketSlug: slug,
      marketUrl: `https://www.playhunch.xyz/m/${slug}`,
      deadlineAt: "2026-12-31T00:00:00.000Z",
      odds: { yes: Math.round(prob * 100), no: Math.round((1 - prob) * 100) },
      confidence: "high",
    };
  },
};

const spawnStub: ServiceHandler = {
  name: "spawn",
  handle: async () => ({ service: "spawn", status: "minted", marketId: "mkt_new" }),
};

async function settleTicks() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 10));
}

function resolved(marketId: string, yes: boolean): HunchMarketResult {
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
    proofUrl: null,
  };
}

async function main() {
  const clock: Clock = systemClock;
  const ledger = createMockLedger();
  const transport = new MockCapTransport();
  const registry = createRegistry({
    services: { "svc-forecast": forecastStub, "svc-spawn": spawnStub },
  });
  const loop = new ProviderLoop({ transport, registry, clock, logger: silent, ledger });
  await loop.start();

  console.log("\n=== observability — the desk you can watch (offline demo) ===\n");

  // Sell 3 forecasts + 1 spawn through the real loop.
  for (const slug of ["aixbt-50m", "sol-ath", "eth-5k"]) {
    transport.createNegotiation({
      serviceId: "svc-forecast",
      requirements: JSON.stringify({ slug }),
    });
  }
  transport.createNegotiation({ serviceId: "svc-spawn" });
  await settleTicks();
  for (const order of transport.listCreatedOrders()) transport.payOrder(order.orderId);
  await settleTicks();

  // Settle two forecasts (one hit, one miss) so the scorecard gauges populate.
  const hunch = new MockHunchApi({
    catalogue: { count: 0, categories: [] } as HunchCatalogue,
    resultSequences: {
      // keys are the forecast records' marketIds (`mkt_${slug}`); eth-5k has no
      // result queued, so it 404s and stays honestly pending.
      "mkt_aixbt-50m": [resolved("mkt_aixbt-50m", true)],
      "mkt_sol-ath": [resolved("mkt_sol-ath", false)],
    },
  });
  const swept = await runSettleSweep({ ledger, hunch, clock, logger: silent });

  // Render the exact exposition the endpoint would serve.
  const text = formatPrometheus(
    buildMetrics({
      health: loop.health(),
      deliveredByService: loop.stats.deliveredByService,
      pricing: SERVICE_PRICING,
      rollup: rollup(await ledger.list()),
    }),
  );

  console.log("── GET /metrics ─────────────────────────────────────────");
  console.log(text.trimEnd());
  console.log("─────────────────────────────────────────────────────────\n");

  const has = (needle: string) => text.includes(needle);
  const revenueOk = has("oracle_revenue_usd_total 3.25"); // 3x0.25 + 1x2.5
  const deliveredOk =
    has('oracle_orders_delivered_by_service_total{listing="Hunch Oracle",service="forecast"} 3') &&
    has('oracle_orders_delivered_by_service_total{listing="Hunch Market Desk",service="spawn"} 1');
  const liveOk = has("oracle_up 1");
  const scorecardOk = has("oracle_forecasts_total 3") && has(`oracle_forecasts_resolved ${swept.scored}`);

  if (!revenueOk || !deliveredOk || !liveOk || !scorecardOk) {
    throw new Error(
      `INVARIANT VIOLATED: revenue=${revenueOk} delivered=${deliveredOk} live=${liveOk} scorecard=${scorecardOk} (scored=${swept.scored})`,
    );
  }
  console.log(
    `✅ metrics smoke: up=1, delivered forecast=3/spawn=1, booked revenue $3.25, ${swept.scored} forecasts scored.\n`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("[smoke-metrics] failed —", error);
  process.exit(1);
});
