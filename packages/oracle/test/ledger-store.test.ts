import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockLedger } from "../src/adapters/mock/ledger.js";
import { createFsLedger } from "../src/adapters/fs/ledger.js";
import { verifyChain, type ForecastRecordDraft } from "../src/core/track-record/entry.js";
import type { LedgerStore } from "../src/ports/ledger.js";

function draft(orderId: string, prob = 0.5): ForecastRecordDraft {
  return {
    orderId,
    txHash: null,
    recordedAt: "2026-07-06T00:00:00.000Z",
    question: "q",
    marketId: "mkt_" + orderId,
    marketSlug: "slug-" + orderId,
    marketUrl: "https://www.playhunch.xyz/m/x",
    predictedOutcomeKey: "yes",
    probability: prob,
    confidence: "high",
    deadlineAt: "2026-12-31T00:00:00.000Z",
    resolution: null,
  };
}

const tmpDirs: string[] = [];
function tmpLedgerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "hunch-ledger-"));
  tmpDirs.push(dir);
  return join(dir, "ledger.jsonl");
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function appendAll(store: LedgerStore, drafts: ForecastRecordDraft[]) {
  for (const d of drafts) await store.append(d);
}

describe.each([
  ["mock", () => createMockLedger()],
  ["fs", () => createFsLedger(tmpLedgerPath())],
])("LedgerStore (%s)", (_name, make) => {
  it("starts empty", async () => {
    const store = make();
    expect(await store.list()).toEqual([]);
    expect(await store.head()).toBeNull();
  });

  it("links appended drafts into a verifiable chain", async () => {
    const store = make();
    await appendAll(store, [draft("A"), draft("B"), draft("C")]);
    const list = await store.list();
    expect(list.map((r) => r.orderId)).toEqual(["A", "B", "C"]);
    expect(list[0]!.seq).toBe(0);
    expect(list[0]!.prevHash).toBeNull();
    expect(list[1]!.prevHash).toBe(list[0]!.entryHash);
    expect(await store.head()).toBe(list[2]!.entryHash);
    expect(verifyChain(list)).toEqual({ ok: true, brokenAt: null });
  });

  it("append returns the linked record", async () => {
    const store = make();
    const rec = await store.append(draft("A"));
    expect(rec.seq).toBe(0);
    expect(rec.entryHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("mock and fs ledgers agree", () => {
  it("produce identical head hashes for the same sequence of drafts", async () => {
    const mock = createMockLedger();
    const fs = createFsLedger(tmpLedgerPath());
    const drafts = [draft("A", 0.7), draft("B", 0.2), draft("C", 0.9)];
    await appendAll(mock, drafts);
    await appendAll(fs, drafts);
    expect(await fs.head()).toBe(await mock.head());
  });
});

describe("fs ledger", () => {
  it("persists across instances and survives reopen", async () => {
    const path = tmpLedgerPath();
    await appendAll(createFsLedger(path), [draft("A"), draft("B")]);
    const reopened = createFsLedger(path);
    const list = await reopened.list();
    expect(list.map((r) => r.orderId)).toEqual(["A", "B"]);
    // A fresh append chains off the persisted head, not a reset genesis.
    const rec = await reopened.append(draft("C"));
    expect(rec.seq).toBe(2);
    expect(rec.prevHash).toBe(list[1]!.entryHash);
  });

  it("makes tampering with the file detectable via verifyChain", async () => {
    const path = tmpLedgerPath();
    const store = createFsLedger(path);
    await appendAll(store, [draft("A", 0.5), draft("B", 0.5)]);
    // Forge a line whose body doesn't match its entryHash.
    const forged = JSON.parse(readFileSync(path, "utf8").split("\n").filter(Boolean)[0]!);
    forged.probability = 0.99;
    appendFileSync(path, JSON.stringify(forged) + "\n");
    const list = await createFsLedger(path).list();
    expect(verifyChain(list).ok).toBe(false);
  });
});
