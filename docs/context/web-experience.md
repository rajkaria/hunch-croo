---
feature: Web experience — premium landing, A2A network page, agent-readable surfaces (S16)
globs:
  - apps/web/**
  - docs/VISION.md
updated: 2026-07-14
---

# Web experience — landing overhaul + A2A surfaces (S16)

> **S17 redesign (2026-07-14, `0c5a625`):** the whole web app was rebuilt on a
> full-bleed editorial design system after the boxed `.shell { max-width:1080px }`
> layout left dead gutters on wide screens. Sections/hairlines/glows/market tape
> now span the viewport; content sits in a 1400px frame with page-height rails
> ≥1480px. Identity: Instrument Serif italic accent words + tight Inter display +
> mono data; numbered sections with sticky side labels; full-bleed stat strips;
> serif-watermark footer. All six pages share `_components/Chrome.tsx`
> (PageHero/Section/StatBar). Class vocabulary in this doc's older sections
> (`.shell`, `.hero`, `.section`, `.stat`, `.lp-stats`) is superseded by
> `.inner`, `.sec/.sec-grid`, `.statbar`, `.page-hero` in `globals.css`.

The judge-facing (and agent-facing) layer over the deployed desk. Built after
S15 put all four processes ONLINE on Railway. Targets the hackathon rubric
directly: A2A Composability 25% (`/network`), Technical Execution 30%
(live-data landing), Presentation 10% (premium design), plus the VISION doc.

## Current state — what's working, deployed, broken

**🟢 LIVE ON PROD.** Merged to `main` (`74b2fb5` + fix `b34a84d`) and deployed:

- **Web:** Vercel project **`hunch-oracle-desk`** (acct `rajkaria67-1831`),
  git-connected to `main` — a push to main auto-deploys production. Custom
  domain **https://oracle.playhunch.xyz** (200 on all 8 routes: `/`,
  `/network`, `/dashboard`, `/scorecard`, `/metrics`, `/docs`, `/llms.txt`,
  `/api/catalog`). The raw `*.vercel.app` project URL 302s (deployment
  protection) — **always verify against the custom domain**, not the
  vercel.app URL.
- **Agents:** all three sellers are **ONLINE** on the CROO store. The prod
  hero eyebrow renders "3 agents online now" from live CROO data.
- Gate green: typecheck + 256 tests; `pnpm --filter @hunch/oracle-web build`
  green.

Nothing is broken. Zero orders have been placed against the new listings yet
(`/network` + the order feed render honest empty states) — that is an
operational gap, not a code one.

## Recent changes — files touched and why

- `apps/web/src/app/page.tsx` — rewritten as an **async server component**
  (`revalidate = 120`). New: live agent band (real `onlineStatus`/orders/USDC
  per agent), 4 buyer-persona use cases (`lp-uc-grid`), animated architecture
  diagram (`ArchDiagram`), 8-item spec grid, track-record section with
  `CalibrationArt` SVG, A2A section with `NetworkArt` constellation, per-service
  example payloads, "Nine priced skills" (was wrongly "Eight").
- `apps/web/src/app/network/page.tsx` — **new**. The A2A composability proof:
  folds `fetchCompletedOrders` (inbound) + `fetchHiredOrders` (outbound) into a
  counterparty ledger, renders a hub-and-spoke SVG graph (`np-*`) with in/out
  edges, self-wallet nodes dashed amber (anti-sybil), plus a Basescan-linked
  table and "build on the desk" CTAs.
- `apps/web/src/app/llms.txt/route.ts`, `apps/web/src/app/api/catalog/route.ts`
  — **new**. Zero-auth, CORS `*` machine-readable front doors so agents can
  integrate without scraping HTML.
- `apps/web/src/lib/croo.ts` — added `agentIds()`; **fixed the seller agent
  ids** (see decisions).
- `apps/web/src/app/globals.css` — +530 lines of namespaced `lp-*`/`np-*`.
- `apps/web/src/app/layout.tsx` — nav gained "Network".
- `docs/VISION.md` — **new**, linked from README's "What's next".

## Key decisions — choices and trade-offs, why X over Y

- **The real seller agent ids are hardcoded as defaults** in `lib/croo.ts`
  (`SELLER_AGENT_IDS`), not left to env. The prod bug that shipped in `74b2fb5`
  was that the default `CROO_AGENT_IDS` was still the **S0 echo-test agent**
  (`013febe1…`, named just "Hunch"), and Vercel had no `CROO_AGENT_IDS` set —
  so prod fetched one wrong agent and every card fell back to "worker / —".
  These ids are **public** on the CROO Agent Store, so defaulting to them is
  safe and means the surfaces render live with **zero env config**:
  - Hunch Oracle `10582fea-07e1-423c-bc3b-dfa02de2691f`
  - Hunch TruthCheck `990fa2a5-9be6-4632-864c-c8d23a09048f`
  - Hunch Market Desk `d019b1ba-c933-4137-8cbc-30d37126ee50`
  `ownAgentIds()` = those three + the legacy "Hunch" agent + the buyer agent
  (`b373b1bc…`), so self-trades stay labelled.
- **Listings match agents by exact name**, not substring — the S0 agent is
  named "Hunch", which substring-matched nothing and silently degraded.
- **Landing is ISR (120s), `/network` + `/dashboard` are force-dynamic.** The
  landing must survive a CROO API outage (it degrades to static copy); the
  data pages should always be fresh.
- **The web app stays dependency-free of the worker** — pricing is mirrored in
  `lib/pricing.ts`, never imported from `packages/oracle`, so it deploys alone.
  Cost: the price table must be kept in sync with `core/pricing.ts` by hand.

## Next steps — specific, actionable

1. **Seed 10+ real CAP orders** — the single biggest scoring lever (explicit
   Technical Execution bonus, and it lights up `/network`, `/dashboard` and the
   landing band with real numbers). Run `spike:requester` against each of the 9
   services twice (~$16 total, mostly recycled into our own agents).
2. **Flip `SIGNAL_BUYER_ENABLED=true`** on the Railway `buyer` service — a
   money decision, Raj's call. Outbound hires to *external* agents are the
   strongest A2A signal and render automatically on `/network`.
3. **Rotate the three seller SDK keys** — they were pasted into a chat
   transcript on 2026-07-14 (see the roadmap memory). Rotate in the CROO
   dashboard, then update Railway + `.env`.
4. **Record the demo video** (≤5 min): live dashboard with real orders → a 20-line
   `hire()` → spawn a market and show it live on playhunch.xyz → `/network`
   graph → scorecard.
5. **File the DoraHacks BUIDL** — verify the deadline first (memory says
   submissions closed 2026-07-09; assume extended, but confirm).

## Gotchas

- Verify prod against **oracle.playhunch.xyz**; the `*.vercel.app` URL is
  behind deployment protection and returns 302.
- All landing styling is namespaced `lp-*` (network page `np-*`); every new
  animated class must also be registered in the `prefers-reduced-motion` block.
- `usdcToNumber` divides by 1e6 (6dp base units) — reuse it, don't re-derive.
- Local dev without CROO reachable: the landing degrades cleanly ("worker"
  pill, em-dash stats), `/network` shows 0/3. That is the fallback path, not a
  bug — but it is also exactly what the prod agent-id bug looked like, so if
  prod shows "worker" pills, check `agentIds()` before anything else.
