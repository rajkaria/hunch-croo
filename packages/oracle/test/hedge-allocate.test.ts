import { describe, expect, it } from "vitest";
import { allocatePortfolio } from "../src/core/hedge/allocate.js";

/**
 * The deterministic budget allocator. Two modes, one rule: never invent premium,
 * scale down proportionally when the requested total exceeds the effective
 * budget, preserve the shape of the book.
 */
describe("allocatePortfolio", () => {
  it("explicit mode under budget: no scaling", () => {
    const r = allocatePortfolio(
      [{ stakeUsd: 5 }, { stakeUsd: 3 }],
      { totalCapUsd: 50 },
    );
    expect(r.mode).toBe("explicit");
    expect(r.requestedTotalUsd).toBe(8);
    expect(r.scaledBy).toBe(1);
    expect(r.capApplied).toBe(false);
    expect(r.allocations.map((a) => a.stakeUsd)).toEqual([5, 3]);
  });

  it("explicit mode over the total cap: proportional scale-down", () => {
    const r = allocatePortfolio(
      [{ stakeUsd: 30 }, { stakeUsd: 30 }],
      { totalCapUsd: 30 },
    );
    // requested 60, cap 30 → scale 0.5, each leg halved
    expect(r.requestedTotalUsd).toBe(60);
    expect(r.effectiveBudgetUsd).toBe(30);
    expect(r.scaledBy).toBe(0.5);
    expect(r.capApplied).toBe(true);
    expect(r.allocations.map((a) => a.stakeUsd)).toEqual([15, 15]);
  });

  it("explicit mode honours a tighter budgetUsd than the cap", () => {
    const r = allocatePortfolio(
      [{ stakeUsd: 10 }, { stakeUsd: 10 }],
      { budgetUsd: 10, totalCapUsd: 50 },
    );
    expect(r.effectiveBudgetUsd).toBe(10); // budget binds before cap
    expect(r.scaledBy).toBe(0.5);
    expect(r.allocations.map((a) => a.stakeUsd)).toEqual([5, 5]);
  });

  it("back-solves coverage into a stake in explicit mode", () => {
    const r = allocatePortfolio(
      [{ coverageUsd: 9.8, price: 0.5, feeRate: 0.02 }],
      { totalCapUsd: 50 },
    );
    expect(r.allocations[0]!.requestedUsd).toBe(5); // 9.8 * 0.5 / 0.98
  });

  it("budget mode splits proportional to exposure", () => {
    const r = allocatePortfolio(
      [{ exposureUsd: 300 }, { exposureUsd: 100 }],
      { budgetUsd: 40, totalCapUsd: 50 },
    );
    expect(r.mode).toBe("budget");
    // 300:100 → 30:10
    expect(r.allocations.map((a) => a.stakeUsd)).toEqual([30, 10]);
    expect(r.allocations.every((a) => a.source === "proportional")).toBe(true);
  });

  it("budget mode clamps the split to the total cap", () => {
    const r = allocatePortfolio(
      [{ exposureUsd: 300 }, { exposureUsd: 100 }],
      { budgetUsd: 80, totalCapUsd: 40 },
    );
    // budget 80 > cap 40 → scale 0.5 → 30,10
    expect(r.effectiveBudgetUsd).toBe(40);
    expect(r.allocations.map((a) => a.stakeUsd)).toEqual([30, 10]);
    expect(r.capApplied).toBe(true);
  });

  it("budget mode with no exposures splits equally", () => {
    const r = allocatePortfolio([{}, {}, {}], { budgetUsd: 30, totalCapUsd: 50 });
    expect(r.allocations.map((a) => a.stakeUsd)).toEqual([10, 10, 10]);
  });

  it("a single explicit leg is unscaled", () => {
    const r = allocatePortfolio([{ stakeUsd: 7 }], { totalCapUsd: 50 });
    expect(r.allocations[0]!.stakeUsd).toBe(7);
    expect(r.scaledBy).toBe(1);
  });
});
