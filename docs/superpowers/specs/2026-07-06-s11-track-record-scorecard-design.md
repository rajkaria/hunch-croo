# S11 — Track-Record Scorecard ("The desk you can audit")

**Status:** approved design · **Date:** 2026-07-06 · **Sprint:** S11

Part of the S11→S14 roadmap (track-record → observability → portfolio hedge →
Python SDK). S11 is the foundation: it introduces the first persistence layer in
the codebase — a tamper-evident forecast ledger that the later sprints read.

## The problem it kills

The desk *sells* calibrated probabilities (`forecast`) and *verifies* ground
truth (`verify`), but it never scores itself. A buyer has to take "calibrated"
on faith. S11 makes the oracle **auditable**: every forecast it sells is
recorded, later scored against what actually happened, and the aggregate
accuracy is published and tamper-evident. "Don't trust, verify" — turned on the
oracle itself.

## Scope

In scope:
- Record every delivered, resolvable `forecast` as an immutable ledger entry.
- A hash-chained, append-only ledger (tamper-evident; publishable head hash).
- Deterministic scoring: Brier score, log-loss (clamped), 10-bucket calibration
  table, aggregate rollups.
- A `settle` step that scores a recorded forecast **only once its market has
  actually resolved** (via the existing `HunchApi.result`).
- A read-only `scorecard` CAP service returning the public track record.
- A `settle` sweep in the worker + a `smoke:scorecard` demo.
- A public web scorecard page (reliability diagram + Brier over time + head hash).
- `docs/SCORECARD.md` + README section.

Out of scope (later sprints): Prometheus metrics / revenue analytics (S12),
portfolio hedge (S13), Python SDK (S14). No scoring of `verify`/`sentiment`
outputs in S11 — only `forecast` (the flagship, and the only service that emits
a probability against a resolvable market).

## Architecture

Fits the existing `ports` / `adapters` / `core` split. No new runtime deps —
the hash chain uses `node:crypto` `sha256` (dependency-free and honest; this is
*our* ledger tamper-evidence, distinct from the keccak256 content hash CAP
writes on-chain for deliverables).

### New port — `ports/ledger.ts`

```ts
export interface LedgerStore {
  append(record: ForecastRecord): Promise<void>; // must reject on hash-chain break
  list(): Promise<ForecastRecord[]>;              // insertion order
  head(): Promise<string | null>;                 // last entryHash, or null if empty
}
```

Core depends only on this interface.

### New core — `core/track-record/`

**`entry.ts`** — the record shape + hash-chained construction.

```ts
export interface ForecastRecord {
  // identity
  seq: number;                 // 0-based position in the chain
  orderId: string;             // CAP order that paid for this forecast
  txHash: string | null;       // on-chain delivery tx (audit link), if any
  recordedAt: string;          // ISO, from the injected clock
  // the prediction (a binary claim: "resolvedOutcome === predictedOutcomeKey")
  question: string;
  marketId: string;
  marketSlug: string;
  marketUrl: string;
  predictedOutcomeKey: string; // "yes" for YES/NO; top ladder key otherwise
  probability: number;         // desk's P(predictedOutcomeKey), 0..1
  confidence: string;          // forecast confidence bucket (provenance)
  deadlineAt: string;          // market deadline (settle can't score before this)
  // resolution (filled in by settle; null until then)
  resolution: {
    outcomeKey: string;        // actual resolvedOutcome
    hit: boolean;              // outcomeKey === predictedOutcomeKey
    resolvedAt: string;
    proofUrl: string | null;
    settledAt: string;         // ISO, when we scored it
  } | null;
  // tamper-evidence
  prevHash: string | null;     // entryHash of the previous record (chain link)
  entryHash: string;           // sha256(stableStringify(record sans entryHash))
}
```

- `entryHash = sha256Hex(stableStringify({...record, entryHash: undefined}))`.
  Including `prevHash` inside the hashed body is what chains entries.
- `hashRecord(draft, prevHash)` and `verifyChain(records)` are pure helpers.
- A settled entry is a **new appended record** referencing the same `orderId`
  (the ledger is append-only; we never mutate a prior line). The active record
  for an order is its latest entry. This keeps the chain immutable and the JSONL
  strictly append-only.

