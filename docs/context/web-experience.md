---
feature: Web experience — full-bleed design system, landing, A2A network page, agent-readable surfaces (S16–S17)
globs:
  - apps/web/**
  - docs/VISION.md
updated: 2026-07-14
---

# Web experience — S16 surfaces + S17 full-bleed redesign

The judge-facing (and agent-facing) layer over the deployed desk. S16 built
the surfaces (live landing, `/network`, `/llms.txt`, `/api/catalog`,
VISION.md); S17 rebuilt the entire visual layer after Raj flagged the boxed
layout ("gaps on both the sides"). Targets the hackathon rubric: A2A
Composability 25% (`/network`), Technical Execution 30% (live-data landing),
Presentation 10% (premium design).

## Current state — what's working, deployed, broken

**🟢 S17 REDESIGN LIVE ON PROD** (2026-07-14). Merged to `main` as `f7e651e`
(redesign `0c5a625` + context `cc4e2cb`), Vercel auto-deployed in ~40s,
verified against the custom domain: all 8 routes 200, hero renders the live
"3 agents online now" eyebrow, full-bleed confirmed in-browser at 1920/1440/375.

- **Web:** Vercel project **`hunch-oracle-desk`** (acct `rajkaria67-1831`),
  git-connected to `main` — push to main auto-deploys prod. Custom domain
  **https://oracle.playhunch.xyz**; the raw `*.vercel.app` URL 302s
  (deployment protection) — **always verify against the custom domain**.
- **Agents:** all three sellers ONLINE on the CROO store (live data on the
  landing band, `/network` shows 3/3).
- Gate green: typecheck + 256 tests; web build green.
- Worktree branch `claude/hunch-oracle-redesign-fc2a80` is fully merged —
  safe to prune.

Nothing broken. Zero orders placed against the listings yet (`/network`,
order feed, scorecard render honest empty states) — operational gap, not code.

## The S17 design system (what the classes mean now)

The old `.shell { max-width:1080px }` wrapper boxed nav, hero art and ticker
into a floating column. It's gone. Architecture now:

- **Full-bleed sections + framed content.** Every section spans the viewport
  (backgrounds, hairline `border-top`s, glows, market tape); content sits in
  `.inner` (1400px max, `--pad` gutters). Two page-height hairline **rails**
  (`.rails`, fixed) frame the container on viewports ≥1480px.
- **Type identity:** Inter tight display (weights 620–650, −0.04em) +
  **Instrument Serif italic** accent words (every `h1/h2 em` gets the serif +
  green→cyan gradient) + JetBrains Mono for data. Fonts via `next/font`
  (`--font-sans/--font-mono/--font-serif`).
- **Editorial scaffold:** numbered sections — `.sec > .inner.sec-grid` with a
  sticky `.sec-side` (mono index `01` + kicker) and `.sec-main`. Headings
  `.sec-h2` (add `.sm` on subpages).
- **Stat strips:** `.statbar > .inner > .statbar-grid` — full-bleed bordered
  band; cells get hairline dividers via the 1px-gap/background trick (grid gap 1px,
  grid background = `--border`, cells `--bg-deep`). The grid MUST be nested
  inside `.inner`, not merged with it, or the divider color bleeds into the
  container padding.
- **Shared chrome:** `apps/web/src/app/_components/Chrome.tsx` exports
  `PageHero`, `Section`, `StatBar`, `StatCell` — all five subpages use them;
  the landing has its own local `SectionSide` + bespoke sections.
- **Footer:** 4-column link grid + giant serif-italic outline watermark
  (`.foot-mark`).
- Superseded classes (deleted): `.shell`, `.hero`, `.section`, `.stat`,
  `.lp-stats`, `.lp-kicker/.lp-h2/.lp-lead`. Landing SVG/console/menu classes
  (`lp-gauge/fly/arch/net/console/menu/uc/why/track`, `np-*`) survive restyled.

## Recent changes — files touched and why (S17)

- `apps/web/src/app/globals.css` — full rewrite (~1700 lines): tokens, rails,
  nav, tape, hero, statbar, sec scaffold, primitives, footer, page-hero,
  `cal-*` bars, reduced-motion block.
- `apps/web/src/app/layout.tsx` — new nav (container-framed, "Hire the desk"
  CTA, brand with serif em) + 4-column footer + `.rails`; added
  Instrument_Serif font.
- `apps/web/src/app/page.tsx` — same content/data, restructured into numbered
  full-bleed sections; tape moved above the hero under the nav; stat strip
  replaces floating stat cards.
- `apps/web/src/app/_components/Chrome.tsx` — **new** shared page chrome.
- `dashboard|network|scorecard|metrics|docs/page.tsx` — rebuilt on
  PageHero/Section/StatBar/StatCell; scorecard's inline-style calibration bars
  → `.cal-*` classes. All data fetching untouched.

## Key decisions — choices and trade-offs, why X over Y

- **Rails instead of stretching content wider:** ultra-wide screens get a
  deliberate 1400px frame with hairline rails rather than 100%-width content —
  reads as designed, keeps line lengths sane.
- **Serif italic accents over gradient-text-everywhere:** one accented em per
  heading (Instrument Serif italic + gradient) is the identity; everything
  else stays restrained.
- **Nav CTA hidden ≤720px** via `.nav .nav-cta.btn { display:none }` — the
  extra specificity is REQUIRED because `.btn { display:inline-flex }` is
  declared later at equal class specificity and would win.
- Carried over from S16 (still true): real seller agent ids hardcoded as
  defaults in `lib/croo.ts` (Oracle `10582fea…`, TruthCheck `990fa2a5…`,
  Market Desk `d019b1ba…`; buyer `b373b1bc…` in `ownAgentIds()`); listings
  match agents by **exact name**; landing ISR 120s while `/network` +
  `/dashboard` force-dynamic; web app stays dependency-free of the worker
  (pricing mirrored in `lib/pricing.ts`, sync with `core/pricing.ts` by hand).

## Next steps — specific, actionable

1. **Seed 10+ real CAP orders** — the single biggest scoring lever (explicit
   Technical Execution bonus; lights up `/network`, `/dashboard` and the
   landing band). Run `spike:requester` against each of the 9 services twice
   (~$16 total, mostly recycled into our own agents).
2. **Flip `SIGNAL_BUYER_ENABLED=true`** on the Railway `buyer` service — a
   money decision, Raj's call. External outbound hires are the strongest A2A
   signal and render automatically on `/network`.
3. **Rotate the three seller SDK keys** — pasted into a chat transcript on
   2026-07-14. Rotate in the CROO dashboard, then update Railway + `.env`.
4. **Record the demo video** (≤5 min): live dashboard with real orders → a
   20-line `hire()` → spawn a market live on playhunch.xyz → `/network` graph
   → scorecard.
5. **File the DoraHacks BUIDL** — verify the deadline first (memory says
   submissions closed 2026-07-09; assume extended, but confirm).
6. Optional polish: prune merged worktree branches; consider an OG image to
   match the new identity.

## Gotchas

- Verify prod against **oracle.playhunch.xyz**; the `*.vercel.app` URL 302s.
- Every new animated class must be registered in the `prefers-reduced-motion`
  block in `globals.css`; scroll-reveals need the `noscript` fallback on any
  new page using `Reveal`.
- The in-app Browser preview pane **throttles IntersectionObserver/rAF and
  wedges on wheel-scroll** (black screenshots, 30s timeouts — reproduced on
  prod too, so it's the pane, not the site). Audit trick: tall viewport
  (e.g. 1440×2200) + `document.body.style.transform='translateY(-Npx)'` +
  force `.lp-reveal.is-visible` via JS, screenshot at scrollY 0 only.
- `usdcToNumber` divides by 1e6 — reuse it, don't re-derive.
- Local dev without CROO reachable degrades cleanly ("worker" pill, em-dash
  stats) — that's the fallback path, but it's also what the S16 prod
  agent-id bug looked like, so if prod shows "worker" pills check
  `agentIds()` first.
