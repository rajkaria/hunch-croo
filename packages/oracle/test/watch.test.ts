import { describe, expect, it } from "vitest";
import { MockHunchApi } from "../src/adapters/mock/hunch.js";
import { createWatchService } from "../src/core/services/watch.js";
import type { Clock, Sleeper } from "../src/ports/runtime.js";
import type { HunchMarketResult, HunchQuote } from "../src/ports/hunch.js";
import { FROZEN_NOW, fakeOrder, fixtureCatalogue, loadFixture } from "./helpers.js";

/**
 * Deterministic time rig: sleep() advances the fake clock instantly, so a
 * 2-hour watch runs in microseconds and every assertion is exact.
 */
function timeRig(startMs: number): { clock: Clock; sleeper: Sleeper; now: () => number } {
  let now = startMs;
  return {
    clock: { now: () => new Date(now) },
    sleeper: {
      sleep: async (ms: number) => {
        now += ms;
      },
    },
    now: () => now,
  };
}

const START = Date.parse(FROZEN_NOW);

function ansemQuote(yesPriceCents: number): HunchQuote {
  const base = loadFixture<HunchQuote>("quote-ansem-flip.json");
  return {
    ...base,
    odds: { yesPriceCents, noPriceCents: 100 - yesPriceCents },
  };
}

function pendingResult(): HunchMarketResult {
  return {
    marketId: "ansem-flip-pump-dec-31-2026",
    status: "pending",
    resolvedOutcome: null,
    resolvedOutcomeLabel: null,
    resolvedAt: null,
    source: "dexscreener",
    sourceUrl: null,
    observedMarketCapUsd: null,
    payoutPerShareUsd: null,
    poolUsd: 12,
    winningShares: 0,
    proofUrl: null,
  };
}

function resolvedResult(): HunchMarketResult {
  return {
    ...pendingResult(),
    status: "resolved",
    resolvedOutcome: "yes",
    resolvedOutcomeLabel: "YES",
    resolvedAt: "2026-07-05T23:30:00.000Z",
    sourceUrl: "https://dexscreener.com/base/0xpair",
    proofUrl: "https://www.playhunch.xyz/markets/ansem-flip-pump/proof",
    payoutPerShareUsd: 1.04,
  };
}

describe("watch service", () => {
  it("fires on resolution and delivers the proof payload", async () => {
    const rig = timeRig(START);
    const hunch = new MockHunchApi({
      catalogue: fixtureCatalogue(),
      readAt: FROZEN_NOW,
      quotes: { "ansem-flip-pump-dec-31-2026": ansemQuote(92) },
      resultSequences: {
        "ansem-flip-pump-dec-31-2026": [pendingResult(), pendingResult(), resolvedResult()],
      },
    });
    const service = createWatchService({ hunch, sleeper: rig.sleeper });

    const payload = await service.handle({
      order: fakeOrder({ slaDeadline: new Date(START + 3_600_000).toISOString() }),
      requirements: "",
      input: {
        marketSlug: "ansem-flip-pump-dec-31-2026",
        trigger: { kind: "resolution" },
        pollSeconds: 30,
      },
      clock: rig.clock,
    });

    expect(payload.status).toBe("triggered");
    expect(payload.checks).toBe(3);
    const resolution = payload.resolution as { outcome: string; proofUrl: string };
    expect(resolution.outcome).toBe("yes");
    expect(resolution.proofUrl).toContain("proof");
    // fired on the third poll: two sleeps of 30s
    expect(rig.now()).toBe(START + 60_000);
  });

  it("fires on an odds cross (above)", async () => {
    const rig = timeRig(START);
    const hunch = new MockHunchApi({
      catalogue: fixtureCatalogue(),
      readAt: FROZEN_NOW,
      quoteSequences: {
        "ansem-flip-pump-dec-31-2026": [
          ansemQuote(60), // watch begins (slug resolve)
          ansemQuote(60), // check 1 — below
          ansemQuote(72), // check 2 — fires ≥ 0.7
        ],
      },
    });
    const service = createWatchService({ hunch, sleeper: rig.sleeper });

    const payload = await service.handle({
      order: fakeOrder({ slaDeadline: new Date(START + 3_600_000).toISOString() }),
      requirements: "",
      input: {
        marketSlug: "ansem-flip-pump-dec-31-2026",
        trigger: { kind: "oddsCross", threshold: 0.7, side: "yes", direction: "above" },
        pollSeconds: 30,
      },
      clock: rig.clock,
    });

    expect(payload.status).toBe("triggered");
    const crossing = payload.crossing as { probability: number; threshold: number };
    expect(crossing.probability).toBe(0.72);
    expect(crossing.threshold).toBe(0.7);
  });

  it("delivers an honest no_trigger at the SLA margin", async () => {
    const rig = timeRig(START);
    const hunch = new MockHunchApi({
      catalogue: fixtureCatalogue(),
      readAt: FROZEN_NOW,
      quotes: { "ansem-flip-pump-dec-31-2026": ansemQuote(60) },
    });
    const service = createWatchService({ hunch, sleeper: rig.sleeper });

    // 5-minute SLA → 4-minute watch window (60s delivery margin).
    const payload = await service.handle({
      order: fakeOrder({ slaDeadline: new Date(START + 300_000).toISOString() }),
      requirements: "",
      input: {
        marketSlug: "ansem-flip-pump-dec-31-2026",
        trigger: { kind: "oddsCross", threshold: 0.95, side: "yes", direction: "above" },
        pollSeconds: 60,
      },
      clock: rig.clock,
    });

    expect(payload.status).toBe("no_trigger");
    expect(payload.watchedForSeconds).toBe(240);
    expect(payload.checks).toBe(5); // t=0,60,120,180,240
    const lastReading = payload.lastReading as { probability: number };
    expect(lastReading.probability).toBe(0.6);
  });

  it("rejects an unknown slug up front (caller error → refund)", async () => {
    const rig = timeRig(START);
    const hunch = new MockHunchApi({
      catalogue: fixtureCatalogue(),
      readAt: FROZEN_NOW,
    });
    const service = createWatchService({ hunch, sleeper: rig.sleeper });
    await expect(
      service.handle({
        order: fakeOrder(),
        requirements: "",
        input: {
          marketSlug: "definitely-not-a-market",
          trigger: { kind: "resolution" },
        },
        clock: rig.clock,
      }),
    ).rejects.toThrow(/market_not_found/);
  });

  it("rejects invalid trigger specs", async () => {
    const rig = timeRig(START);
    const hunch = new MockHunchApi({
      catalogue: fixtureCatalogue(),
      readAt: FROZEN_NOW,
    });
    const service = createWatchService({ hunch, sleeper: rig.sleeper });
    await expect(
      service.handle({
        order: fakeOrder(),
        requirements: "",
        input: {
          marketSlug: "ansem-flip-pump-dec-31-2026",
          trigger: { kind: "oddsCross", threshold: 1.5 },
        },
        clock: rig.clock,
      }),
    ).rejects.toThrow(/invalid watch input/);
  });
});
