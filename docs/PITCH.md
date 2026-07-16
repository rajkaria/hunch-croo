# Hunch Oracle — CROO Demo Day pitch

**Slot:** Thu 16 Jul 2026, 11:54–12:00 UTC · 6 min (≈4 present + 2 Q&A) · Google Meet.
**Deck:** live at **https://oracle.playhunch.xyz/pitch** — 12 slides. Press **F** for
full-screen, **N** for speaker notes + a pacing timer. Deployed source is
`apps/web/public/pitch.html` (served via a `/pitch` rewrite); `docs/PITCH-DECK.html` is a
standalone copy for offline use.
**One line:** *Agents can finally buy what no LLM can sell — probabilities with money behind them.*

Rename yourself in Meet to **Raj — Hunch Oracle**. Join ~4 min early, test screen-share.

---

## The spoken script (~3:45 — inside 4:00)

**[01 · Cover]**
"Agents can finally buy what no language model can **sell**: a probability with real
money behind it." *(pause one beat, then advance.)*

**[02 · Problem]**
A model can *say* "probably." It can't *sell* a probability worth paying for — because
nothing is at stake when it's wrong. Un-priced confidence is worthless to an agent that has
to **act**: place a trade, hedge a position, trigger a workflow. The gap isn't intelligence.
It's **accountability**.

**[03 · Insight]**
So here's the move: a probability is only worth money **if money priced it**. On
playhunch.xyz — a production prediction market with real users — people put USDC into live
pools. The odds *are* the crowd's money-weighted forecast. We don't ask a model what it
thinks; we read **what people betting are willing to lose**.

**[04 · What we built]**
We shipped a **desk**: three agents live on the CROO Agent Store, nine paid skills — from a
25-cent forecast to portfolio hedging — every one **settled in USDC on Base**. This isn't a
wrapper around an API. It's a real desk: long-lived workers, a public track record, and
zero-dependency TypeScript and Python SDKs.

**[05 · Money path]**
And the full money path runs in production: negotiate → escrow → deliver → clear, with a
reproducible deliverable hash. **CAP is load-bearing** — escrow makes a 25-cent answer worth
selling, the on-chain hash makes provenance enforceable. Take CAP away and none of it works.

**[06 · Flywheel — slow down, this is the centerpiece]**
The best part: agent demand **mints the markets**. No market for your question? Our `spawn`
skill mints a real, tradeable one. Humans price it with their own USDC. And a week later, the
next agent's forecast reads a market **that didn't exist before it was asked for**. That loop
closed in production — an agent's question became a real market humans are trading.

**[07 · Honesty]**
We settle in **public**. Every forecast is hash-chained and Brier-scored after the market
resolves. When a book is unbet we return `prior_only` — we don't fake confidence. The
scorecard is itself a service other agents can buy **before** they decide to trust us.

**[08 · Proof]**
This isn't a mockup. Three agents live, nine services, 250-plus tests gating every deploy,
two SDKs — and **the first real agent-to-agent orders are placed**. And it runs both ways: a
budget-capped signal-buyer hires other CAP agents too, both directions public at `/network`.
Live right now at oracle.playhunch.xyz.

**[09 · Hunch Cup — zoom out, hit the numbers]**
And this demand isn't hypothetical. On **Hunch Cup** — our risk-free prediction-market
competition for agents — the **first 24 hours** saw 13,961 trades across 1,976 markets, and
**97% of them were placed by autonomous agents**. 1,411 agents competing, $5,000 in real USDC
on the line, Top 50 paid on Base. Agents already **rule** prediction markets — that's exactly
the demand this desk was built to serve.
*(Numbers are Hunch Cup's measured first 24h; volume is $pUSDC paper, prize is real USDC.)*

**[10 · Vision]**
Where this goes: the **default probability primitive** for agent frameworks — a `hire()` call
any LangChain or Claude agent makes under the hood. Streaming watch retainers, cross-venue
reads, and spawned markets earning fees that **compound** beyond per-call.

**[11 · Ask]**
The ask, three things: **beta buyers** who need calibrated probabilities in their loops;
**CROO order volume**; and a conversation about making our hash-chained scorecard a **CAP-wide
track-record primitive**.

**[12 · Close]**
"Agents can finally buy what no LLM can sell — probabilities with money behind them. The
desk is live. Come place an order." **oracle.playhunch.xyz.** Thank you.

---

## Q&A prep — tuned to the five judges

**Leo (CROO co-founder / ops & ecosystem) — "How does this grow the store?"**
Every `spawn` order creates a new market and, downstream, new `forecast`/`research` demand —
we're both a seller *and* a buyer, so we add order flow in both directions. We hit the
3-agent onboarding cap deliberately. The scorecard is a credibility surface that makes *other*
agents safer to transact with, which is a store-level good, not just ours.

**Aswin (marketing / Web3 growth) — "How do agents even find you?"**
Distribution is built for machines: the Agent Store listing, plus `/llms.txt` and
`/api/catalog` that crawlers read. The wedge is narrow and painful — an agent that needs a
*number to act on* has no honest source today. Land one framework integration (`hire()` tool)
and every agent on it inherits us.

**Ray (crypto infra / ex-Tencent) — "Walk me through settlement and custody."**
USDC on Base, escrowed at negotiate time — we're paid before we work, zero credit risk. Every
deliverable carries a reproducible hash so provenance is enforceable on-chain. Hedging is
**non-custodial**: we return executable trade instructions; the buyer keeps custody, we never
touch funds. The signal-buyer is allowlisted with a hard daily USDC cap.

**Yifeng (LLM / AI infra, TEA) — "Where's the LLM, and how do you avoid hallucinated confidence?"**
The number comes from the **market**, not the model — the LLM only maps a natural-language
question to the right book and formats provenance. Sizing on hedges is set by deterministic
caps, never the LLM. And we refuse to fabricate: `prior_only` when unbet, `indeterminate` with
an error chain on source failure, `no_trigger` when a watch doesn't fire. Honesty is enforced
in code, then scored publicly with Brier + calibration.

**Rambo (AI product) — "Who's the first paying buyer and why do they come back?"**
Agent builders whose loops need a probability or a ground-truth check — trading agents,
research agents, monitoring agents. Retention comes from the scorecard (they can audit our
calibration for a dime before trusting us) and from `watch` upgrading to standing
subscriptions — a retainer relationship, not a one-shot call.

**Likely sharp ones**
- *"Isn't this just a prediction-market API?"* — No: it's bidirectional agent commerce with
  a public, hash-chained track record, and it *creates* the markets it reads via `spawn`. The
  supply side is the moat.
- *"Real volume yet?"* — First real A2A orders placed; the ask is CROO order flow to grow
  settled relationships. Be honest: traction is early, the rails and the loop are proven.
- *"What if no market matches?"* — `forecast` returns `no_market` + a `spawnHint` you feed
  straight into `spawn`. The dead-end becomes new supply.

---

## Room notes
- Present from the deck full-screen; press **N** to see notes + timer (best on a second
  monitor — otherwise rehearse from this file and present clean).
- Slide 06 (the flywheel) is the money slide — slow down there; rush 02–05 if you must.
- End on the URL. Leave the close slide up during Q&A.
