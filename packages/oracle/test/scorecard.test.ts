import { describe, it, expect } from "vitest";
import { createScorecardService } from "../src/core/services/scorecard.js";
import { createMockLedger } from "../src/adapters/mock/ledger.js";
import type { LedgerStore } from "../src/ports/ledger.js";
import type { ForecastRecordDraft } from "../src/core/track-record/entry.js";
import type { CapOrder } from "../src/ports/cap.js";
import type { Clock } from "../src/ports/runtime.js";

const clock: Clock = { now: () => new Date("2026-08-02T00:00:00.000Z") };
const order = { orderId: "ord_read", serviceId: "svc_scorecard" } as CapOrder;

function ctx() {
  return { order, requirements: "", input: null, clock };
}

function draft(orderId: string, prob: number, resolved: boolean | null): ForecastRecordDraft {
  return {
    orderId,
    txHash: null,
    recordedAt: "2026-07-06T00:00:00.000Z",
    question: `q-${orderId}`,
    marketId: `mkt-${orderId}`,
    marketSlug: `slug-${orderId}`,
    marketUrl: "https://www.playhunch.xyz/m/x",
    predictedOutcomeKey: "yes",
    probability: prob,
    confidence: "high",
    deadlineAt: "2026-07-31T00:00:00.000Z",
    resolution:
      resolved === null
        ? null
        : {
            outcomeKey: resolved ? "yes" : "no",
            hit: resolved,
            resolvedAt: "2026-07-31T12:00:00.000Z",
            proofUrl: null,
            settledAt: "2026-08-01T00:00:00.000Z",
          },
  };
}

async function seed(ledger: LedgerStore) {
  await ledger.append(draft("A", 0.7, null)); // pending entry for A
  await ledger.append(draft("A", 0.7, true)); // then settled (hit) — latest wins
  await ledger.append(draft("B", 0.2, false)); // resolved miss
  await ledger.append(draft("C", 0.5, null)); // still pending
}

describe("scorecard service", () => {
  it("returns zeros and a null head for an empty ledger", async () => {
    const svc = createScorecardService(createMockLedger());
    const out = await svc.handle(ctx());
    expect(out).toMatchObject({
      service: "scorecard",
      status: "ok",
      headHash: null,
      recent: [],
    });
    expect(out.rollup).toMatchObject({ total: 0, resolved: 0, meanBrier: 0 });
  });

  it("summarizes the ledger, counting each order once by its latest entry", async () => {
    const ledger = createMockLedger();
    await seed(ledger);
    const out = await svc(ledger).handle(ctx());
    expect(out.rollup).toMatchObject({
      total: 3, // A, B, C — not 4 entries
      resolved: 2, // A (hit), B (miss)
      pending: 1, // C
      hits: 1,
    });
    expect(out.headHash).toBe(await ledger.head());
    // A appears as its settled entry, not the superseded pending one.
    const recent = out.recent as Array<Record<string, unknown>>;
    const a = recent.find((r) => r.orderId === "A");
    expect((a?.resolution as Record<string, unknown> | null)?.hit).toBe(true);
    expect(recent.some((r) => r.entryHash)).toBe(true);
  });

  it("is deterministic — identical output for the same ledger snapshot", async () => {
    const ledger = createMockLedger();
    await seed(ledger);
    const s = svc(ledger);
    expect(await s.handle(ctx())).toEqual(await s.handle(ctx()));
  });

  it("caps recent entries at the limit", async () => {
    const ledger = createMockLedger();
    for (let i = 0; i < 30; i++) await ledger.append(draft(`ord-${i}`, 0.5, null));
    const out = await createScorecardService(ledger, { recentLimit: 5 }).handle(ctx());
    expect((out.recent as unknown[]).length).toBe(5);
  });
});

function svc(ledger: LedgerStore) {
  return createScorecardService(ledger);
}
