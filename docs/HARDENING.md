# Hardening & chaos — the desk survives a bad day (S10)

Real USDC escrow means "mostly works" isn't good enough. S10 is the sprint where
the provider loop is put through every failure mode we could think of and made to
recover cleanly — the exit bar is literally *`kill -9` the worker mid-order →
clean recovery, no double delivery, no stuck escrow*. Everything here is proven
by a credential-free chaos suite (`packages/oracle/test/chaos.test.ts`,
`fuzz.test.ts`, `retry.test.ts`, `redaction.test.ts`, `health-server.test.ts`) —
no mainnet, no keys, deterministic.

## The invariant that makes recovery trivial

**The CAP order status is the single source of truth — never in-memory state.**
The loop keeps `delivered`/`inFlight` sets for speed, but correctness never
depends on them: before every delivery it re-reads the order and acts on what CAP
says. So a worker that is `kill -9`'d loses all memory and still does the right
thing on restart, because the truth was never in the worker.

## Failure modes covered

| Failure | What happens | Guarantee |
|---|---|---|
| **Duplicate `order_paid`** (WS reconnect replay) | in-flight + `delivered` guards short-circuit | delivered **exactly once** |
| **Duplicate `negotiation_created`** storm | synchronous in-flight/accepted guard admits one | accepted **exactly once**, `errors == 0` |
| **Transient deliver blip** (network/429/5xx) | bounded retry with exponential backoff (injected sleeper) | delivered once after recovery |
| **Deliver keeps failing** past the retry budget | order left **paid**, error logged, deferred to the sweep | **no stuck escrow** — the sweep delivers it later, once |
| **Landed-but-lost** (tx cleared, response dropped) | next read shows the order already `completed` | counted once, **never re-sent** |
| **`kill -9` before payment processed** | startup sweep recovers the queued paid order | delivered **exactly once** by the restarted worker |
| **`kill -9` in the on-chain gap** | restarted worker sees `completed` on CAP → skips | **no double delivery** |
| **SLA already expired** at fulfil | skip; CAP's expiry path refunds escrow | never deliver stale |
| **SLA expires mid-work** | re-checked before the send → skip | never deliver into a refunded order |
| **Order rejected/refunded mid-work** | terminal state recognised, not retried | clean stop, `errors == 0` |
| **Hostile / malformed requirements + garbage events** (fuzz, 5 seeds × 300 ops) | matcher/handler fail soft; garbage events no-op | no crash, no fabricated delivery, no `__proto__` pollution |

## Retry & the sweep — belt and suspenders

Delivery is a single, state-checked, retryable step:

1. **Re-read** the order. `completed` → count once (idempotent). Terminal
   non-`paid` (rejected/expired) → stop cleanly. SLA blown → skip.
2. **Deliver.** A throw is retried with exponential backoff over an injected
   `Sleeper` (`ORACLE_DELIVER_RETRIES`, `ORACLE_RETRY_BASE_MS`).
3. If retries are exhausted, re-read once more: if it actually *landed*, count it;
   otherwise **leave it paid and propagate** — the periodic sweep
   (`ORACLE_SWEEP_INTERVAL_MS`) is the final backstop, so escrow is never stuck.

Because a genuine failure rejects the order (CAPVault refunds) and a lost-response
never double-sends, the desk has no failure mode where a requester pays and gets
nothing *and* no refund.

## Secrets audit

- `.env` / `.env.*` are gitignored (only `.env.example` is tracked); no live
  `croo_sk_` key exists anywhere in tracked source.
- **Redaction is defence-in-depth.** `redactSecrets` masks `croo_sk_…` in any
  string/object (cycle-safe), and the worker's default logger is wrapped so
  *every* message and meta is redacted — not just the SDK's own logs. This
  matters because the loop logs `String(error)`, and a WS connection error can
  carry the key-bearing URL.

## Status page

Set `ORACLE_HEALTH_PORT` and the worker serves JSON:

- `GET /healthz` and `/status` → `200` with the liveness snapshot
  (`connected`, `startedAt`, `lastEventAt`, `lastSweepAt`, `uptimeSeconds`,
  and the full stats counters), or `503` when the loop is disconnected — so
  Railway/k8s/uptime checks treat a dropped worker as unhealthy.

```bash
ORACLE_HEALTH_PORT=8080 pnpm --filter @hunch/oracle worker
curl -s localhost:8080/status | jq
```

## See it live, no credentials

```bash
pnpm --filter @hunch/oracle smoke:hardening
```

Runs the desk through `kill -9` mid-order, a transient deliver blip, a reconnect
storm, and SLA expiry — asserting no double delivery and no stuck escrow at each
step — then boots the status page and curls it. Exits non-zero if any invariant
is violated.
