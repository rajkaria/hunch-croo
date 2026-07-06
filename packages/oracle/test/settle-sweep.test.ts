import { describe, it, expect, vi } from "vitest";
import { runSettleSweep } from "../src/core/track-record/settle-sweep.js";
import { createMockLedger } from "../src/adapters/mock/ledger.js";
import { pendingOrders } from "../src/core/track-record/settle.js";
import type { HunchMarketResult, HunchRead } from "../src/ports/hunch.js";
import { HunchApiError } from "../src/ports/hunch.js";
import type { Clock, OracleLogger } from "../src/ports/runtime.js";
import type { ForecastRecordDraft } from "../src/core/track-record/entry.js";

const clock: Clock = { now: () => new Date("2026-08-01T00:00:00.000Z") };
const silent: OracleLogger = { info: () => {}, warn: () => {}, error: () => {} };

function draft(orderId: string, marketId: string): ForecastRecordDraft {
  return {
    orderId,
    txHash: null,
    recordedAt: "2026-07-06T00:00:00.000Z",
    question: "q",
    marketId,
    marketSlug: "slug",
    marketUrl: "https://www.playhunch.xyz/m/x",
    predictedOutcomeKey: "yes",
    probability: 0.7,
    confidence: "high",
    deadlineAt: "2026-07-31T00:00:00.000Z",
    resolution: null,
  };
}

function resolvedResult(marketId: string, outcome: string): HunchMarketResult {
  return {
    marketId,
    status: "resolved",
    resolvedOutcome: outcome,
    resolvedOutcomeLabel: outcome,
    resolvedAt: "2026-07-31T12:00:00.000Z",
    source: "DefiLlama",
    sourceUrl: "https://defillama.com",
    observedMarketCapUsd: null,
    payoutPerShareUsd: null,
    poolUsd: 0,
    winningShares: 0,
    proofUrl: null,
  };
}

function openResult(marketId: string): HunchMarketResult {
  return { ...resolvedResult(marketId, "yes"), status: "open", resolvedOutcome: null };
}

/** Resolver stub: map marketId → result, or "throw" to simulate an outage. */
function resolver(map: Record<string, HunchMarketResult | "throw">) {
  return {
    async result(marketId: string): Promise<HunchRead<{ result: HunchMarketResult }>> {
      const entry = map[marketId];
      if (!entry || entry === "throw") {
        throw new HunchApiError("upstream_down", 503, "https://x");
      }
      return { data: { result: entry }, url: "https://x", readAt: "2026-08-01T00:00:00.000Z" };
    },
  };
}

describe("runSettleSweep", () => {
  it("scores resolved markets, leaves open ones pending, survives resolver outages", async () => {
    const ledger = createMockLedger();
    await ledger.append(draft("A", "mkt_A")); // will resolve YES → hit
    await ledger.append(draft("B", "mkt_B")); // still open → pending
    await ledger.append(draft("C", "mkt_C")); // resolver throws → error, retried next sweep

    const hunch = resolver({
      mkt_A: resolvedResult("mkt_A", "yes"),
      mkt_B: openResult("mkt_B"),
      mkt_C: "throw",
    });

    const out = await runSettleSweep({ ledger, hunch, clock, logger: silent });
    expect(out).toEqual({ scored: 1, pending: 2, errors: 1 });

    const list = await ledger.list();
    const settledA = list.find((r) => r.orderId === "A" && r.resolution !== null);
    expect(settledA?.resolution?.hit).toBe(true);
    // A is settled; B and C remain pending for the next sweep.
    expect(pendingOrders(list).map((r) => r.orderId).sort()).toEqual(["B", "C"]);
  });

  it("does nothing when there are no pending records", async () => {
    const ledger = createMockLedger();
    const hunch = resolver({});
    const spy = vi.spyOn(hunch, "result");
    const out = await runSettleSweep({ ledger, hunch, clock, logger: silent });
    expect(out).toEqual({ scored: 0, pending: 0, errors: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("is idempotent — a second sweep re-checks pending but does not re-settle", async () => {
    const ledger = createMockLedger();
    await ledger.append(draft("A", "mkt_A"));
    const hunch = resolver({ mkt_A: resolvedResult("mkt_A", "yes") });
    await runSettleSweep({ ledger, hunch, clock, logger: silent });
    const afterFirst = (await ledger.list()).length;
    const out = await runSettleSweep({ ledger, hunch, clock, logger: silent });
    expect(out.scored).toBe(0);
    expect((await ledger.list()).length).toBe(afterFirst); // no duplicate settle
  });
});
