import type { ForecastRecord } from "./entry.js";
import { latestByOrder } from "./entry.js";

/**
 * Deterministic forecast scoring. No model, no LLM — pure arithmetic over the
 * recorded probability and the market's actual resolution. Only *resolved*
 * forecasts are scored; pending ones are counted but never enter Brier or
 * calibration, so the numbers can never be inflated by open positions.
 */

const EPS = 1e-6;

/** Squared error of a probability against the 0/1 outcome. Lower is better. */
export function brier(probability: number, hit: boolean): number {
  const outcome = hit ? 1 : 0;
  return (probability - outcome) ** 2;
}

/** Negative log-likelihood, clamped away from 0/1 so it is always finite. */
export function logLoss(probability: number, hit: boolean): number {
  const p = Math.min(1 - EPS, Math.max(EPS, probability));
  return hit ? -Math.log(p) : -Math.log(1 - p);
}

export interface CalibrationBin {
  lo: number;
  hi: number;
  n: number;
  /** Mean predicted probability of the forecasts that fell in this bucket. */
  predictedMean: number;
  /** Fraction of those forecasts that actually hit. */
  observedRate: number;
}

export interface Rollup {
  total: number;
  resolved: number;
  pending: number;
  hits: number;
  hitRate: number;
  meanBrier: number;
  meanLogLoss: number;
  calibration: CalibrationBin[];
}

/** Resolved, deduped-to-latest records — the scoring population. */
function resolvedRecords(records: ForecastRecord[]): ForecastRecord[] {
  return latestByOrder(records).filter((r) => r.resolution !== null);
}

/**
 * A reliability table: `bins` equal-width buckets over [0, 1]. Each bucket
 * reports how many resolved forecasts landed there, their mean predicted
 * probability, and the rate at which they actually hit. A well-calibrated desk
 * has predictedMean ≈ observedRate in every populated bucket.
 */
export function calibrationTable(
  records: ForecastRecord[],
  bins = 10,
): CalibrationBin[] {
  const buckets = Array.from({ length: bins }, (_, i) => ({
    lo: i / bins,
    hi: (i + 1) / bins,
    probs: [] as number[],
    hits: 0,
  }));
  for (const r of resolvedRecords(records)) {
    // Clamp index so probability 1.0 lands in the top bucket, not a phantom one.
    const idx = Math.min(bins - 1, Math.floor(r.probability * bins));
    const bucket = buckets[idx]!;
    bucket.probs.push(r.probability);
    if (r.resolution!.hit) bucket.hits += 1;
  }
  return buckets.map((b) => ({
    lo: b.lo,
    hi: b.hi,
    n: b.probs.length,
    predictedMean: b.probs.length
      ? b.probs.reduce((a, p) => a + p, 0) / b.probs.length
      : 0,
    observedRate: b.probs.length ? b.hits / b.probs.length : 0,
  }));
}

/** Full aggregate of the ledger — the public scorecard payload. */
export function rollup(records: ForecastRecord[], bins = 10): Rollup {
  const active = latestByOrder(records);
  const resolved = active.filter((r) => r.resolution !== null);
  const pending = active.length - resolved.length;
  const hits = resolved.filter((r) => r.resolution!.hit).length;
  const sumBrier = resolved.reduce(
    (a, r) => a + brier(r.probability, r.resolution!.hit),
    0,
  );
  const sumLogLoss = resolved.reduce(
    (a, r) => a + logLoss(r.probability, r.resolution!.hit),
    0,
  );
  const n = resolved.length;
  return {
    total: active.length,
    resolved: n,
    pending,
    hits,
    hitRate: n ? hits / n : 0,
    meanBrier: n ? sumBrier / n : 0,
    meanLogLoss: n ? sumLogLoss / n : 0,
    calibration: calibrationTable(records, bins),
  };
}
