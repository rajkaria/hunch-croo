import { describe, it, expect } from "vitest";
import { extractForecastRecord } from "../src/core/track-record/record-from-forecast.js";
import type { CapOrder } from "../src/ports/cap.js";
import type { Clock } from "../src/ports/runtime.js";

const clock: Clock = { now: () => new Date("2026-07-06T12:00:00.000Z") };

const order: CapOrder = {
  orderId: "ord_42",
  negotiationId: "neg_1",
  serviceId: "svc_forecast",
  requesterAgentId: "agent_x",
  price: "1000000",
  paymentToken: "USDC",
  status: "paid",
};

function binaryPayload(): Record<string, unknown> {
  return {
    service: "forecast",
    status: "ok",
    question: "Will AIXBT close above $1 by 2026?",
    probability: 0.34,
    side: "yes",
    marketId: "mkt_aixbt",
    marketSlug: "aixbt-above-1",
    marketUrl: "https://www.playhunch.xyz/m/aixbt-above-1",
    marketQuestion: "Will AIXBT close above $1?",
    category: "price",
    deadlineAt: "2026-12-31T00:00:00.000Z",
    odds: { yes: 34, no: 66 },
    poolUsd: 120,
    totalBets: 12,
    confidence: "high",
    method: "pool_implied_odds",
    matchScore: 0.9,
  };
}

describe("extractForecastRecord", () => {
  it("records a binary forecast as a YES claim at the desk's P(yes)", () => {
    const rec = extractForecastRecord(binaryPayload(), order, "0xdeadbeef", clock);
    expect(rec).not.toBeNull();
    expect(rec).toMatchObject({
      orderId: "ord_42",
      txHash: "0xdeadbeef",
      recordedAt: "2026-07-06T12:00:00.000Z",
      marketId: "mkt_aixbt",
      marketSlug: "aixbt-above-1",
      predictedOutcomeKey: "yes", // even though NO is more likely, the desk sells P(yes)
      probability: 0.34,
      confidence: "high",
      deadlineAt: "2026-12-31T00:00:00.000Z",
      resolution: null,
    });
  });

  it("records a ladder forecast as the top-priced outcome key", () => {
    const payload = {
      ...binaryPayload(),
      method: "pool_implied_ladder",
      probability: 0.45,
      odds: { "1x-2x": 20, "2x-5x": 45, "5x-plus": 35 },
    };
    const rec = extractForecastRecord(payload, order, null, clock);
    expect(rec?.predictedOutcomeKey).toBe("2x-5x");
    expect(rec?.probability).toBe(0.45);
    expect(rec?.txHash).toBeNull();
  });

  it("returns null when the market didn't match (no_market)", () => {
    const rec = extractForecastRecord(
      { service: "forecast", status: "no_market", question: "?" },
      order,
      null,
      clock,
    );
    expect(rec).toBeNull();
  });

  it("returns null for non-forecast services", () => {
    for (const service of ["verify", "sentiment", "research", "hedge-quote"]) {
      const rec = extractForecastRecord(
        { service, status: "ok", verdict: "yes" },
        order,
        null,
        clock,
      );
      expect(rec).toBeNull();
    }
  });

  it("returns null for a malformed forecast payload (no resolvable market)", () => {
    const rec = extractForecastRecord(
      { service: "forecast", status: "ok", probability: 0.5 }, // no marketId/deadline
      order,
      null,
      clock,
    );
    expect(rec).toBeNull();
  });
});
