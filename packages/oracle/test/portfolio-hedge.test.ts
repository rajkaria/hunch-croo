import { describe, expect, it } from "vitest";
import { createPortfolioHedgeService } from "../src/core/services/portfolio-hedge.js";
import { stableStringify } from "../src/core/stable-json.js";
import { fakeOrder, fixtureHunchApi, frozenClock } from "./helpers.js";

/**
 * portfolio-hedge (Market Desk, non-custodial) — a basket of hedge legs priced
 * off the live book, sized by a deterministic allocator, with portfolio
 * aggregates and per-leg fail-soft. Reuses the S9 fixtures (ansem/aixbt/ada).
 */
function service(opts?: { maxStakeUsd?: number; maxLegStakeUsd?: number }) {
  return createPortfolioHedgeService(fixtureHunchApi(), {
    maxStakeUsd: opts?.maxStakeUsd ?? 50,
    maxLegStakeUsd: opts?.maxLegStakeUsd ?? 10,
  });
}

async function hedge(input: unknown, opts?: { maxStakeUsd?: number; maxLegStakeUsd?: number }) {
  return service(opts).handle({
    order: fakeOrder({ serviceId: "svc-portfolio" }),
    requirements: "",
    input,
    clock: frozenClock,
  });
}

type Leg = Record<string, unknown>;

