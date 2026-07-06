---
feature: Track-record scorecard (S11)
globs:
  - packages/oracle/src/core/track-record/**
  - packages/oracle/src/ports/ledger.ts
  - packages/oracle/src/adapters/mock/ledger.ts
  - packages/oracle/src/adapters/fs/ledger.ts
  - packages/oracle/src/core/services/scorecard.ts
  - packages/oracle/src/worker/smoke-scorecard.ts
  - apps/web/src/app/scorecard/**
  - apps/web/src/lib/scorecard.ts
  - docs/SCORECARD.md
  - packages/oracle/test/{scoring,ledger-chain,ledger-store,settle,settle-sweep,record-from-forecast,scorecard,provider-loop-recording}.test.ts
updated: 2026-07-06
---

# Track-record scorecard (S11)

Makes the Hunch Oracle Desk **auditable**: every `forecast` it sells is recorded
to an append-only, hash-chained ledger and later scored against the market's real
resolution (Brier, log-loss, calibration). The `scorecard` CAP service + `/scorecard`
web page publish the aggregate + a pinnable head hash. Design spec:
`docs/superpowers/specs/2026-07-06-s11-track-record-scorecard-design.md`.

## Current state — what's working, deployed, broken
- **Complete and committed** (`81d25d3`; spec `4c17c17`). `pnpm gate` green: 201 tests
  (49 new, 23 files), typecheck clean across oracle + web + client.
- Smoke verified end-to-end through the **real provider loop** (`smoke:scorecard`):
  6 recorded → 5 settled → Brier 0.1238, chain intact.
- `/scorecard` web page render-verified (HTTP 200; web viewer's Brier matched the core
  exactly — no logic drift).
- **Opt-in**: everything is gated on `ORACLE_LEDGER_PATH`. Unset → desk behaves exactly
  as before S11 (no recording, no scorecard service, no settle sweep). Nothing runs
  against real CROO/Hunch creds yet — only mock-driven verification.

## Recent changes — files touched and why
New (core, pure + golden-tested):
- `core/track-record/entry.ts` — `ForecastRecord(Draft)`, `linkRecord`, `computeEntryHash`,
  `verifyChain`, `latestByOrder`. sha256 hash chain (node:crypto, dep-free).
- `core/track-record/scoring.ts` — `brier`, `logLoss` (clamped 1e-6), `calibrationTable`
  (10 bins), `rollup`. Dedups to latest-per-order; resolved-only.
- `core/track-record/settle.ts` — `settleRecord` (scores only concrete resolution;
  void/open → null), `pendingOrders`.
- `core/track-record/settle-sweep.ts` — `runSettleSweep` (fail-soft per market).
- `core/track-record/record-from-forecast.ts` — `extractForecastRecord`: binary-claim
  extraction. YES/NO → key "yes" at P(yes); ladder → argmax(odds) key.
- `ports/ledger.ts` — `LedgerStore` (append links+persists+returns; list; head).
- `adapters/mock/ledger.ts` (in-memory) + `adapters/fs/ledger.ts` (append-only JSONL).
- `core/services/scorecard.ts` — read-only service: rollup + recent + headHash.
- `worker/smoke-scorecard.ts` + `package.json` `smoke:scorecard`.
- `apps/web/src/lib/scorecard.ts` (self-contained JSONL reader + rollup) +
  `apps/web/src/app/scorecard/page.tsx`; nav link in `layout.tsx`.
- `docs/SCORECARD.md`; README services-row + "The desk you can audit" section.

Modified:
- `core/provider-loop.ts` — optional `ledger` dep + `recorded` set + private `record()`
  called AFTER confirmed delivery. **Advisory**: try/catch log-only, never fails a delivery.
- `worker/main.ts` — build fs ledger when path set, register `scorecard`, pass ledger to
  loop, add settle-sweep interval (`ORACLE_SETTLE_INTERVAL_MS`, cleaned up on shutdown).
- `config.ts` + `.env.example` — `ORACLE_LEDGER_PATH` (optional), `ORACLE_SETTLE_INTERVAL_MS`
  (default 300000).

## Key decisions — choices and trade-offs
- **Binary claim framing** ("resolvedOutcome === predictedOutcomeKey") so Brier/log-loss
  are unambiguous for YES/NO *and* ladder. For YES/NO the desk always sells P(yes); a low
  P(yes) that resolves NO is a *good* forecast but a "miss" — so **Brier + calibration are
  the quality metrics**, `hitRate` is a base rate (labeled as such everywhere).
- **sha256 (node:crypto), not keccak256** — this is *our* ledger integrity, distinct from
  the keccak256 content hash CAP writes on-chain. Dep-free and honest.
- **Advisory recording** — a ledger write NEVER fails a paid delivery (money path clean).
  Cross-restart duplicate pending lines are harmless: `latestByOrder` dedups by order.
- **Append-only** — settlement appends a *new* linked record; prior lines never mutated.
- **Store owns the chain** — `append(draft)` assigns seq/prevHash/entryHash (callers hand
  content drafts). `ports/ledger.ts` imports record types from core (minor, pragmatic).
- **Web viewer is self-contained** (mirrors core rollup) to avoid coupling/build config;
  verified no drift. If it ever drifts, that's the seam to consolidate.
- **Only `forecast` is recorded** (not verify/sentiment) — the only service emitting a
  probability against a resolvable market.

## Next steps — specific, actionable
- **S12 — Observability & metrics** (next sprint): Prometheus `/metrics` on the existing
  health server + per-service/revenue analytics. Reads THIS ledger (`LedgerStore.list()` +
  `rollup`) plus `ProviderLoop.stats`/`health()`. Design against those.
- **S13 — Portfolio hedge**; **S14 — Python client SDK** (mirror node kit incl. scorecard).
- Optional polish: expose the scorecard rollup over the `ORACLE_HEALTH_PORT` JSON server
  so the web page (and S12 metrics) can read it without file access in prod.
- Void/refunded markets stay `pending` forever (never scored) — acceptable for S11; revisit
  if a "void" resolution state is wanted.
