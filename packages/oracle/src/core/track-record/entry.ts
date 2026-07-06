import { createHash } from "node:crypto";
import { stableStringify } from "../stable-json.js";

/**
 * The forecast ledger record + its tamper-evident hash chain.
 *
 * Every forecast the desk sells is recorded here so the oracle can be *audited*,
 * not merely trusted. Entries are append-only and hash-chained: each entryHash
 * covers the record body *and* the previous entry's hash, so rewriting any past
 * line breaks every hash after it (see `verifyChain`). The head hash is
 * publishable — a caller can pin it and later prove the record wasn't edited.
 *
 * This is our own ledger integrity (sha256, dependency-free), distinct from the
 * keccak256 content hash CAP writes on-chain for the deliverable itself.
 */

/** How a forecast resolved, filled in by the settle step (null until then). */
export interface ForecastResolution {
  /** The market's actual resolved outcome key. */
  outcomeKey: string;
  /** outcomeKey === predictedOutcomeKey — was the desk's call right? */
  hit: boolean;
  /** Upstream-reported resolution time. */
  resolvedAt: string;
  /** Proof link from the resolver, when present. */
  proofUrl: string | null;
  /** When we scored it (our clock). */
  settledAt: string;
}

/**
 * The content of a ledger record, before it is linked into the chain. Callers
 * (the provider loop, the settle step) build drafts; the LedgerStore assigns
 * `seq`/`prevHash` and computes `entryHash`.
 */
export interface ForecastRecordDraft {
  /** CAP order that paid for this forecast. */
  orderId: string;
  /** On-chain delivery tx hash (audit link), if the delivery reported one. */
  txHash: string | null;
  /** When the forecast was recorded (our clock). */
  recordedAt: string;
  question: string;
  marketId: string;
  marketSlug: string;
  marketUrl: string;
  /**
   * The binary claim being scored: "the market's resolvedOutcome will equal
   * predictedOutcomeKey". "yes" for YES/NO markets; the top ladder outcome key
   * otherwise.
   */
  predictedOutcomeKey: string;
  /** The desk's probability for predictedOutcomeKey, in [0, 1]. */
  probability: number;
  /** Forecast confidence bucket, carried for provenance. */
  confidence: string;
  /** Market deadline — settle cannot score before the market resolves. */
  deadlineAt: string;
  /** Resolution, once scored; null while pending. */
  resolution: ForecastResolution | null;
}

/** A draft linked into the chain: content + position + tamper-evident hash. */
export interface ForecastRecord extends ForecastRecordDraft {
  /** 0-based position in the append-only chain. */
  seq: number;
  /** entryHash of the previous record (null for genesis). */
  prevHash: string | null;
  /** sha256 over the stable-serialized record body (everything but this field). */
  entryHash: string;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Deterministic hash of a record's body — everything except `entryHash` itself.
 * Because the body includes `seq` and `prevHash`, the hash binds both the
 * content and the record's place in the chain.
 */
export function computeEntryHash(
  record: Omit<ForecastRecord, "entryHash"> & { entryHash?: string },
): string {
  const { entryHash: _ignored, ...body } = record;
  return sha256Hex(stableStringify(body));
}

/** Link a draft into the chain at `seq`, chaining off `prevHash`. */
export function linkRecord(
  draft: ForecastRecordDraft,
  seq: number,
  prevHash: string | null,
): ForecastRecord {
  const body: Omit<ForecastRecord, "entryHash"> = { ...draft, seq, prevHash };
  return { ...body, entryHash: computeEntryHash(body) };
}

/**
 * Reduce the append-only chain to the *active* record per order: its latest
 * entry (highest seq). Settlement appends a new linked record for an order, so
 * the same orderId can appear twice (pending, then settled); consumers score
 * the latest. Insertion order of first-seen orders is preserved.
 */
export function latestByOrder(records: ForecastRecord[]): ForecastRecord[] {
  const latest = new Map<string, ForecastRecord>();
  for (const r of records) {
    const prev = latest.get(r.orderId);
    if (!prev || r.seq >= prev.seq) latest.set(r.orderId, r);
  }
  return [...latest.values()];
}

/**
 * Verify the whole chain: every entry's hash recomputes, and every prevHash
 * matches the actual previous entryHash. Returns the 0-based index of the first
 * broken link, or null when intact.
 */
export function verifyChain(
  records: ForecastRecord[],
): { ok: boolean; brokenAt: number | null } {
  let prev: string | null = null;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    if (rec.prevHash !== prev) return { ok: false, brokenAt: i };
    if (computeEntryHash(rec) !== rec.entryHash) return { ok: false, brokenAt: i };
    prev = rec.entryHash;
  }
  return { ok: true, brokenAt: null };
}
