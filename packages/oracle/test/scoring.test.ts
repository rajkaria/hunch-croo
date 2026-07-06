import { describe, it, expect } from "vitest";
import {
  brier,
  logLoss,
  calibrationTable,
  rollup,
} from "../src/core/track-record/scoring.js";
import { linkRecord, type ForecastRecord } from "../src/core/track-record/entry.js";

let seq = 0;
function rec(
  prob: number,
  hit: boolean | null,
  orderId = `ord_${seq}`,
): ForecastRecord {
  const s = seq++;
  return linkRecord(
    {
      orderId,
      txHash: null,
      recordedAt: "2026-07-06T00:00:00.000Z",
      question: "q",
      marketId: `mkt_${s}`,
      marketSlug: `slug-${s}`,
      marketUrl: "https://www.playhunch.xyz/m/x",
      predictedOutcomeKey: "yes",
      probability: prob,
      confidence: "high",
      deadlineAt: "2026-12-31T00:00:00.000Z",
      resolution:
        hit === null
          ? null
          : {
              outcomeKey: hit ? "yes" : "no",
              hit,
              resolvedAt: "2026-08-01T00:00:00.000Z",
              proofUrl: null,
              settledAt: "2026-08-01T01:00:00.000Z",
            },
    },
    s,
    null,
  );
}

describe("brier / logLoss", () => {
  it("brier is squared error against the 0/1 outcome", () => {
    expect(brier(0.7, true)).toBeCloseTo(0.09, 10);
    expect(brier(0.2, false)).toBeCloseTo(0.04, 10);
    expect(brier(1, true)).toBe(0);
    expect(brier(0, false)).toBe(0);
  });

  it("logLoss clamps to avoid infinities at 0 and 1", () => {
    // -ln(1e-6) ≈ 13.8155 — finite, never Infinity.
    expect(logLoss(0, true)).toBeCloseTo(13.8155, 3);
    expect(logLoss(1, false)).toBeCloseTo(13.8155, 3);
    expect(Number.isFinite(logLoss(1, true))).toBe(true);
    expect(logLoss(1, true)).toBeGreaterThan(0);
    expect(logLoss(1, true)).toBeLessThan(1e-5);
  });
});

describe("rollup", () => {
  it("scores resolved entries and counts pending separately", () => {
    const r = rollup([rec(0.7, true), rec(0.2, false), rec(0.5, null)]);
    expect(r.total).toBe(3);
    expect(r.resolved).toBe(2);
    expect(r.pending).toBe(1);
    expect(r.hits).toBe(1);
    expect(r.hitRate).toBeCloseTo(0.5, 10);
    expect(r.meanBrier).toBeCloseTo(0.065, 10); // (0.09 + 0.04) / 2
  });

  it("is all-zero (never NaN) for an empty or all-pending ledger", () => {
    const empty = rollup([]);
    expect(empty).toMatchObject({
      total: 0,
      resolved: 0,
      pending: 0,
      meanBrier: 0,
      hitRate: 0,
    });
    const pendingOnly = rollup([rec(0.5, null), rec(0.9, null)]);
    expect(pendingOnly.resolved).toBe(0);
    expect(pendingOnly.meanBrier).toBe(0);
    expect(Number.isNaN(pendingOnly.hitRate)).toBe(false);
  });

  it("counts each order once, using its latest (settled) entry", () => {
    const pending = rec(0.7, null, "ord_dup");
    const settled = rec(0.7, true, "ord_dup");
    const r = rollup([pending, settled]);
    expect(r.total).toBe(1);
    expect(r.resolved).toBe(1);
    expect(r.pending).toBe(0);
  });
});

describe("calibrationTable", () => {
  it("bins resolved forecasts and reports predicted vs observed per bucket", () => {
    // Two forecasts in the 0.6–0.7 bin: one hit, one miss → observedRate 0.5.
    const table = calibrationTable([rec(0.65, true), rec(0.62, false)], 10);
    const bin = table.find((b) => b.lo === 0.6);
    expect(bin).toBeDefined();
    expect(bin!.n).toBe(2);
    expect(bin!.predictedMean).toBeCloseTo(0.635, 10);
    expect(bin!.observedRate).toBeCloseTo(0.5, 10);
  });

  it("puts probability 1.0 in the top bucket (no out-of-range bin)", () => {
    const table = calibrationTable([rec(1, true)], 10);
    const top = table.find((b) => b.hi === 1);
    expect(top!.n).toBe(1);
    expect(table.every((b) => b.lo >= 0 && b.hi <= 1)).toBe(true);
  });

  it("ignores pending entries", () => {
    const table = calibrationTable([rec(0.65, null)], 10);
    expect(table.every((b) => b.n === 0)).toBe(true);
  });
});
