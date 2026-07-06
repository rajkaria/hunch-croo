import type {
  ForecastRecord,
  ForecastRecordDraft,
} from "../core/track-record/entry.js";

/**
 * Persistence port for the forecast track record. The store owns chain
 * integrity: callers hand it content drafts, and it assigns `seq`/`prevHash`
 * and computes the tamper-evident `entryHash` (via `linkRecord`). Append-only —
 * settlement adds a new linked record, it never rewrites a prior one.
 *
 * Adapters: `mock/ledger` (in-memory, drives the suite) and `fs/ledger`
 * (append-only JSONL on disk). Core depends only on this interface.
 */
export interface LedgerStore {
  /** Link a draft onto the head of the chain, persist it, and return it. */
  append(draft: ForecastRecordDraft): Promise<ForecastRecord>;
  /** All records in insertion order. */
  list(): Promise<ForecastRecord[]>;
  /** entryHash of the last record, or null when empty. */
  head(): Promise<string | null>;
}
