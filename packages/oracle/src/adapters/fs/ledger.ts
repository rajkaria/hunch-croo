import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LedgerStore } from "../../ports/ledger.js";
import {
  linkRecord,
  type ForecastRecord,
  type ForecastRecordDraft,
} from "../../core/track-record/entry.js";

/**
 * Append-only JSONL ledger on disk — one record per line, never rewritten.
 * Append-only + the hash chain is what makes the record crash-safe and
 * tamper-evident: a torn write leaves at most one bad trailing line (a fresh
 * append re-links off the last *good* head), and any edit to a past line is
 * caught by `verifyChain(list())`.
 *
 * Reads are O(file) — fine at desk volumes and dependency-free. If the record
 * ever needs to scale, this is the single seam to swap for a real store.
 */
export function createFsLedger(path: string): LedgerStore {
  function readAll(): ForecastRecord[] {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ForecastRecord);
  }

  return {
    async append(draft: ForecastRecordDraft): Promise<ForecastRecord> {
      const existing = readAll();
      const prevHash = existing.at(-1)?.entryHash ?? null;
      const record = linkRecord(draft, existing.length, prevHash);
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify(record) + "\n");
      return record;
    },
    async list(): Promise<ForecastRecord[]> {
      return readAll();
    },
    async head(): Promise<string | null> {
      return readAll().at(-1)?.entryHash ?? null;
    },
  };
}
