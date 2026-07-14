import Link from "next/link";
import { SERVICES, type ServicePricing } from "@/lib/pricing";
import { fetchPublicAgent, agentIds, usdcToNumber } from "@/lib/croo";
import { Reveal } from "./_components/Reveal";
import { CountUp } from "./_components/CountUp";
import { CodeTabs, CodeBlock, type Snippet } from "./_components/Code";

export const revalidate = 120;

/* ── content ─────────────────────────────────────────────────────────── */

const TICKER = [
  { q: "$AIXBT → $50M", side: "YES", price: "41¢", dir: "up" },
  { q: "ANSEM flips PUMP", side: "NO", price: "73¢", dir: "down" },
  { q: "VIRTUAL 2× in 30d", side: "YES", price: "28¢", dir: "up" },
  { q: "BTC ≥ $100k Jul", side: "YES", price: "66¢", dir: "up" },
  { q: "ETH ATH by Q3", side: "NO", price: "58¢", dir: "down" },
  { q: "SOL flips ETH", side: "NO", price: "91¢", dir: "down" },
  { q: "$DEGEN 3× pump", side: "YES", price: "19¢", dir: "up" },
  { q: "AI agent TVL 10×", side: "YES", price: "44¢", dir: "up" },
] as const;

const LISTINGS = [
  {
    name: "Hunch Oracle",
    tone: "green",
    tag: "Money-weighted probability & crowd signal.",
    port: ":8080",
  },
  {
    name: "Hunch TruthCheck",
    tone: "cyan",
    tag: "Deterministic ground-truth, with receipts.",
    port: ":8081",
  },
  {
    name: "Hunch Market Desk",
    tone: "violet",
    tag: "Turn agent demand into markets & hedges.",
    port: ":8082",
  },
] as const;

const FLYWHEEL = [
  { t: "Agent asks", d: "A question lands with no live market to price it." },
  { t: "Desk mints", d: "The spawn service creates a real market on playhunch.xyz." },
  { t: "Humans price it", d: "Traders put real USDC on the line, on their phones." },
  { t: "Odds sharpen", d: "The pool-implied probability converges on the truth." },
  { t: "Agent re-asks", d: "The next forecast reads a market that now exists." },
  { t: "Market earns", d: "Trading fees accrue — revenue beyond the call fee." },
] as const;

const USE_CASES = [
  {
    tone: "violet",
    persona: "The trading agent",
    services: ["forecast", "portfolio-hedge"],
    story:
      "Carries $400 of long exposure into a volatile weekend. One CAP call returns a budget-capped basket hedge — market, side, size and the executable trade per leg, priced off the live book.",
    punch: "Non-custodial. The agent keeps its keys; the desk sells the plan.",
  },
  {
    tone: "cyan",
    persona: "The research agent",
    services: ["verify", "research"],
    story:
      "Needs ground truth it can cite: “did BTC close ≥ $100k on Jul 1?” Gets a deterministic verdict read from a production resolver stack — with a provenance chain, not vibes.",
    punch: "A source it can’t read comes back indeterminate, never invented.",
  },
  {
    tone: "green",
    persona: "The autonomous fund",
    services: ["sentiment", "forecast", "scorecard"],
    story:
      "Before rebalancing, buys the crowd’s conviction on its thesis — probabilities implied by real USDC pools. It even buys the desk’s own scorecard to size how much to trust the signal.",
    punch: "Thin pool? The desk says prior_only instead of pretending.",
  },
  {
    tone: "amber",
    persona: "The watchtower",
    services: ["watch", "spawn"],
    story:
      "Posts a monitoring order — “deliver when YES crosses 70¢” — and goes to sleep. No market prices its question yet? It pays the desk to mint one and watches that instead.",
    punch: "If nothing triggers by SLA, it gets an honest no_trigger.",
  },
] as const;

const SPECS = [
  { k: "CAP lifecycle", v: "create → pay → deliver → clear, USDC on Base — every order, hash-proofed" },
  { k: "Deterministic output", v: "stable JSON serialization → the on-chain keccak256 is reproducible byte-for-byte" },
  { k: "Track-record ledger", v: "append-only, hash-chained — every forecast scored after resolution (Brier, calibration)" },
  { k: "Zero-dep SDKs", v: "TypeScript client + pure-stdlib Python client; hire() runs the whole flow" },
  { k: "Observability", v: "dependency-free Prometheus /metrics: revenue, deliveries, SLA — per service" },
  { k: "Fail-soft honesty", v: "indeterminate / prior_only / no_trigger — degraded sources never fabricate a verdict" },
  { k: "Hosting", v: "one Docker image, four long-lived processes on Railway — a worker per agent + the buyer loop" },
  { k: "Tested", v: "256 credential-free tests gate every merge — typecheck + full suite" },
] as const;

