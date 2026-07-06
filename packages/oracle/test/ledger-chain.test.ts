import { describe, it, expect } from "vitest";
import {
  linkRecord,
  verifyChain,
  computeEntryHash,
  type ForecastRecordDraft,
  type ForecastRecord,
} from "../src/core/track-record/entry.js";

function draft(overrides: Partial<ForecastRecordDraft> = {}): ForecastRecordDraft {
  return {
    orderId: "ord_1",
    txHash: "0xabc",
    recordedAt: "2026-07-06T00:00:00.000Z",
    question: "Will AIXBT flip ANSEM by 2026?",
    marketId: "mkt_1",
    marketSlug: "aixbt-flip-ansem",
    marketUrl: "https://www.playhunch.xyz/m/aixbt-flip-ansem",
    predictedOutcomeKey: "yes",
    probability: 0.62,
    confidence: "high",
    deadlineAt: "2026-12-31T00:00:00.000Z",
    resolution: null,
    ...overrides,
  };
}

describe("forecast ledger hash chain", () => {
  it("links a genesis record with prevHash null and a deterministic hash", () => {
    const a = linkRecord(draft(), 0, null);
    const b = linkRecord(draft(), 0, null);
    expect(a.seq).toBe(0);
    expect(a.prevHash).toBeNull();
    expect(a.entryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.entryHash).toBe(b.entryHash); // deterministic
  });

  it("chains entries so each entryHash covers the previous hash", () => {
    const g = linkRecord(draft({ orderId: "ord_1" }), 0, null);
    const h = linkRecord(draft({ orderId: "ord_2" }), 1, g.entryHash);
    expect(h.prevHash).toBe(g.entryHash);
    expect(verifyChain([g, h])).toEqual({ ok: true, brokenAt: null });
  });

  it("detects a mutated entry (tamper-evidence)", () => {
    const g = linkRecord(draft({ orderId: "ord_1" }), 0, null);
    const h = linkRecord(draft({ orderId: "ord_2" }), 1, g.entryHash);
    // Attacker rewrites the probability of the first record without re-hashing.
    const tampered: ForecastRecord = { ...g, probability: 0.99 };
    expect(verifyChain([tampered, h])).toEqual({ ok: false, brokenAt: 0 });
  });

  it("detects a broken link (reordered / spliced chain)", () => {
    const g = linkRecord(draft({ orderId: "ord_1" }), 0, null);
    const h = linkRecord(draft({ orderId: "ord_2" }), 1, g.entryHash);
    // h re-pointed at a wrong prevHash breaks the link even if its own body hashes.
    const spliced = linkRecord(draft({ orderId: "ord_2" }), 1, "deadbeef");
    expect(verifyChain([g, spliced]).ok).toBe(false);
    expect(verifyChain([g, h]).ok).toBe(true);
  });

  it("computeEntryHash ignores the entryHash field itself", () => {
    const g = linkRecord(draft(), 0, null);
    const recomputed = computeEntryHash({ ...g });
    expect(recomputed).toBe(g.entryHash);
  });

  it("empty chain verifies", () => {
    expect(verifyChain([])).toEqual({ ok: true, brokenAt: null });
  });
});
