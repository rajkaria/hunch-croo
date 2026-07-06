import { describe, it, expect } from "vitest";
import { settleRecord, pendingOrders } from "../src/core/track-record/settle.js";
import { linkRecord, type ForecastRecord } from "../src/core/track-record/entry.js";
import type { HunchMarketResult } from "../src/ports/hunch.js";
import type { Clock } from "../src/ports/runtime.js";

const clock: Clock = { now: () => new Date("2026-08-01T00:00:00.000Z") };

function record(overrides: Partial<ForecastRecord> = {}): ForecastRecord {
  return linkRecord(
    {
      orderId: "ord_1",
      txHash: null,
      recordedAt: "2026-07-06T00:00:00.000Z",
      question: "q",
      marketId: "mkt_1",
      marketSlug: "slug",
      marketUrl: "https://www.playhunch.xyz/m/x",
      predictedOutcomeKey: "yes",
      probability: 0.7,
      confidence: "high",
      deadlineAt: "2026-07-31T00:00:00.000Z",
      resolution: null,
      ...overrides,
    },
    overrides.seq ?? 0,
    overrides.prevHash ?? null,
  );
}

function result(overrides: Partial<HunchMarketResult> = {}): HunchMarketResult {
  return {
    marketId: "mkt_1",
    status: "resolved",
    resolvedOutcome: "yes",
    resolvedOutcomeLabel: "Yes",
    resolvedAt: "2026-07-31T12:00:00.000Z",
    source: "DefiLlama",
    sourceUrl: "https://defillama.com",
    observedMarketCapUsd: 1_000_000,
    payoutPerShareUsd: 1.9,
    poolUsd: 250,
    winningShares: 100,
    proofUrl: "https://proof.example/x",
    ...overrides,
  };
}

describe("settleRecord", () => {
  it("scores a hit when the resolved outcome matches the prediction", () => {
    const settled = settleRecord(record({ predictedOutcomeKey: "yes" }), result({ resolvedOutcome: "yes" }), clock);
    expect(settled?.resolution).toEqual({
      outcomeKey: "yes",
      hit: true,
      resolvedAt: "2026-07-31T12:00:00.000Z",
      proofUrl: "https://proof.example/x",
      settledAt: "2026-08-01T00:00:00.000Z",
    });
    // Content fields are carried over unchanged.
    expect(settled?.orderId).toBe("ord_1");
    expect(settled?.probability).toBe(0.7);
  });

  it("scores a miss when the outcome differs", () => {
    const settled = settleRecord(record({ predictedOutcomeKey: "yes" }), result({ resolvedOutcome: "no" }), clock);
    expect(settled?.resolution?.hit).toBe(false);
    expect(settled?.resolution?.outcomeKey).toBe("no");
  });

  it("returns null while the market is still open (nothing to score)", () => {
    const settled = settleRecord(record(), result({ status: "open", resolvedOutcome: null }), clock);
    expect(settled).toBeNull();
  });

  it("returns null for a voided market (resolved but no concrete outcome)", () => {
    const settled = settleRecord(record(), result({ status: "resolved", resolvedOutcome: null }), clock);
    expect(settled).toBeNull();
  });

  it("falls back to the clock when the upstream reports no resolvedAt", () => {
    const settled = settleRecord(record(), result({ resolvedAt: null }), clock);
    expect(settled?.resolution?.resolvedAt).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("pendingOrders", () => {
  it("returns latest-per-order records still awaiting resolution", () => {
    const openA = record({ orderId: "A", seq: 0 });
    const openB = record({ orderId: "B", seq: 1 });
    const pending = pendingOrders([openA, openB]);
    expect(pending.map((r) => r.orderId).sort()).toEqual(["A", "B"]);
  });

  it("excludes an order once its latest entry is settled", () => {
    const openA = record({ orderId: "A", seq: 0 });
    const settledA = record({
      orderId: "A",
      seq: 1,
      resolution: {
        outcomeKey: "yes",
        hit: true,
        resolvedAt: "2026-07-31T12:00:00.000Z",
        proofUrl: null,
        settledAt: "2026-08-01T00:00:00.000Z",
      },
    });
    expect(pendingOrders([openA, settledA])).toEqual([]);
  });
});
