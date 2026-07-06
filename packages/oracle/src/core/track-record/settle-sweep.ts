import type { HunchApi } from "../../ports/hunch.js";
import type { LedgerStore } from "../../ports/ledger.js";
import type { Clock, OracleLogger } from "../../ports/runtime.js";
import { pendingOrders, settleRecord } from "./settle.js";

/**
 * One settle pass over the ledger: for every pending forecast, read the market's
 * resolution and, if it has resolved to a concrete outcome, append a settled
 * record. Fail-soft per market — a resolver outage on one market is logged and
 * retried on the next sweep, never crashing the loop or blocking the others.
 */
export interface SettleSweepDeps {
  ledger: LedgerStore;
  hunch: Pick<HunchApi, "result">;
  clock: Clock;
  logger: OracleLogger;
}

export interface SettleSweepResult {
  /** Forecasts settled this pass. */
  scored: number;
  /** Forecasts still awaiting resolution after this pass (retried next sweep). */
  pending: number;
  /** Markets whose result was unavailable this pass (fail-soft, retried). */
  errors: number;
}

export async function runSettleSweep(
  deps: SettleSweepDeps,
): Promise<SettleSweepResult> {
  const { ledger, hunch, clock, logger } = deps;
  const pending = pendingOrders(await ledger.list());
  let scored = 0;
  let errors = 0;

  for (const record of pending) {
    try {
      const read = await hunch.result(record.marketId);
      const settled = settleRecord(record, read.data.result, clock);
      if (settled) {
        await ledger.append(settled);
        scored += 1;
        logger.info("forecast settled", {
          orderId: record.orderId,
          marketId: record.marketId,
          hit: settled.resolution!.hit,
        });
      }
    } catch (error) {
      errors += 1;
      logger.warn("settle: market result unavailable; will retry next sweep", {
        orderId: record.orderId,
        marketId: record.marketId,
        error: String(error),
      });
    }
  }

  return { scored, pending: pending.length - scored, errors };
}