**`scoring.ts`** — pure, deterministic, golden-tested.
- `brier(prob, hit)` = `(prob - (hit ? 1 : 0))^2`.
- `logLoss(prob, hit)` with clamp `p ∈ [1e-6, 1-1e-6]` (no ±∞).
- `calibrationTable(entries, bins=10)` → per-bucket `{ lo, hi, n, predictedMean,
  observedRate }` over **resolved** entries only.
- `rollup(entries)` → `{ total, resolved, pending, hits, meanBrier, meanLogLoss,
  hitRate, calibration }`. Empty/all-pending → zeros + empty calibration, never
  NaN.

**`settle.ts`** — decide what to score, given the ledger + a resolver.
- `pendingOrders(records)` → latest-per-order entries whose `resolution` is null.
- `settleRecord(record, result, clock)` → a new settled `ForecastRecord` draft
  **only if** `result.status === "resolved" || result.resolvedOutcome`; else
  `null` (still pending — never inflates the numbers). `hit =
  result.resolvedOutcome === record.predictedOutcomeKey`.

**`record-from-forecast.ts`** — typed extraction so the loop stays thin.
- `extractForecastRecord(payload, order, txHash, clock)` → `ForecastRecordDraft |
  null`. Returns a draft **only** when `payload.service === "forecast" &&
  payload.status === "ok"` and the market is resolvable (has `marketId` +
  `deadlineAt`). `predictedOutcomeKey`: `"yes"` for YES/NO; otherwise the
  top-priced ladder outcome key already present in the payload. Anything else →
  `null` (nothing recorded). Unit-testable without the loop.

### New adapters

- `adapters/mock/ledger.ts` — in-memory `LedgerStore` (drives tests). Recomputes
  the chain on append; rejects a mismatched `prevHash`.
- `adapters/fs/ledger.ts` — append-only JSONL at `ORACLE_LEDGER_PATH`. On
  `append`, reads current head, links, `appendFileSync` one line (crash-safe:
  append-only, never rewrites). `list()` parses the file; `head()` returns the
  last line's `entryHash`. Matches the "append-only, source of truth on disk"
  ethos.

### Wiring — provider loop records after confirmed delivery

The loop gains an **optional** `ledger?: LedgerStore` dep and an injected
`clock` it already has. Immediately after a forecast delivery is confirmed
(`this.delivered.add(orderId)` with a real `txHash`), it:
1. calls `extractForecastRecord(payload, order, txHash, clock)`;
2. if non-null, `await ledger.append(draft)` **inside a try/catch that only
   logs** on failure.

