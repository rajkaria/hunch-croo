import { existsSync, readFileSync } from "node:fs";

/**
 * Read-only viewer for the forecast track-record ledger (S11). The authoritative
 * recording + scoring lives in `@hunch/oracle` (the `scorecard` CAP service);
 * this mirrors its rollup so the public page can render from the same append-only
 * JSONL file. If ORACLE_LEDGER_PATH is unset or missing, everything renders as an
 * honest empty state — never a fabricated number.
 */

export interface LedgerResolution {
  outcomeKey: string;
  hit: boolean;
  resolvedAt: string;
  proofUrl: string | null;
  settledAt: string;
}

export interface LedgerEntry {
  seq: number;
  orderId: string;
  txHash: string | null;
  recordedAt: string;
  question: string;
  marketId: string;
  marketSlug: string;
  marketUrl: string;
  predictedOutcomeKey: string;
  probability: number;
  confidence: string;
  deadlineAt: string;
  resolution: LedgerResolution | null;
  prevHash: string | null;
  entryHash: string;
}

export interface CalibrationBin {
  lo: number;
  hi: number;
  n: number;
  predictedMean: number;
  observedRate: number;
}

export interface Scorecard {
  total: number;
  resolved: number;
  pending: number;
  hits: number;
  hitRate: number;
  meanBrier: number;
  meanLogLoss: number;
  calibration: CalibrationBin[];
  headHash: string | null;
  recent: LedgerEntry[];
}

const EPS = 1e-6;

export function readLedger(): LedgerEntry[] {
  const path = process.env.ORACLE_LEDGER_PATH;
  if (!path || !existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as LedgerEntry);
  } catch {
    return [];
  }
}

/** Latest entry per order (settlement appends a new linked record). */
function latestByOrder(records: LedgerEntry[]): LedgerEntry[] {
  const latest = new Map<string, LedgerEntry>();
  for (const r of records) {
    const prev = latest.get(r.orderId);
    if (!prev || r.seq >= prev.seq) latest.set(r.orderId, r);
  }
  return [...latest.values()];
}

export function computeScorecard(records: LedgerEntry[], bins = 10): Scorecard {
  const active = latestByOrder(records);
  const resolved = active.filter((r) => r.resolution !== null);
  const hits = resolved.filter((r) => r.resolution!.hit).length;
  const n = resolved.length;

  const meanBrier = n
    ? resolved.reduce((a, r) => a + (r.probability - (r.resolution!.hit ? 1 : 0)) ** 2, 0) / n
    : 0;
  const meanLogLoss = n
    ? resolved.reduce((a, r) => {
        const p = Math.min(1 - EPS, Math.max(EPS, r.probability));
        return a + (r.resolution!.hit ? -Math.log(p) : -Math.log(1 - p));
      }, 0) / n
    : 0;

  const buckets = Array.from({ length: bins }, (_, i) => ({
    lo: i / bins,
    hi: (i + 1) / bins,
    probs: [] as number[],
    hits: 0,
  }));
  for (const r of resolved) {
    const idx = Math.min(bins - 1, Math.floor(r.probability * bins));
    buckets[idx]!.probs.push(r.probability);
    if (r.resolution!.hit) buckets[idx]!.hits += 1;
  }
  const calibration: CalibrationBin[] = buckets.map((b) => ({
    lo: b.lo,
    hi: b.hi,
    n: b.probs.length,
    predictedMean: b.probs.length ? b.probs.reduce((a, p) => a + p, 0) / b.probs.length : 0,
    observedRate: b.probs.length ? b.hits / b.probs.length : 0,
  }));

  const recent = [...active].sort((a, b) => b.seq - a.seq).slice(0, 25);
  return {
    total: active.length,
    resolved: n,
    pending: active.length - n,
    hits,
    hitRate: n ? hits / n : 0,
    meanBrier,
    meanLogLoss,
    calibration,
    headHash: records.at(-1)?.entryHash ?? null,
    recent,
  };
}
