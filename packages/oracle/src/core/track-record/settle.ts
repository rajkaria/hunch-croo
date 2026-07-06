import type { HunchMarketResult } from "../../ports/hunch.js";
import type { Clock } from "../../ports/runtime.js";
import {
  latestByOrder,
  type ForecastRecord,
  type ForecastRecordDraft,
} from "./entry.js";

/**
 * Settlement: score a recorded forecast against the market's real resolution.
 * Honest by construction — a forecast is scored ONLY once its market has
 * actually resolved to a concrete outcome. Anything still open, or resolved to
 * no outcome (a voided / refunded market), stays pending and never enters the
 * scorecard's Brier or calibration.
 */

/** Latest-per-order records that have not yet been settled. */
export function pendingOrders(records: ForecastRecord[]): ForecastRecord[] {
  return latestByOrder(records).filter((r) => r.resolution === null);
}

/**
 * Produce a settled draft (same content, resolution filled) for a pending
 * record, or null if the market has not resolved to a concrete outcome yet.
 */
export function settleRecord(
  record: ForecastRecord,
  result: HunchMarketResult,
  clock: Clock,
): ForecastRecordDraft | null {
  const resolved = result.status === "resolved" || Boolean(result.resolvedOutcome);
  if (!resolved) return null;
  if (typeof result.resolvedOutcome !== "string" || result.resolvedOutcome === "") {
    // Resolved with no concrete outcome (void/refund) — not a scoreable forecast.
    return null;
  }

  const outcomeKey = result.resolvedOutcome;
  const settledAt = clock.now().toISOString();
  return {
    orderId: record.orderId,
    txHash: record.txHash,
    recordedAt: record.recordedAt,
    question: record.question,
    marketId: record.marketId,
    marketSlug: record.marketSlug,
    marketUrl: record.marketUrl,
    predictedOutcomeKey: record.predictedOutcomeKey,
    probability: record.probability,
    confidence: record.confidence,
    deadlineAt: record.deadlineAt,
    resolution: {
      outcomeKey,
      hit: outcomeKey === record.predictedOutcomeKey,
      resolvedAt: result.resolvedAt ?? settledAt,
      proofUrl: result.proofUrl,
      settledAt,
    },
  };
}