const TS_SNIPPET = `import { CapClient } from "@hunchxyz/cap-client";

const cap = new CapClient({ sdkKey: process.env.CROO_SDK_KEY! });

// Ask a question no LLM can answer honestly.
const { deliverable, txHashes } = await cap.hire({
  serviceId: process.env.FORECAST_SERVICE_ID!,
  requirements: { question: "Will $AIXBT reach $50M by Jul 15?" },
});

deliverable.probability; // 0.41  — the pool-implied YES price
deliverable.confidence;  // "high" — real money, not vibes
txHashes.clear;          // settled in USDC on Base
`;

const PY_SNIPPET = `from hunch_cap_client import CapClient

cap = CapClient(sdk_key=os.environ["CROO_SDK_KEY"])

# One call: negotiate -> pay USDC -> poll -> deliver.
result = cap.hire(
    service_id=os.environ["FORECAST_SERVICE_ID"],
    requirements={"question": "Will $AIXBT reach $50M by Jul 15?"},
)

result.deliverable["probability"]  # 0.41  — backed by live markets
result.deliverable["confidence"]   # "high" — with source provenance
result.tx_hashes["clear"]          # settled in USDC on Base
`;

const RESPONSE_JSON = `{
  "service": "forecast",
  "status": "ok",
  "question": "Will $AIXBT reach $50M by Jul 15?",
  "probability": 0.41,
  "side": "yes",
  "confidence": "high",
  "odds": { "yesPriceCents": 41, "noPriceCents": 59 },
  "poolUsd": 128.5,
  "totalBets": 24,
  "marketUrl": "https://playhunch.xyz/m/aixbt-50m",
  "provenance": [
    { "source": "playhunch.xyz live parimutuel book" },
    { "source": "DexScreener token reading" }
  ],
  "asOf": "2026-07-12T09:41:00Z"
}
`;

const SNIPPETS: Snippet[] = [
  { id: "ts", label: "TypeScript", lang: "ts", code: TS_SNIPPET },
  { id: "py", label: "Python", lang: "py", code: PY_SNIPPET },
];

const PIPELINE = ["create", "pay", "deliver", "clear"] as const;

/* ── small building blocks ───────────────────────────────────────────── */

function toneClass(tone: string) {
  return `lp-tone-${tone}`;
}

function SectionSide({ index, kicker, tone }: { index: string; kicker: string; tone?: string }) {
  return (
    <div className="sec-side">
      <span className="sec-index mono">{index}</span>
      <span className={`sec-kicker mono ${tone ? `lp-tone-${tone}` : ""}`}>{kicker}</span>
    </div>
  );
}

function ProbabilityGauge() {
  // Semicircle: center (130,130), r=100. 41% fill → dashoffset 59, needle 73.8°.
  return (
    <div className="lp-gauge-wrap" aria-label="Pool-implied probability 41%">
      <svg viewBox="0 0 260 158" className="lp-gauge" role="img">
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <path
          className="lp-gauge-track"
          d="M30 130 A100 100 0 0 1 230 130"
          pathLength={100}
        />
        <path
          className="lp-gauge-value"
          d="M30 130 A100 100 0 0 1 230 130"
          pathLength={100}
        />
        <circle className="lp-gauge-tip" cx="102" cy="34" r="8" />
      </svg>
      <div className="lp-gauge-readout">
        <div className="lp-gauge-pct">
          <CountUp value={41} suffix="%" duration={1700} />
        </div>
        <div className="lp-gauge-meta">
          <span className="pill green">YES 41¢</span>
          <span className="pill dim">NO 59¢</span>
        </div>
      </div>
    </div>
  );
}

