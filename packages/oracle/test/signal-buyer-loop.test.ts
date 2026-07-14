import { describe, expect, it, vi } from "vitest";
import type { OracleLogger, Sleeper } from "../src/ports/runtime.js";
import type { BuyerRoundReport } from "../src/core/signal-buyer/buyer.js";
import { runBuyerLoop, type RoundRunner } from "../src/core/signal-buyer/loop.js";

const report = (over: Partial<BuyerRoundReport> = {}): BuyerRoundReport => ({
  day: "2026-07-12",
  live: false,
  attempted: 0,
  purchased: 0,
  skipped: 0,
  failed: 0,
  spentUsd: 0,
  signals: [],
  purchases: [],
  hired: [],
  ...over,
});

/** A sleeper that resolves instantly so the loop runs at test speed. */
const instantSleeper: Sleeper = { sleep: async () => {} };

/** Stop after `n` rounds have started — mirrors the shutdown-flag pattern. */
const stopAfter = (n: number) => {
  let started = 0;
  return {
    shouldContinue: () => started < n,
    tick: () => {
      started += 1;
    },
  };
};

describe("runBuyerLoop", () => {
  it("runs N rounds against ONE runner, so daily-cap state accumulates across rounds", async () => {
    // A stateful runner: it carries a running spend total the way the real
    // buyer carries its in-memory ledger. If the loop reconstructed the runner
    // each round this total would reset to 0 — asserting it grows proves the
    // loop reuses the single instance the caller handed in.
    let spent = 0;
    const gate = stopAfter(3);
    const runner: RoundRunner = {
      runRound: async () => {
        gate.tick();
        spent += 1;
        return report({ purchased: 1, spentUsd: spent });
      },
    };
    const sleeper = { sleep: vi.fn(async () => {}) };
    const reports: BuyerRoundReport[] = [];

    const rounds = await runBuyerLoop({
      runner,
      sleeper,
      intervalMs: 1000,
      shouldContinue: gate.shouldContinue,
      onReport: (r) => reports.push(r),
    });

    expect(rounds).toBe(3);
    expect(reports.map((r) => r.spentUsd)).toEqual([1, 2, 3]);
    // Sleeps happen BETWEEN rounds only — three rounds → two sleeps.
    expect(sleeper.sleep).toHaveBeenCalledTimes(2);
    expect(sleeper.sleep).toHaveBeenCalledWith(1000);
  });

  it("is fail-soft: a thrown round is logged and the loop keeps going", async () => {
    const gate = stopAfter(3);
    let n = 0;
    const runner: RoundRunner = {
      runRound: async () => {
        gate.tick();
        n += 1;
        if (n === 2) throw new Error("network blip");
        return report();
      },
    };
    const logged: string[] = [];
    const logger: OracleLogger = {
      info: () => {},
      warn: () => {},
      error: (m) => logged.push(m),
    };

    const rounds = await runBuyerLoop({
      runner,
      sleeper: instantSleeper,
      intervalMs: 1,
      shouldContinue: gate.shouldContinue,
      logger,
    });

    expect(rounds).toBe(3); // the throw did not end the loop
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/round failed/);
  });

  it("runs zero rounds when shutdown is already requested", async () => {
    const runRound = vi.fn(async () => report());
    const rounds = await runBuyerLoop({
      runner: { runRound },
      sleeper: instantSleeper,
      intervalMs: 1,
      shouldContinue: () => false,
    });
    expect(rounds).toBe(0);
    expect(runRound).not.toHaveBeenCalled();
  });
});
