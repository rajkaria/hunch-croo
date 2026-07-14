import type { OracleLogger, Sleeper } from "../../ports/runtime.js";
import type { BuyerRoundReport } from "./buyer.js";

/** The minimal buyer surface the loop drives — one capped hire round per tick. */
export interface RoundRunner {
  runRound(): Promise<BuyerRoundReport>;
}

export interface BuyerLoopOptions {
  runner: RoundRunner;
  sleeper: Sleeper;
  /** Wall-clock gap between the end of one round and the start of the next. */
  intervalMs: number;
  /**
   * The loop runs while this returns true; it is checked before every round
   * and again before every sleep, so a shutdown flag ends the loop within one
   * round rather than one interval.
   */
  shouldContinue: () => boolean;
  logger?: OracleLogger;
  /** Observer for each completed round — the entrypoint logs, tests assert. */
  onReport?: (report: BuyerRoundReport) => void;
}

/**
 * Drive a single SignalBuyer round-after-round on one long-lived process.
 *
 * WHY a long-lived loop and not a cron of the one-shot: the daily-cap ledger
 * lives in the buyer's in-memory store (see ledger.ts#InMemorySignalStore).
 * Reusing ONE runner across rounds is exactly what makes the per-UTC-day cap
 * hold — a fresh process per round would reset the ledger to zero and let the
 * buyer blow clean through its daily budget every tick. So this loop never
 * reconstructs the runner; the caller builds it once and hands it in.
 *
 * Fail-soft: a thrown round (network blip, transient upstream) is logged and
 * the loop sleeps and retries — one bad tick never takes the buyer down, and
 * the caps are unaffected because a failed round moves no money. The buyer
 * holds no escrow between rounds, so a hard stop mid-sleep is always safe.
 *
 * Returns the number of rounds attempted (handy for final stats / tests).
 */
export async function runBuyerLoop(opts: BuyerLoopOptions): Promise<number> {
  const { runner, sleeper, intervalMs, shouldContinue, logger, onReport } = opts;
  let rounds = 0;
  while (shouldContinue()) {
    rounds += 1;
    try {
      const report = await runner.runRound();
      onReport?.(report);
    } catch (error) {
      logger?.error("signal-buyer round failed; will retry next tick", {
        error: String(error),
      });
    }
    if (!shouldContinue()) break;
    await sleeper.sleep(intervalMs);
  }
  return rounds;
}
