import { round2, stakeForCoverage } from "./leg.js";

/**
 * Deterministic budget allocation across a portfolio's hedge legs. The LLM never
 * sizes a basket — this does. Two modes, inferred from the inputs:
 *
 *  - **explicit**: every leg carries a `stakeUsd` or `coverageUsd`. Requested
 *    stakes are summed; if they exceed the effective budget
 *    (`min(sum, budgetUsd?, totalCapUsd)`) every leg is scaled by the same factor
 *    so the *shape* of the book is preserved and the total is honoured.
 *  - **budget**: a single `budgetUsd` is split across legs proportional to their
 *    `exposureUsd` (equal split when no exposures are given), then clamped to
 *    `totalCapUsd`.
 *
 * Scaling only ever reduces (never invents premium). Per-leg caps are applied
 * later by `priceLeg`, so a leg can end up below its allocation — that's fine and
 * honest; we don't redistribute the remainder.
 */
export interface AllocatorPosition {
  stakeUsd?: number;
  coverageUsd?: number;
  exposureUsd?: number;
  /** Live price (0..1) + fee rate for this leg — needed to back-solve coverage. */
  price?: number;
  feeRate?: number;
}

export interface PositionAllocation {
  index: number;
  requestedUsd: number;
  stakeUsd: number;
  source: "explicit" | "proportional";
}

export interface AllocationResult {
  mode: "explicit" | "budget";
  allocations: PositionAllocation[];
  requestedTotalUsd: number;
  effectiveBudgetUsd: number;
  /** requested → effective scale factor (<= 1). 1 means nothing was scaled. */
  scaledBy: number;
  capApplied: boolean;
}

export function allocatePortfolio(
  positions: AllocatorPosition[],
  opts: { budgetUsd?: number; totalCapUsd: number },
): AllocationResult {
  const anyExplicit = positions.some(
    (p) => p.stakeUsd !== undefined || p.coverageUsd !== undefined,
  );
  const mode: "explicit" | "budget" = anyExplicit ? "explicit" : "budget";

  // Requested premium per leg, before any scaling.
  let requested: number[];
  if (mode === "explicit") {
    requested = positions.map((p) => {
      if (p.stakeUsd !== undefined) return p.stakeUsd;
      if (p.coverageUsd !== undefined && p.price !== undefined && p.feeRate !== undefined) {
        return stakeForCoverage(p.coverageUsd, p.price, p.feeRate);
      }
      return 0;
    });
  } else {
    const budget = opts.budgetUsd ?? 0;
    const totalExposure = positions.reduce((sum, p) => sum + (p.exposureUsd ?? 0), 0);
    requested =
      totalExposure > 0
        ? positions.map((p) => (budget * (p.exposureUsd ?? 0)) / totalExposure)
        : positions.map(() => budget / positions.length);
  }

  const requestedTotal = requested.reduce((sum, r) => sum + r, 0);
  const effectiveBudget = Math.min(
    requestedTotal,
    opts.budgetUsd ?? Infinity,
    opts.totalCapUsd,
  );
  const scaledBy =
    requestedTotal > 1e-9 ? Math.min(1, effectiveBudget / requestedTotal) : 1;

  const allocations: PositionAllocation[] = positions.map((_, index) => ({
    index,
    requestedUsd: round2(requested[index]!),
    stakeUsd: round2(requested[index]! * scaledBy),
    source: mode === "explicit" ? "explicit" : "proportional",
  }));

  return {
    mode,
    allocations,
    requestedTotalUsd: round2(requestedTotal),
    effectiveBudgetUsd: round2(effectiveBudget),
    scaledBy: Math.round((scaledBy + Number.EPSILON) * 1e6) / 1e6,
    capApplied: scaledBy < 1 - 1e-9,
  };
}