**Recording is advisory: a ledger failure MUST NOT fail a paid delivery.** The
money already moved and CAP already has the deliverable; the ledger is a
side-record. This keeps the money path clean (same spirit as "an LLM is never in
a money path"). The loop keeps a per-process `recorded` set so a re-delivery
(already-completed path) never double-records.

### New service — `core/services/scorecard.ts`

A read-only CAP service (`scorecard`). No input, no money path. Returns:
`{ service, status:"ok", rollup, recent: [...last N entries with hashes],
headHash, asOf }`. Deterministic given the ledger snapshot. Powers both agent
buyers and the web page. Registered in `HANDLERS` under `scorecard`.

### New worker step — the settle sweep

In `worker/main.ts`, when a ledger is configured, a second interval
(`ORACLE_SETTLE_INTERVAL_MS`, default 5 min) runs `runSettleSweep({ ledger,
hunch, clock, logger })`:
- read pending orders from the ledger;
- for each, `hunch.result(marketId)` (fail-soft per-market: a throw/404 is logged
  and skipped, retried next sweep);
- `settleRecord(...)`; if non-null, `ledger.append(settled)`.
Extracted as a pure-ish `core/track-record/settle-sweep.ts` (deps injected) so
it's testable without timers. A `smoke:scorecard` script demonstrates the full
loop credential-free (mock hunch scripted `pending → resolved`).

### Web — `apps/web/src/app/scorecard/page.tsx`

Public page: reliability diagram (predicted vs observed per calibration bin),
Brier/hit-rate headline, resolved/pending counts, and the ledger head hash
(so anyone can pin the record). Reads via the same rollup logic (server
component reading the ledger file, mirroring how `dashboard` reads today).

## Data flow

```
forecast delivered ─(loop, post-deliver, advisory)─▶ ledger.append(record{prob, marketId,
                                                       predictedOutcomeKey, prevHash, entryHash})
market resolves on playhunch ─(settle sweep)─▶ hunch.result → settleRecord → ledger.append(settled)
scorecard service / web ◀─ rollup(ledger.list()) ─ Brier, log-loss, calibration, headHash
```

## Honesty & safety invariants (consistent with the repo)

- **Never fabricates accuracy** — only *resolved* markets are scored; pending
  ones are counted separately and never enter Brier/calibration.
- **Tamper-evident** — sha256 hash chain; head hash published. Rewriting any
  past entry breaks `verifyChain`.
- **Advisory recording** — a ledger write failure never breaks a paid delivery.
- **Deterministic scoring** — no LLM, pure functions, golden fixtures.
- **Fail-soft settle** — a per-market resolver failure is logged and retried on
  the next sweep; it never crashes the loop.
- **Append-only** — settlement appends a new linked record; prior lines are
  never mutated.

## Testing

- `track-record/scoring.test.ts` — golden Brier / log-loss / calibration on
  fixed inputs; edge cases (prob 0/1 clamp, empty, all-pending → no NaN).
- `track-record/ledger-chain.test.ts` — chain verifies; a mutated entry breaks
  `verifyChain`; mock + fs adapters agree on head hash for the same sequence.
- `track-record/settle.test.ts` — scores only when resolved; `pending → pending
  → resolved` sequence via `resultSequences`; hit vs miss; ladder outcome key.
- `track-record/record-from-forecast.test.ts` — extracts from a `forecast/ok`
  payload; returns null for `no_market`, `verify`, `sentiment`, malformed.
- `provider-loop.test.ts` (extended) — a delivered forecast appends exactly one
  record with the right `txHash`; a **ledger `append` that throws does NOT fail
  the delivery** (stats.ordersDelivered still increments); re-delivery does not
  double-record; a non-forecast delivery records nothing.
- `scorecard.test.ts` — rollup shape + determinism + head hash echo.
- `settle-sweep.test.ts` — sweeps pending, scores resolved, skips + survives a
  per-market resolver throw.

All credential-free, mock-driven, matching the existing suite. `pnpm gate` stays
green.

## Config additions (`config.ts` + `.env.example`)

- `ORACLE_LEDGER_PATH` (optional) — enables the fs ledger + scorecard + settle
  sweep. Unset → desk behaves exactly as today (no recording); this makes S11
  strictly additive and safe to ship dark.
- `ORACLE_SETTLE_INTERVAL_MS` (default 300000).

## File manifest

New:
- `packages/oracle/src/ports/ledger.ts`
- `packages/oracle/src/core/track-record/{entry,scoring,settle,record-from-forecast,settle-sweep}.ts`
- `packages/oracle/src/core/services/scorecard.ts`
- `packages/oracle/src/adapters/mock/ledger.ts`
- `packages/oracle/src/adapters/fs/ledger.ts`
- `packages/oracle/src/worker/smoke-scorecard.ts`
- `packages/oracle/test/{scoring,ledger-chain,settle,record-from-forecast,scorecard,settle-sweep}.test.ts`
- `apps/web/src/app/scorecard/page.tsx`
- `docs/SCORECARD.md`

Modified:
- `packages/oracle/src/core/provider-loop.ts` (advisory ledger hook)
- `packages/oracle/src/worker/main.ts` (wire ledger + settle sweep + scorecard)
- `packages/oracle/src/config.ts`, `.env.example`, `package.json` (smoke script)
- `packages/oracle/test/provider-loop.test.ts` (recording assertions)
- `README.md` (scorecard section)
```
