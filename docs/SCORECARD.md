# scorecard — the desk you can audit (S11)

The desk sells calibrated probabilities (`forecast`) and verifies ground truth
(`verify`). S11 closes the loop: it **records every forecast it sells** and
**scores each one against the market's real resolution**, then publishes the
aggregate as a public, tamper-evident track record. "Don't trust, verify" —
turned on the oracle itself.

An LLM can *claim* calibration. This desk lets you check it.

## What gets recorded

Every delivered `forecast` (and only `forecast` — the flagship, the one service
that emits a probability against a resolvable market) is appended to an
**append-only, hash-chained ledger** the moment its CAP delivery is confirmed:

```
{ orderId, txHash,                       // the paid order + its on-chain delivery
  question, marketId, marketSlug,        // what was asked, which market answered it
  predictedOutcomeKey, probability,      // the binary claim + the desk's P(it)
  confidence, deadlineAt, recordedAt,
  resolution: null,                      // filled in later, once the market resolves
  seq, prevHash, entryHash }             // the tamper-evident chain link
```

The claim is deliberately **binary** — "the market's `resolvedOutcome` will equal
`predictedOutcomeKey`" — so Brier and log-loss are unambiguous:

- **YES/NO market:** `predictedOutcomeKey = "yes"`, `probability` = the desk's
  P(yes). We sell a YES probability, so we score a YES probability — even a low
  one.
- **Ladder market:** `predictedOutcomeKey` = the top-priced outcome,
  `probability` = its implied price.

Recording is **advisory**: a ledger write can never fail a paid delivery. The
money already moved and CAP already holds the deliverable — the ledger is a
side-record, kept strictly outside the money path (the same discipline as "an
LLM is never in a money path").

## How it's scored

A periodic **settle sweep** reads each pending forecast's market via the same
production resolver `verify`/`watch` use (`GET /api/partner/result`). A forecast
is scored **only once its market has actually resolved to a concrete outcome** —
anything still open, or resolved to no outcome (a voided/refunded market), stays
pending and never enters the numbers. Settlement appends a *new* linked record
(the ledger is append-only); the active record for an order is its latest entry.

Scoring is pure, deterministic arithmetic — no model, no LLM:

```
brier   = (probability − outcome)²                 # 0 = perfect, 0.25 = coin-flip
logLoss = −ln(p)  if hit,  −ln(1−p)  otherwise      # p clamped to [1e-6, 1−1e-6]
calibration: 10 buckets over [0,1] → predictedMean vs observedRate per bucket
```

A well-calibrated desk has `predictedMean ≈ observedRate` in every populated
bucket. Only resolved forecasts count toward Brier and calibration.

## Tamper-evidence

The ledger is a sha256 hash chain: `entryHash = sha256(stableStringify(record))`
where the hashed body includes `seq` and `prevHash`. Rewriting any past line
breaks that line's hash and every hash after it — caught by `verifyChain`. The
`scorecard` service publishes the **head hash**; pin it, re-request the scorecard
later, and the head still covers this exact history — or the chain is broken.
(This is *our* ledger integrity, distinct from the keccak256 content hash CAP
writes on-chain for each deliverable.)

## The `scorecard` service

Read-only, no input, no money path. Returns the full rollup, the recent entries
with their hashes, and the head hash:

```json
{
  "service": "scorecard",
  "status": "ok",
  "rollup": {
    "total": 6, "resolved": 5, "pending": 1, "hits": 2, "hitRate": 0.4,
    "meanBrier": 0.1238, "meanLogLoss": 0.4038,
    "calibration": [{ "lo": 0.7, "hi": 0.8, "n": 1, "predictedMean": 0.71, "observedRate": 1 }, ...]
  },
  "recent": [{ "orderId": "...", "probability": 0.82, "resolution": { "hit": true, ... }, "entryHash": "..." }],
  "headHash": "50d2e564…b4ab"
}
```

`hitRate` is the share of resolved forecasts whose called outcome occurred —
meaningful for multi-outcome markets; for a YES/NO market it's simply how often
YES resolved. **Brier and calibration are the quality metrics** — `hitRate` is a
base rate, not an accuracy score.

## Configuration

The track record is **opt-in and strictly additive**. Unset → the desk behaves
exactly as before (no recording, no `scorecard` service, no settle sweep).

```bash
ORACLE_LEDGER_PATH=./data/track-record.jsonl   # enables recording + scorecard + settle sweep
ORACLE_SETTLE_INTERVAL_MS=300000               # how often to score resolved markets (default 5 min)
```

## Try it — credential-free

```bash
pnpm --filter @hunch/oracle smoke:scorecard
```

Drives the **real provider loop**: sells a book of forecasts (recorded to the
ledger), settles the ones whose markets have resolved, then prints the scorecard
— Brier, calibration, and the tamper-evident head hash — asserting the chain is
intact. The public page lives at `/scorecard`.

## Safety invariants

- **Never fabricates accuracy** — only resolved markets are scored; pending ones
  are listed but never enter Brier or calibration.
- **Tamper-evident** — sha256 hash chain; the head hash is published.
- **Advisory recording** — a ledger failure never breaks a paid delivery.
- **Deterministic scoring** — no LLM, pure functions, golden-tested.
- **Fail-soft settle** — a per-market resolver outage is logged and retried next
  sweep; it never crashes the loop.
- **Append-only** — settlement adds a new linked record; prior lines are never
  mutated.
