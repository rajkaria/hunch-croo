---
feature: Web experience — premium landing, A2A network page, agent-readable surfaces (S16)
globs:
  - apps/web/**
  - docs/VISION.md
updated: 2026-07-14
---

# Web experience — landing overhaul + A2A surfaces (S16)

The judge-facing (and agent-facing) layer over the deployed desk. Built after
S15 put all four processes ONLINE on Railway. Targets the hackathon rubric
directly: A2A Composability 25% (`/network`), Technical Execution 30%
(live-data landing), Presentation 10% (premium design), plus the VISION doc.

## What exists

**Landing page** (`apps/web/src/app/page.tsx`, async server component,
`revalidate = 120`):

- Hero (unchanged concept) + eyebrow that shows a **live online-agent count**
  read from CROO's public API (`agentIds()` in `lib/croo.ts`; graceful
  fallback to "Live on Base" when unreachable).
- **Live agents band** — three cards (Oracle/TruthCheck/MarketDesk) with real
  `onlineStatus`, completed orders, USDC earned; Railway port shown per worker.
- Stats band (now 9 skills / 256 tests), how-it-works, flywheel (kept).
- **Desk menu** — fixed "Eight→Nine priced skills"; each service card now shows
  its example requirements JSON (`lp-svc-example`).
- **Use cases** (`lp-uc-grid`) — 4 buyer personas: trading agent, research
  agent, autonomous fund, watchtower.
- **Architecture diagram** (`ArchDiagram`, animated SVG) — any CAP agent →
  CROO store → Railway box (3 workers + signal-buyer) → playhunch.xyz / Base /
  receipts; plus an 8-item `SPECS` grid.
- **Track record section** — hash-chained ledger copy + `CalibrationArt` SVG,
  links /scorecard + /metrics.
- **A2A section** — `NetworkArt` constellation SVG + link to `/network`.

**`/network` page** (`app/network/page.tsx`, force-dynamic) — the A2A
composability proof. Folds `fetchCompletedOrders` (inbound) +
`fetchHiredOrders` (outbound) into a counterparty ledger; renders a
hub-and-spoke SVG graph (`np-*` classes) with in/out edges, self-wallet nodes
dashed amber (anti-sybil labelling), plus a table with Basescan links and a
"build on the desk" CTA row. Honest empty states — nothing seeded.

**Agent-readable front doors** (both zero-auth, CORS `*`):

- `/llms.txt` (`app/llms.txt/route.ts`) — plain-text pitch + all 9 services
  with example payloads, for LLM agents crawling the domain.
- `/api/catalog` (`app/api/catalog/route.ts`) — JSON catalog mirroring
  `lib/pricing.ts` (services, prices, SLAs, example requirements, links,
  honesty guarantees).

**Shared:** `agentIds()` added to `lib/croo.ts` (dashboard now uses it too);
nav gained "Network"; `docs/VISION.md` (roadmap/revenue/validation) linked
from README's new "What's next" section.

## Gotchas

- The web app stays **dependency-free of the worker** — pricing/catalog data
  is mirrored in `lib/pricing.ts`, not imported from `packages/oracle`.
- All landing styling is namespaced `lp-*` (network page `np-*`) in
  `globals.css`; new animated classes are registered in the
  `prefers-reduced-motion` block.
- `usdcToNumber` divides by 1e6 (6dp base units) — reuse it, don't re-derive.
- Local dev without network access: landing falls back cleanly ("worker"
  pill, em-dash stats); `/network` shows 0/3 + empty-state cards. Expected.

## Verify

`pnpm gate` (256 tests) and `pnpm --filter @hunch/oracle-web build` — both
green as of 2026-07-14. Routes: `/` static-ISR, `/network` dynamic,
`/llms.txt` + `/api/catalog` revalidate hourly.
