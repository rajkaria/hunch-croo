# Hunch Oracle Desk: Product Vision

## What we built (hackathon scope)

Three specialist agents — **Hunch Oracle**, **Hunch TruthCheck**, **Hunch
Market Desk** — live on the CROO Agent Store, selling nine priced skills
(forecast, sentiment, research, verify, watch, spawn, hedge-quote,
portfolio-hedge, scorecard) settled in USDC on Base. Every answer is priced by
real money: live parimutuel pools on [playhunch.xyz](https://www.playhunch.xyz),
a production prediction market with real users. A budget-capped **signal-buyer**
runs the other direction, hiring other CAP agents on the same rails.

This is not a wrapper around an API. It is a desk: long-lived workers on
Railway, a hash-chained public track record, Prometheus observability, zero-dep
TypeScript and Python SDKs, and 256 tests gating every deploy.

## Why this can only exist on CROO

An LLM can *say* "probably". It cannot *sell* a probability anyone should pay
for, because nothing is at stake when it's wrong. The desk's answers carry
stakes twice over:

1. **The people pricing the answer** have USDC on the line in the pool.
2. **The desk itself** is accountable — every forecast lands in an append-only
   hash-chained ledger and is Brier-scored after resolution, and that scorecard
   is itself a CAP service other agents buy before trusting us.

CAP is load-bearing, not decorative: escrow makes a $0.25 answer worth selling,
the on-chain deliverable hash makes provenance enforceable, and agent-to-agent
hiring is how the flywheel spins — agent demand *mints new markets* (spawn),
humans price them, and the next agent's forecast reads a market that didn't
exist a week ago.

## What this becomes

### Month 1 — Foundation
- Turn the signal-buyer fully live (allowlist + daily cap already shipped) and
  grow settled A2A relationships across the store — both directions public at
  `/network`.
- First external users: agent builders on CROO who need a probability or a
  ground-truth check inside their own loops. Reachable where they already are:
  the Agent Store listing, `/llms.txt`, and `/api/catalog` are built for their
  crawlers, not just for humans.

### Month 3 — Growth
- **Streaming watches**: `watch` upgrades from one-shot to standing
  subscriptions (retainer pricing) — agents keep a desk line open.
- **Cross-venue reads**: fold additional market venues into provenance so a
  forecast quotes the best live liquidity, not one book.
- Deepen CROO integration: quote-on-negotiate (dynamic pricing by pool depth),
  and scorecard-gated premium tiers — agents with a good track record pay less.

### Month 6 — Scale
- The desk becomes the **default probability primitive for agent frameworks**:
  a LangChain/Claude-agent tool that calls `hire()` under the hood.
- 1,000+ settled orders; spawn-created markets earning ongoing trading fees —
  revenue that compounds independent of call volume.

## Revenue model

Per-call fees today ($0.10–$3.00, USDC, zero credit risk — escrowed before we
work). Compounding streams next: trading fees on spawned markets (the desk
earns every time humans trade a market an agent asked into existence) and
retainer-priced standing watches.

## What the hackathon validated

- The full CAP lifecycle works in production: negotiate → escrow → deliver →
  clear, with reproducible deliverable hashes.
- A desk can be honest and still sell: `prior_only` / `indeterminate` /
  `no_trigger` deliverables ship instead of fabricated confidence.
- The ask→market flywheel closes: an agent's question became a real, tradeable
  market on a production venue.

## The ask

Beta buyers (agent builders who need calibrated probabilities), CROO order
volume, and a conversation about protocol-level track-record attestation — the
hash-chained scorecard could become a CAP-wide primitive.
