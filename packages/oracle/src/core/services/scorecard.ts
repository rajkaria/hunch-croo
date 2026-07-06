import type { LedgerStore } from "../../ports/ledger.js";
import type { ServiceContext, ServiceHandler } from "../service-registry.js";
import { latestByOrder, type ForecastRecord } from "../track-record/entry.js";
import { rollup } from "../track-record/scoring.js";

/**
 * `scorecard` — the desk's public, tamper-evident track record. Read-only, no
 * input, no money path: it summarizes every forecast the desk has sold and how
 * those forecasts actually resolved (Brier, log-loss, calibration), and echoes
 * the ledger head hash so a caller can pin the record and later prove it wasn't
 * edited. "Don't trust, verify" — turned on the oracle itself.
 */
export interface ScorecardOptions {
  /** How many recent forecasts to include in the response (default 20). */
  recentLimit?: number;
}

/** A ledger record trimmed to the fields safe to publish. */
function publicEntry(r: ForecastRecord): Record<string, unknown> {
  return {
    orderId: r.orderId,
    txHash: r.txHash,
    question: r.question,
    marketSlug: r.marketSlug,
    marketUrl: r.marketUrl,
    predictedOutcomeKey: r.predictedOutcomeKey,
    probability: r.probability,
    confidence: r.confidence,
    recordedAt: r.recordedAt,
    deadlineAt: r.deadlineAt,
    resolution: r.resolution,
    entryHash: r.entryHash,
  };
}

export function createScorecardService(
  ledger: LedgerStore,
  options: ScorecardOptions = {},
): ServiceHandler {
  const recentLimit = options.recentLimit ?? 20;
  return {
    name: "scorecard",
    async handle(ctx: ServiceContext): Promise<Record<string, unknown>> {
      const records = await ledger.list();
      const headHash = await ledger.head();
      const recent = latestByOrder(records)
        .sort((a, b) => b.seq - a.seq)
        .slice(0, recentLimit)
        .map(publicEntry);
      return {
        service: "scorecard",
        status: "ok",
        desk: "hunch-oracle",
        note: "Every forecast this desk has sold, scored against the market's real resolution. Only resolved markets count toward Brier and calibration; pending ones are listed but never inflate the numbers. Pin headHash to audit the record later.",
        rollup: rollup(records),
        recent,
        headHash,
        asOf: ctx.clock.now().toISOString(),
      };
    },
  };
}