describe("portfolio-hedge service", () => {
  it("prices a 3-market explicit basket and sums the aggregates", async () => {
    const payload = await hedge({
      positions: [
        { marketSlug: "ansem-flip-pump", side: "no", stakeUsd: 5, label: "ansem" },
        { marketSlug: "aixbt-50m", side: "yes", stakeUsd: 5, label: "aixbt" },
        { marketSlug: "ada-mcap-ladder", outcome: "le-n20", stakeUsd: 5, label: "ada" },
      ],
    });

    expect(payload.status).toBe("ok");
    expect(payload.custody).toBe("none");
    const p = payload.portfolio as Record<string, number | string | null>;
    expect(p.pricedLegs).toBe(3);
    expect(p.skippedLegs).toBe(0);
    expect(p.mode).toBe("explicit");
    expect(p.totalPremiumUsd).toBe(15);
    // 61.25 (ansem) + 9.8 (aixbt) + 30.625 (ada) = 101.675 → 101.68
    expect(p.totalPayoutIfAllHitUsd).toBe(101.68);
    expect(p.capApplied).toBe(false);

    const legs = payload.legs as Leg[];
    expect(legs).toHaveLength(3);
    const ansem = legs[0]!;
    expect((ansem.plan as Record<string, number>).shares).toBe(61.25);
    expect((ansem.execute as Record<string, unknown>).custody).toBe("none");
  });

  it("allocates one budget across legs proportional to exposure (budget mode)", async () => {
    const payload = await hedge({
      budgetUsd: 12,
      positions: [
        { marketSlug: "ansem-flip-pump", side: "no", exposureUsd: 300 },
        { marketSlug: "aixbt-50m", side: "yes", exposureUsd: 100 },
      ],
    });
    const p = payload.portfolio as Record<string, number | string>;
    expect(p.mode).toBe("budget");
    const legs = payload.legs as Leg[];
    // 300:100 of $12 → $9 and $3
    expect((legs[0]!.allocation as Record<string, number>).allocatedUsd).toBe(9);
    expect((legs[1]!.allocation as Record<string, number>).allocatedUsd).toBe(3);
    expect((legs[0]!.allocation as Record<string, string>).source).toBe("proportional");
  });

  it("scales the whole basket down when the requested total exceeds the cap", async () => {
    const payload = await hedge(
      {
        positions: [
          { marketSlug: "ansem-flip-pump", side: "no", stakeUsd: 40 },
          { marketSlug: "aixbt-50m", side: "yes", stakeUsd: 40 },
        ],
      },
      { maxStakeUsd: 50, maxLegStakeUsd: 100 }, // total cap binds, not per-leg
    );
    const p = payload.portfolio as Record<string, number | boolean>;
    expect(p.scaledBy).toBe(0.625); // 50 / 80
    expect(p.capApplied).toBe(true);
    expect(p.totalPremiumUsd).toBe(50);
    const legs = payload.legs as Leg[];
    expect((legs[0]!.allocation as Record<string, number>).allocatedUsd).toBe(25);
  });

  it("skips a no-match leg with a spawn hint while pricing the rest", async () => {
    const payload = await hedge({
      positions: [
        { marketSlug: "ansem-flip-pump", side: "no", stakeUsd: 5 },
        { question: "Will $NOTATOKEN cure baldness by Friday?", token: "NOTATOKEN", side: "yes", stakeUsd: 5 },
      ],
    });
    expect(payload.status).toBe("ok");
    const p = payload.portfolio as Record<string, number>;
    expect(p.pricedLegs).toBe(1);
    expect(p.skippedLegs).toBe(1);
    const legs = payload.legs as Leg[];
    const skipped = legs.find((l) => l.status === "no_market")!;
    expect((skipped.spawnHint as Record<string, unknown>).service).toBe("spawn");
  });

  it("flags legs on the same market as correlated (not independent)", async () => {
    const payload = await hedge({
      positions: [
        { marketSlug: "aixbt-50m", side: "yes", stakeUsd: 5 },
        { marketSlug: "aixbt-50m", side: "no", stakeUsd: 5 },
      ],
    });
    const groups = payload.correlatedGroups as Array<Record<string, unknown>>;
    const marketGroup = groups.find((g) => g.kind === "market")!;
    expect(marketGroup).toBeTruthy();
    expect(marketGroup.legIndexes).toEqual([0, 1]);
  });

  it("degrades one bad-quote leg to an error while the rest price (fail-soft)", async () => {
    const payload = await hedge({
      positions: [
        { marketSlug: "ansem-flip-pump", side: "no", stakeUsd: 5 },
        { marketSlug: "no-such-market-zzz", side: "yes", stakeUsd: 5 },
      ],
    });
    expect(payload.status).toBe("ok");
    const legs = payload.legs as Leg[];
    expect((payload.portfolio as Record<string, number>).pricedLegs).toBe(1);
    const errored = legs.find((l) => l.status === "error")!;
    expect(String(errored.reason)).toBeTruthy();
  });

  it("returns no_market when nothing in the basket matches (still delivers)", async () => {
    const payload = await hedge({
      positions: [
        { question: "Will $NOTATOKEN moon?", token: "NOTATOKEN", side: "yes", stakeUsd: 5 },
        { question: "Will $ALSONOT flip?", token: "ALSONOT", side: "yes", stakeUsd: 5 },
      ],
    });
    expect(payload.status).toBe("no_market");
    expect((payload.portfolio as Record<string, number>).pricedLegs).toBe(0);
  });

  it("rejects (→ escrow refund) when every priceable leg fails upstream", async () => {
    await expect(
      hedge({
        positions: [
          { marketSlug: "no-such-market-a", side: "yes", stakeUsd: 5 },
          { marketSlug: "no-such-market-b", side: "yes", stakeUsd: 5 },
        ],
      }),
    ).rejects.toThrow(/every priceable leg failed/);
  });

  it("rejects malformed and mixed-mode input before any money math", async () => {
    // mixed: leg 1 explicit, leg 2 no size and no budget
    await expect(
      hedge({
        positions: [
          { marketSlug: "ansem-flip-pump", side: "no", stakeUsd: 5 },
          { marketSlug: "aixbt-50m", side: "yes" },
        ],
      }),
    ).rejects.toThrow(/invalid portfolio-hedge input/);

    // a position with neither side nor outcome
    await expect(
      hedge({ positions: [{ marketSlug: "ansem-flip-pump", stakeUsd: 5 }] }),
    ).rejects.toThrow(/invalid portfolio-hedge input/);

    // empty basket
    await expect(hedge({ positions: [] })).rejects.toThrow(/invalid portfolio-hedge input/);
  });

  it("is byte-deterministic across identical runs", async () => {
    const input = {
      positions: [
        { marketSlug: "ansem-flip-pump", side: "no", stakeUsd: 5 },
        { marketSlug: "ada-mcap-ladder", outcome: "le-n20", stakeUsd: 5 },
      ],
    };
    const [a, b] = await Promise.all([hedge(input), hedge(input)]);
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});
