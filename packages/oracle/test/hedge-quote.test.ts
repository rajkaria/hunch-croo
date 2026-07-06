import { describe, expect, it } from "vitest";
import { createHedgeQuoteService } from "../src/core/services/hedge-quote.js";
import { stableStringify } from "../src/core/stable-json.js";
import { fakeOrder, fixtureHunchApi, frozenClock } from "./helpers.js";

/**
 * hedge-quote (Hunch Market Desk) — the non-custodial hedge plan. The desk
 * never touches funds; it prices an executable trade the caller signs itself.
 * Economics are computed deterministically from the live marginal price + the
 * market fee (verified against recorded playhunch.xyz quotes).
 */
function service(maxStakeUsd = 10) {
  return createHedgeQuoteService(fixtureHunchApi(), { maxStakeUsd });
}

async function plan(input: unknown, maxStakeUsd = 10) {
  return service(maxStakeUsd).handle({
    order: fakeOrder({ serviceId: "svc-hedge" }),
    requirements: "",
    input,
    clock: frozenClock,
  });
}

describe("hedge-quote service (Market Desk, non-custodial)", () => {
  it("prices a stake-sized hedge on the cheap side of a live book", async () => {
    // ansem-flip: NO trades at 8¢ against a real $12 pool. $5 buys 61.25 shares.
    const payload = await plan({
      marketSlug: "ansem-flip-pump",
      side: "no",
      stakeUsd: 5,
    });

    expect(payload.status).toBe("ok");
    expect(payload.custody).toBe("none");
    const hedge = payload.hedge as Record<string, unknown>;
    expect(hedge.side).toBe("no");
    expect(hedge.priceCents).toBe(8);
    expect(hedge.impliedProbability).toBe(0.08);

    const p = payload.plan as Record<string, number | boolean>;
    expect(p.stakeUsd).toBe(5);
    expect(p.feeUsd).toBe(0.1);
    expect(p.netUsd).toBe(4.9);
    expect(p.shares).toBe(61.25);
    expect(p.payoutIfWinUsd).toBe(61.25);
    expect(p.profitIfWinUsd).toBe(56.25);
    expect(p.returnMultiple).toBe(12.25);
    expect(p.breakevenProbability).toBe(0.08);
    expect(p.capApplied).toBe(false);
  });

  it("sizes the stake to hit a requested coverage amount", async () => {
    // aixbt YES at 50¢: $9.80 of coverage should cost exactly $5 premium.
    const payload = await plan({
      marketSlug: "aixbt-50m",
      side: "yes",
      coverageUsd: 9.8,
    });

    const p = payload.plan as Record<string, number | boolean>;
    expect(p.stakeUsd).toBe(5);
    expect(p.shares).toBe(9.8);
    expect(p.payoutIfWinUsd).toBe(9.8);

    const coverage = payload.coverage as Record<string, number | boolean>;
    expect(coverage.requestedCoverageUsd).toBe(9.8);
    expect(coverage.providedCoverageUsd).toBe(9.8);
    expect(coverage.premiumUsd).toBe(5);
    expect(coverage.fullyCovered).toBe(true);
  });

  it("clamps an oversized stake to the deterministic cap (LLM never sizes)", async () => {
    const payload = await plan({
      marketSlug: "aixbt-50m",
      side: "yes",
      stakeUsd: 100,
    });

    const p = payload.plan as Record<string, number | boolean>;
    expect(p.stakeUsd).toBe(10);
    expect(p.maxStakeUsd).toBe(10);
    expect(p.capApplied).toBe(true);
    expect(p.shares).toBe(19.6); // 9.8 net / 0.50
  });

  it("prices a ladder-outcome hedge by outcome key", async () => {
    // ada ladder: the ≤ -20% band trades at 16¢.
    const payload = await plan({
      marketSlug: "ada-mcap-ladder",
      outcome: "le-n20",
      stakeUsd: 5,
    });

    expect(payload.status).toBe("ok");
    const hedge = payload.hedge as Record<string, unknown>;
    expect(hedge.outcome).toBe("le-n20");
    expect(hedge.priceCents).toBe(16);
    expect(hedge.outcomeLabel).toBe("-20% or lower");

    const p = payload.plan as Record<string, number>;
    expect(p.shares).toBe(30.625); // 4.9 / 0.16
    expect(p.breakevenProbability).toBe(0.16);
  });

  it("matches a free-text question deterministically (no slug needed)", async () => {
    const payload = await plan({
      question: "Will $AIXBT reach a $50M market cap by July 15?",
      token: "AIXBT",
      side: "yes",
      stakeUsd: 4,
    });

    expect(payload.status).toBe("ok");
    const market = payload.market as Record<string, unknown>;
    expect(market.marketSlug).toBe("aixbt-50m");
  });

  it("returns no_market + a spawnHint when nothing matches (parity with forecast)", async () => {
    const payload = await plan({
      question: "Will $NOTATOKEN cure male pattern baldness by Friday?",
      token: "NOTATOKEN",
      side: "yes",
      stakeUsd: 5,
    });

    expect(payload.status).toBe("no_market");
    expect((payload.spawnHint as Record<string, unknown>).service).toBe("spawn");
  });

  it("carries the advisory context but never a directive — confidence reflects real money", async () => {
    const priced = await plan({ marketSlug: "ansem-flip-pump", side: "no", stakeUsd: 5 });
    expect((priced.context as Record<string, unknown>).confidence).toBe("low");
    expect((priced.context as Record<string, number>).poolUsd).toBe(12);

    const seeded = await plan({ marketSlug: "aixbt-50m", side: "yes", stakeUsd: 5 });
    expect((seeded.context as Record<string, unknown>).confidence).toBe("prior_only");
    // token reality-check survives for market-cap markets
    expect((seeded.context as Record<string, unknown>).tokenSnapshot).toBeTruthy();
  });

  it("hands back non-custodial execution instructions, no payout address", async () => {
    const payload = await plan({ marketSlug: "aixbt-50m", side: "yes", stakeUsd: 5 });
    const execute = payload.execute as Record<string, unknown>;
    expect(execute.custody).toBe("none");
    expect(execute.method).toBe("POST");
    expect(String(execute.endpoint)).toContain("/api/partner/trade");
    const params = execute.params as Record<string, unknown>;
    expect(params.marketId).toBe("aixbt-50m-mcap-2026-07-15");
    expect(params.side).toBe("yes");
    expect(params.sizeUsd).toBe(5);
    expect(execute).not.toHaveProperty("payoutAddress");
    expect(String(payload.disclaimer)).toMatch(/no order|non-custodial|holds none/i);
  });

  it("rejects a side on a ladder market (shape mismatch → escrow refund)", async () => {
    await expect(
      plan({ marketSlug: "ada-mcap-ladder", side: "yes", stakeUsd: 5 }),
    ).rejects.toThrow(/ladder|outcome/i);
  });

  it("rejects an outcome on a yes/no market", async () => {
    await expect(
      plan({ marketSlug: "aixbt-50m", outcome: "le-n20", stakeUsd: 5 }),
    ).rejects.toThrow(/yes\/no|side/i);
  });

  it("rejects malformed input before any money math (deterministic validation)", async () => {
    await expect(plan({ marketSlug: "aixbt-50m", stakeUsd: 5 })).rejects.toThrow(
      /invalid hedge-quote input/,
    );
    await expect(plan({ marketSlug: "aixbt-50m", side: "yes" })).rejects.toThrow(
      /invalid hedge-quote input/,
    );
    await expect(
      plan({ marketSlug: "aixbt-50m", side: "yes", stakeUsd: 5, coverageUsd: 5 }),
    ).rejects.toThrow(/invalid hedge-quote input/);
  });

  it("rejects an unknown market (→ escrow refund, never fakes a plan)", async () => {
    await expect(
      plan({ marketSlug: "no-such-market-xyz", side: "yes", stakeUsd: 5 }),
    ).rejects.toThrow();
  });

  it("is byte-deterministic across identical runs", async () => {
    const run = () =>
      service().handle({
        order: fakeOrder({ serviceId: "svc-hedge" }),
        requirements: "",
        input: { marketSlug: "ansem-flip-pump", side: "no", stakeUsd: 5 },
        clock: frozenClock,
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});