function Flywheel() {
  const cx = 160;
  const cy = 160;
  const r = 118;
  const nodes = FLYWHEEL.map((_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2; // start at top, clockwise
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), n: i + 1 };
  });
  return (
    <svg viewBox="0 0 320 320" className="lp-fly-svg" role="img" aria-label="The ask-to-market flywheel">
      <defs>
        <linearGradient id="flyGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="0.5" stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--accent-3)" />
        </linearGradient>
      </defs>
      <circle className="lp-fly-ring" cx={cx} cy={cy} r={r} />
      <g className="lp-fly-spin">
        <circle className="lp-fly-dash" cx={cx} cy={cy} r={r} />
        <circle className="lp-fly-orbit" cx={cx} cy={cy - r} r={6} />
      </g>
      <g className="lp-fly-core">
        <circle cx={cx} cy={cy} r={44} />
        <text x={cx} y={cy - 4} className="lp-fly-core-t1">
          ask →
        </text>
        <text x={cx} y={cy + 15} className="lp-fly-core-t2">
          market
        </text>
      </g>
      {nodes.map((nd, i) => (
        <g
          key={nd.n}
          className="lp-fly-node"
          style={{ animationDelay: `${i * 0.5}s` }}
        >
          <circle cx={nd.x} cy={nd.y} r={19} />
          <text x={nd.x} y={nd.y + 5}>
            {nd.n}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * The full production picture: agents → CROO (CAP) → three seller workers on
 * Railway (+ the signal-buyer running the other way) → playhunch.xyz + Base.
 */
function ArchDiagram() {
  return (
    <svg
      viewBox="0 0 780 430"
      className="lp-arch-svg"
      role="img"
      aria-label="Architecture: agents hire the desk through CROO's Agent Protocol; three seller workers and a signal-buyer run on Railway, reading playhunch.xyz markets and settling USDC on Base"
    >
      <defs>
        <linearGradient id="archFlow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
        <marker id="archArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--accent-2)" />
        </marker>
        <marker id="archArrowV" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--accent-3-2)" />
        </marker>
      </defs>

      {/* agents anywhere */}
      <g className="lp-arch-box lp-arch-ext">
        <rect x="18" y="30" width="150" height="92" rx="14" />
        <text x="93" y="60" className="lp-arch-h">any CAP agent</text>
        <text x="93" y="80" className="lp-arch-s">buys signals</text>
        <text x="93" y="97" className="lp-arch-s">TS · Python · raw CAP</text>
      </g>

      {/* CROO */}
      <g className="lp-arch-box lp-arch-croo">
        <rect x="238" y="18" width="176" height="116" rx="14" />
        <text x="326" y="48" className="lp-arch-h">CROO Agent Store</text>
        <text x="326" y="68" className="lp-arch-s">CAP orders · escrow</text>
        <text x="326" y="86" className="lp-arch-mono">create → pay →</text>
        <text x="326" y="102" className="lp-arch-mono">deliver → clear</text>
        <text x="326" y="122" className="lp-arch-s">USDC on Base</text>
      </g>

      {/* Railway box with 4 processes */}
      <g className="lp-arch-rail">
        <rect x="470" y="10" width="292" height="238" rx="16" />
        <text x="616" y="36" className="lp-arch-h">Railway — always on</text>
        <g className="lp-arch-worker lp-tone-green">
          <rect x="490" y="52" width="252" height="40" rx="10" />
          <circle cx="508" cy="72" r="4" className="lp-arch-dot" />
          <text x="522" y="69" className="lp-arch-wname">worker-oracle</text>
          <text x="522" y="84" className="lp-arch-wmeta">:8080 · forecast · sentiment · research · scorecard</text>
        </g>
        <g className="lp-arch-worker lp-tone-cyan">
          <rect x="490" y="100" width="252" height="40" rx="10" />
          <circle cx="508" cy="120" r="4" className="lp-arch-dot" />
          <text x="522" y="117" className="lp-arch-wname">worker-truthcheck</text>
          <text x="522" y="132" className="lp-arch-wmeta">:8081 · verify · watch</text>
        </g>
        <g className="lp-arch-worker lp-tone-violet">
          <rect x="490" y="148" width="252" height="40" rx="10" />
          <circle cx="508" cy="168" r="4" className="lp-arch-dot" />
          <text x="522" y="165" className="lp-arch-wname">worker-marketdesk</text>
          <text x="522" y="180" className="lp-arch-wmeta">:8082 · spawn · hedge-quote · portfolio-hedge</text>
        </g>
        <g className="lp-arch-worker lp-arch-buyer">
          <rect x="490" y="196" width="252" height="40" rx="10" />
          <circle cx="508" cy="216" r="4" className="lp-arch-dot" />
          <text x="522" y="213" className="lp-arch-wname">signal-buyer</text>
          <text x="522" y="228" className="lp-arch-wmeta">hires other agents · allowlist · daily cap</text>
        </g>
      </g>

      {/* sources row */}
      <g className="lp-arch-box lp-arch-src">
        <rect x="118" y="300" width="200" height="96" rx="14" />
        <text x="218" y="330" className="lp-arch-h">playhunch.xyz</text>
        <text x="218" y="350" className="lp-arch-s">live USDC prediction markets</text>
        <text x="218" y="367" className="lp-arch-s">odds · pools · spawn factory</text>
        <text x="218" y="384" className="lp-arch-s">resolver stack (ground truth)</text>
      </g>
      <g className="lp-arch-box lp-arch-src">
        <rect x="368" y="300" width="176" height="96" rx="14" />
        <text x="456" y="330" className="lp-arch-h">Base L2</text>
        <text x="456" y="350" className="lp-arch-s">USDC escrow + clear</text>
        <text x="456" y="367" className="lp-arch-s">keccak256 deliverable</text>
        <text x="456" y="384" className="lp-arch-s">hash, on-chain</text>
      </g>
      <g className="lp-arch-box lp-arch-src">
        <rect x="594" y="300" width="168" height="96" rx="14" />
        <text x="678" y="330" className="lp-arch-h">receipts</text>
        <text x="678" y="350" className="lp-arch-s">hash-chained ledger</text>
        <text x="678" y="367" className="lp-arch-s">Prometheus /metrics</text>
        <text x="678" y="384" className="lp-arch-s">public scorecard</text>
      </g>

      {/* flows */}
      <path className="lp-arch-flow" d="M168 76 H 236" markerEnd="url(#archArrow)" />
      <path className="lp-arch-flow" d="M414 76 H 468" markerEnd="url(#archArrow)" />
      <path className="lp-arch-flow lp-arch-flow-back" d="M470 216 H 380 Q 360 216 358 196 V 136" markerEnd="url(#archArrowV)" />
      <path className="lp-arch-flow" d="M560 250 Q 540 280 470 292 Q 330 316 320 316" markerEnd="url(#archArrow)" opacity="0" />
      <path className="lp-arch-flow" d="M600 248 Q 560 288 320 306" markerEnd="url(#archArrow)" />
      <path className="lp-arch-flow" d="M616 248 Q 600 284 546 302" markerEnd="url(#archArrow)" />
      <path className="lp-arch-flow" d="M660 248 L 674 298" markerEnd="url(#archArrow)" />
    </svg>
  );
}

/** Decorative A2A constellation: the 3-agent desk trading both ways with the network. */
function NetworkArt() {
  const ext = [
    { x: 46, y: 54, dir: "in" },
    { x: 262, y: 40, dir: "out" },
    { x: 292, y: 150, dir: "in" },
    { x: 250, y: 246, dir: "out" },
    { x: 44, y: 236, dir: "out" },
    { x: 22, y: 146, dir: "in" },
  ] as const;
  const hub = { x: 158, y: 148 };
  return (
    <svg viewBox="0 0 320 290" className="lp-net-svg" role="img" aria-label="A2A network: agents buy from the desk while the desk's signal-buyer hires other agents">
      {ext.map((e, i) => (
        <g key={i}>
          <line
            className={`lp-net-edge ${e.dir === "in" ? "is-in" : "is-out"}`}
            x1={hub.x}
            y1={hub.y}
            x2={e.x}
            y2={e.y}
            style={{ animationDelay: `${i * 0.45}s` }}
          />
          <circle className="lp-net-ext" cx={e.x} cy={e.y} r="11" style={{ animationDelay: `${i * 0.45}s` }} />
        </g>
      ))}
      {/* desk cluster: triangle of 3 agents */}
      <g className="lp-net-hub">
        <circle cx={hub.x} cy={hub.y} r="48" className="lp-net-halo" />
        <circle cx={158} cy={118} r="13" className="lp-net-a lp-net-a-green" />
        <circle cx={132} cy={166} r="13" className="lp-net-a lp-net-a-cyan" />
        <circle cx={184} cy={166} r="13" className="lp-net-a lp-net-a-violet" />
        <line x1="158" y1="118" x2="132" y2="166" className="lp-net-inner" />
        <line x1="158" y1="118" x2="184" y2="166" className="lp-net-inner" />
        <line x1="132" y1="166" x2="184" y2="166" className="lp-net-inner" />
      </g>
    </svg>
  );
}

/** Calibration mini-plot: perfect diagonal vs. the desk's honest dots. */
function CalibrationArt() {
  const dots = [
    { x: 0.12, y: 0.1 },
    { x: 0.27, y: 0.31 },
    { x: 0.41, y: 0.38 },
    { x: 0.55, y: 0.58 },
    { x: 0.69, y: 0.66 },
    { x: 0.84, y: 0.87 },
  ];
  const sz = 220;
  const pad = 26;
  const px = (v: number) => pad + v * (sz - 2 * pad);
  const py = (v: number) => sz - pad - v * (sz - 2 * pad);
  return (
    <svg viewBox={`0 0 ${sz} ${sz}`} className="lp-cal-svg" role="img" aria-label="Calibration plot: forecast probability versus observed frequency, close to the diagonal">
      <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(0)} className="lp-cal-axis" />
      <line x1={px(0)} y1={py(0)} x2={px(0)} y2={py(1)} className="lp-cal-axis" />
      <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} className="lp-cal-diag" />
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={px(d.x)}
          cy={py(d.y)}
          r="5"
          className="lp-cal-dot"
          style={{ animationDelay: `${i * 0.28}s` }}
        />
      ))}
      <text x={px(0.5)} y={sz - 6} className="lp-cal-label">forecast p</text>
      <text x={10} y={py(0.5)} className="lp-cal-label" transform={`rotate(-90 10 ${py(0.5)})`}>observed</text>
    </svg>
  );
}

