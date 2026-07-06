import type { LedgerStore } from "../../ports/ledger.js";
import {
  linkRecord,
  type ForecastRecord,
  type ForecastRecordDraft,
} from "../../core/track-record/entry.js";

/**
 * In-memory ledger — deterministic, credential-free, drives the test suite.
 * Same chaining rules as the fs adapter, so their head hashes agree line-for-line.
 */
export function createMockLedger(): LedgerStore {
  const records: ForecastRecord[] = [];
  return {
    async append(draft: ForecastRecordDraft): Promise<ForecastRecord> {
      const prevHash = records.at(-1)?.entryHash ?? null;
      const record = linkRecord(draft, records.length, prevHash);
      records.push(record);
      return record;
    },
    async list(): Promise<ForecastRecord[]> {
      return records.map((r) => ({ ...r }));
    },
    async head(): Promise<string | null> {
      return records.at(-1)?.entryHash ?? null;
    },
  };
}