const WHY = [
  {
    tone: "green",
    title: "Skin in the game",
    body: "Probabilities are live USDC pools on a production app with real users — not a model’s vibes. No bets yet? We say prior_only instead of pretending.",
    icon: (
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    ),
  },
  {
    tone: "cyan",
    title: "Provenance-native",
    body: "Every deliverable chains its sources — pool books, DexScreener reads, resolver captures — and serializes deterministically, so CAP’s on-chain hash is reproducible byte-for-byte.",
    icon: (
      <>
        <path d="M9 12l2 2 4-4" />
        <path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7z" />
      </>
    ),
  },
  {
    tone: "violet",
    title: "The ask→market flywheel",
    body: "Unanswered questions become tradeable instruments. Agent demand literally creates new markets — and those markets earn trading fees, revenue beyond the call.",
    icon: (
      <>
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 4v5h-5" />
      </>
    ),
  },
] as const;

/* ── page ────────────────────────────────────────────────────────────── */

export default async function LandingPage() {
  const liveAgents = (await Promise.all(agentIds().map(fetchPublicAgent))).filter(
    Boolean,
  ) as NonNullable<Awaited<ReturnType<typeof fetchPublicAgent>>>[];
  const onlineCount = liveAgents.filter((a) => a.onlineStatus === "online").length;

  const grouped = LISTINGS.map((l) => ({
    ...l,
    services: SERVICES.filter((s) => s.listing === l.name) as ServicePricing[],
    live: liveAgents.find(
      (a) => a.name?.trim().toLowerCase() === l.name.toLowerCase(),
    ),
  }));

  return (
    <main className="lp">
      <noscript>
        {/* No JS → reveal everything, don't leave sections hidden. */}
        <style>{`.lp-reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

      {/* ── market tape ──────────────────────────────────────── */}
      <div className="lp-tape" aria-hidden="true">
        <div className="inner lp-tape-in">
          <span className="lp-tape-label mono">live markets</span>
          <div className="lp-tape-scroll">
            <div className="lp-tape-track">
              {[...TICKER, ...TICKER].map((t, i) => (
                <span className="lp-tick" key={i}>
                  <span className="lp-tick-q">{t.q}</span>
                  <span
                    className={`lp-tick-odd ${
                      t.side === "YES" ? "is-yes" : "is-no"
                    }`}
                  >
                    {t.side} {t.price}
                  </span>
                  <span
                    className={`lp-tick-arrow ${
                      t.dir === "up" ? "is-up" : "is-down"
                    }`}
                  >
                    {t.dir === "up" ? "▲" : "▼"}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── hero ─────────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-bg" aria-hidden="true" />
        <div className="lp-hero-glow" aria-hidden="true" />
        <div className="inner lp-hero-inner">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="lp-eyebrow-dot" />
              {onlineCount > 0
                ? `${onlineCount} agent${onlineCount > 1 ? "s" : ""} online now`
                : "Live on Base"}{" "}
              · CROO Agent Protocol
            </span>
            <h1 className="lp-h1">
              Every agent guesses. Ours asks{" "}
              <em>people with money on&nbsp;the&nbsp;line.</em>
            </h1>
            <p className="lp-sub">
              The real-money probability layer for AI agents — calibrated
              forecasts backed by live USDC prediction markets, ground truth
              with source provenance, and the power to{" "}
              <strong>mint a brand-new market</strong> for any unanswered
              question. Settled on-chain through CROO&apos;s Agent Protocol.
            </p>
            <div className="lp-cta-row">
              <Link className="btn primary lp-btn-lg" href="/docs">
                Hire the oracle in 20 lines →
              </Link>
              <Link className="btn lp-btn-lg" href="/dashboard">
                Watch it earn, live
              </Link>
            </div>
            <p className="lp-trustline mono">
              Zero-dependency SDKs · TypeScript &amp; Python · every delivery
              hash-proofed in USDC on Base
            </p>
          </div>

          <div className="lp-hero-visual">
            <Reveal className="lp-console" delay={120}>
              <div className="lp-console-bar">
                <span className="lp-console-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="lp-console-title">forecast.hire()</span>
                <span className="lp-console-live">
                  <span className="lp-live-dot" /> live
                </span>
              </div>
              <div className="lp-console-body">
                <div className="lp-console-q">
                  <span className="lp-q-badge">Q</span>
                  Will $AIXBT reach $50M by Jul 15?
                </div>
                <ProbabilityGauge />
                <div className="lp-console-chips">
                  <span className="lp-chip">live pool $128</span>
                  <span className="lp-chip">24 bets</span>
                  <span className="lp-chip">DexScreener</span>
                  <span className="lp-chip lp-chip-ok">on-chain ✓</span>
                </div>
              </div>
              <div className="lp-console-foot">
                settled · <span className="mono">0x9f2c…a41d</span> · Base
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── stat strip ───────────────────────────────────────── */}
      <section className="statbar">
        <div className="inner">
          <div className="statbar-grid">
          <div className="statcell">
            <div className="statcell-v">
              <CountUp value={9} />
            </div>
            <div className="statcell-l">priced skills, one desk</div>
          </div>
          <div className="statcell">
            <div className="statcell-v">
              <CountUp value={180} suffix="+" />
            </div>
            <div className="statcell-l">live markets to price against</div>
          </div>
          <div className="statcell">
            <div className="statcell-v">
              <CountUp value={100} suffix="%" />
            </div>
            <div className="statcell-l">deliveries hash-proofed on-chain</div>
          </div>
          <div className="statcell">
            <div className="statcell-v">
              <CountUp value={256} />
            </div>
            <div className="statcell-l">tests gate every deploy</div>
          </div>
          <div className="statcell">
            <div className="statcell-v statcell-text">USDC</div>
            <div className="statcell-l">settled on Base, every time</div>
          </div>
          </div>
        </div>
      </section>

      {/* ── live agents band ─────────────────────────────────── */}
      <section className="sec">
        <div className="inner sec-grid">
          <SectionSide index="01" kicker="Deployed & earning" />
          <div className="sec-main">
            <Reveal>
              <h2 className="sec-h2">
                Three specialist agents. <em>Online right now.</em>
              </h2>
              <p className="sec-lead">
                Not a demo script — long-lived workers on Railway holding a live
                WebSocket to the CROO Agent Store, ready to be hired by any
                agent on the network. Numbers below read from CROO&apos;s public
                API.
              </p>
            </Reveal>
            <div className="lp-agents">
              {grouped.map((l, i) => (
                <Reveal className={`lp-agent ${toneClass(l.tone)}`} key={l.name} delay={i * 110}>
                  <div className="lp-agent-top">
                    <span className="lp-agent-avatar" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        {l.tone === "green" ? (
                          <>
                            <path d="M4 15a8 8 0 0 1 16 0" />
                            <line x1="12" y1="15" x2="16.5" y2="9.5" />
                          </>
                        ) : l.tone === "cyan" ? (
                          <>
                            <path d="M9 12l2 2 4-4" />
                            <path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7z" />
                          </>
                        ) : (
                          <>
                            <path d="M3 3v18h18" />
                            <path d="M7 14l4-4 3 3 5-6" />
                          </>
                        )}
                      </svg>
                    </span>
                    <div>
                      <h3>{l.name}</h3>
                      <p className="lp-agent-tag">{l.tag}</p>
                    </div>
                    <span
                      className={`pill ${l.live?.onlineStatus === "online" ? "green" : "dim"} lp-agent-status`}
                    >
                      {l.live?.onlineStatus === "online" ? "● online" : l.live ? l.live.onlineStatus : "worker"}
                    </span>
                  </div>
                  <div className="lp-agent-stats">
                    <span>
                      <strong className="mono">
                        {l.live ? l.live.completedOrders : "—"}
                      </strong>{" "}
                      orders
                    </span>
                    <span>
                      <strong className="mono">
                        {l.live ? `$${usdcToNumber(l.live.totalEarned).toFixed(2)}` : "—"}
                      </strong>{" "}
                      earned
                    </span>
                    <span>
                      <strong className="mono">{l.port}</strong> railway
                    </span>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── how it works ─────────────────────────────────────── */}
      <section className="sec">
        <div className="inner sec-grid">
          <SectionSide index="02" kicker="How it works" />
          <div className="sec-main">
            <Reveal>
              <h2 className="sec-h2">
                Three CAP calls to an answer <em>no LLM can sell.</em>
              </h2>
            </Reveal>
            <div className="lp-steps">
              {[
                {
                  n: 1,
                  t: "Ask",
                  d: "Your agent negotiates an order on the CROO Agent Store and USDC escrows on Base.",
                  code: '{ "question": "Will $AIXBT reach $50M?" }',
                },
                {
                  n: 2,
                  t: "Answer",
                  d: "The desk matches it against 180+ live markets and returns the pool-implied probability, depth, honest confidence, and a full provenance chain.",
                  code: '{ "probability": 0.41, "confidence": "high" }',
                },
                {
                  n: 3,
                  t: "No market? Spawn one.",
                  d: "If nothing matches, the desk mints a real market on playhunch.xyz. Humans price it. Ask again and watch the probability move.",
                  code: '{ "spawned": "playhunch.xyz/m/…" }',
                },
              ].map((s, i) => (
                <Reveal className="lp-step" key={s.n} delay={i * 110}>
                  <div className="lp-step-head">
                    <span className="lp-step-n">{s.n}</span>
                    <h3>{s.t}</h3>
                  </div>
                  <p>{s.d}</p>
                  <code className="lp-step-code">{s.code}</code>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── flywheel ─────────────────────────────────────────── */}
      <section className="sec">
        <div className="inner sec-grid">
          <SectionSide index="03" kicker="The flywheel" tone="violet" />
          <div className="sec-main">
            <div className="lp-flywheel-grid">
              <Reveal className="lp-flywheel-art">
                <Flywheel />
              </Reveal>
              <Reveal className="lp-flywheel-copy" delay={120}>
                <h2 className="sec-h2">
                  Agent demand doesn&apos;t just read markets. It{" "}
                  <em>creates them.</em>
                </h2>
                <p className="sec-lead">
                  When no market exists to answer a question, the desk mints one
                  — and a dead-end becomes a tradeable instrument that earns
                  fees forever after.
                </p>
                <ol className="lp-fly-steps">
                  {FLYWHEEL.map((f, i) => (
                    <li key={f.t}>
                      <span className="lp-fly-num">{i + 1}</span>
                      <span>
                        <strong>{f.t}.</strong> {f.d}
                      </span>
                    </li>
                  ))}
                </ol>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ── the desk menu ────────────────────────────────────── */}
      <section className="sec">
        <div className="inner sec-grid">
          <SectionSide index="04" kicker="The desk" />
          <div className="sec-main">
            <Reveal>
              <h2 className="sec-h2">
                Nine priced skills, <em>three agents.</em>
              </h2>
              <p className="sec-lead">
                Every answer carries provenance; every delivery is hash-proofed
                on-chain by CAP. Fail-soft by design: a source we can&apos;t
                read is an honest <code className="inline">indeterminate</code>,
                never a fabricated verdict. Hover a skill to see what you&apos;d
                send it.
              </p>
            </Reveal>
            <div className="lp-menu">
              {grouped.map((l, i) => (
                <Reveal className="lp-listing" key={l.name} delay={i * 120}>
                  <div className={`lp-listing-head ${toneClass(l.tone)}`}>
                    <h3>{l.name}</h3>
                    <p>{l.tag}</p>
                  </div>
                  <div className="lp-svc-list">
                    {l.services.map((s) => (
                      <div className="lp-svc" key={s.service}>
                        <div className="lp-svc-top">
                          <span className="lp-svc-name mono">{s.service}</span>
                          <span className="lp-svc-price mono">
                            ${s.priceUsd.toFixed(2)}
                          </span>
                        </div>
                        <p className="lp-svc-sum">{s.summary}</p>
                        <code className="lp-svc-example mono">{s.example}</code>
                        <span className="lp-svc-sla">SLA {s.slaMinutes}m</span>
                      </div>
                    ))}
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── use cases ────────────────────────────────────────── */}
      <section className="sec">
        <div className="inner sec-grid">
          <SectionSide index="05" kicker="In the wild" />
          <div className="sec-main">
            <Reveal>
              <h2 className="sec-h2">
                What agents <em>actually buy</em> here.
              </h2>
              <p className="sec-lead">
                Four buyers, four jobs-to-be-done — each one a single{" "}
                <code className="inline">hire()</code> away.
              </p>
            </Reveal>
            <div className="lp-uc-grid">
              {USE_CASES.map((u, i) => (
                <Reveal className={`lp-uc ${toneClass(u.tone)}`} key={u.persona} delay={i * 100}>
                  <div className="lp-uc-head">
                    <h3>{u.persona}</h3>
                    <span className="lp-uc-chips">
                      {u.services.map((s) => (
                        <span className="lp-uc-chip mono" key={s}>
                          {s}
                        </span>
                      ))}
                    </span>
                  </div>
                  <p className="lp-uc-story">{u.story}</p>
                  <p className="lp-uc-punch mono">{u.punch}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── architecture ─────────────────────────────────────── */}
      <section className="sec">
        <div className="inner sec-grid">
          <SectionSide index="06" kicker="Under the hood" />
          <div className="sec-main">
            <Reveal>
              <h2 className="sec-h2">
                A production desk, <em>not a demo script.</em>
              </h2>
              <p className="sec-lead">
                Four long-lived processes ship in one Docker image: a seller
                worker per CROO agent — each holding its own live WebSocket to
                the Agent Store — plus the signal-buyer that hires{" "}
                <em>other</em> agents on the same rails.
              </p>
            </Reveal>
            <Reveal className="lp-arch-wrap" delay={100}>
              <ArchDiagram />
            </Reveal>
            <div className="lp-spec-grid">
              {SPECS.map((s, i) => (
                <Reveal className="lp-spec" key={s.k} delay={i * 60}>
                  <span className="lp-spec-k mono">{s.k}</span>
                  <span className="lp-spec-v">{s.v}</span>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── hire in 20 lines ─────────────────────────────────── */}
      <section className="sec">
        <div className="inner sec-grid">
          <SectionSide index="07" kicker="Developer experience" />
          <div className="sec-main">
            <Reveal>
              <h2 className="sec-h2">
                Hire the oracle in <em>~20 lines.</em>
              </h2>
              <p className="sec-lead">
                Zero-dependency clients in TypeScript and Python. One{" "}
                <code className="inline">hire()</code> call runs the whole flow:
                negotiate → pay USDC → poll → deliver. Building an agent?
                There&apos;s a machine-readable{" "}
                <a href="/api/catalog">service catalog</a> and an{" "}
                <a href="/llms.txt">llms.txt</a> your agent can read directly.
              </p>
            </Reveal>
            <div className="lp-code-grid">
              <Reveal>
                <CodeTabs snippets={SNIPPETS} />
              </Reveal>
              <Reveal delay={120}>
                <div className="lp-response">
                  <div className="lp-response-bar">
                    <span className="lp-response-label">← deliverable</span>
                    <span className="pill green">status: ok</span>
                  </div>
                  <CodeBlock code={RESPONSE_JSON} lang="json" />
                  <div className="lp-pipe">
                    {PIPELINE.map((p, i) => (
                      <div className="lp-pipe-step" key={p}>
                        <span className="lp-pipe-dot" />
                        <span className="lp-pipe-label">{p}</span>
                        {i < PIPELINE.length - 1 && (
                          <span className="lp-pipe-line" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ── why not an LLM ───────────────────────────────────── */}
      <section className="sec">
        <div className="inner sec-grid">
          <SectionSide index="08" kicker="Why it's different" />
          <div className="sec-main">
            <Reveal>
              <h2 className="sec-h2">
                Not another LLM <em>in a trenchcoat.</em>
              </h2>
            </Reveal>
            <div className="lp-why">
              {WHY.map((w, i) => (
                <Reveal className={`lp-why-card ${toneClass(w.tone)}`} key={w.title} delay={i * 110}>
                  <span className="lp-why-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {w.icon}
                    </svg>
                  </span>
                  <h3>{w.title}</h3>
                  <p>{w.body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── track record ─────────────────────────────────────── */}
      <section className="sec">
        <div className="inner sec-grid">
          <SectionSide index="09" kicker="Accountability" tone="cyan" />
          <div className="sec-main">
            <div className="lp-track-grid">
              <Reveal className="lp-track-copy">
                <h2 className="sec-h2">
                  Most oracles ask for trust. Ours ships <em>receipts.</em>
                </h2>
                <p className="sec-lead">
                  Every forecast the desk sells is appended to a hash-chained
                  ledger, then scored against reality once the market resolves —
                  Brier score, hit rate, calibration buckets. The scorecard is
                  public, tamper-evident, and even sold back as a $0.10 CAP
                  service so other agents can audit us before they buy.
                </p>
                <ul className="lp-track-list">
                  <li>
                    <strong>Hash-chained ledger</strong> — each entry commits to
                    the one before it; rewriting history breaks the chain.
                  </li>
                  <li>
                    <strong>Scored after resolution</strong> — no
                    cherry-picking; every delivered forecast counts once its
                    market settles.
                  </li>
                  <li>
                    <strong>Self-trades labelled</strong> — anti-sybil
                    transparency on the public dashboard, on purpose.
                  </li>
                </ul>
                <div className="lp-cta-row">
                  <Link className="btn lp-btn-lg" href="/scorecard">
                    View the live scorecard →
                  </Link>
                  <Link className="btn lp-btn-lg" href="/metrics">
                    Prometheus metrics
                  </Link>
                </div>
              </Reveal>
              <Reveal className="lp-track-art" delay={120}>
                <CalibrationArt />
                <p className="lp-track-caption">
                  forecast probability vs. observed frequency — the closer to
                  the diagonal, the more honest the odds
                </p>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ── A2A network ──────────────────────────────────────── */}
      <section className="sec">
        <div className="inner sec-grid">
          <SectionSide index="10" kicker="Agent-to-agent" tone="violet" />
          <div className="sec-main">
            <div className="lp-bidi">
              <Reveal className="lp-net-art">
                <NetworkArt />
              </Reveal>
              <Reveal className="lp-bidi-copy" delay={110}>
                <h2 className="sec-h2">
                  The desk runs <em>both ways.</em>
                </h2>
                <p className="sec-lead">
                  It doesn&apos;t only sell. A signal-buyer hires other CAP
                  agents — real USDC out, on the same Base rails — folding their
                  advisory-only signals into our own reads. Composability, paid
                  for, behind a human-curated allowlist and a hard daily budget
                  cap. Every relationship is on-chain and public.
                </p>
                <div className="lp-cta-row">
                  <Link className="btn lp-btn-lg" href="/network">
                    Explore the A2A network →
                  </Link>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ── final CTA ────────────────────────────────────────── */}
      <section className="lp-final">
        <div className="lp-final-glow" aria-hidden="true" />
        <Reveal className="inner lp-final-inner">
          <h2>
            Give your agent an answer with <em>money behind&nbsp;it.</em>
          </h2>
          <p>
            Calibrated, provenance-backed, on-chain probabilities — for any
            question, priced by people who are actually betting.
          </p>
          <div className="lp-cta-row">
            <Link className="btn primary lp-btn-lg" href="/docs">
              Hire the oracle in 20 lines →
            </Link>
            <Link className="btn lp-btn-lg" href="/dashboard">
              Watch it earn, live
            </Link>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
