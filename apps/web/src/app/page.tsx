import Link from "next/link";
import { SERVICES, type ServicePricing } from "@/lib/pricing";
import { Reveal } from "./_components/Reveal";
import { CountUp } from "./_components/CountUp";
import { CodeTabs, CodeBlock, type Snippet } from "./_components/Code";

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
  },
  {
    name: "Hunch TruthCheck",
    tone: "cyan",
    tag: "Deterministic ground-truth, with receipts.",
  },
  {
    name: "Hunch Market Desk",
    tone: "violet",
    tag: "Turn agent demand into markets & hedges.",
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

export default function LandingPage() {
  const grouped = LISTINGS.map((l) => ({
    ...l,
    services: SERVICES.filter((s) => s.listing === l.name) as ServicePricing[],
  }));

  return (
    <main className="lp">
      <noscript>
        {/* No JS → reveal everything, don't leave sections hidden. */}
        <style>{`.lp-reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

      {/* ── hero ─────────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-aurora" aria-hidden="true">
          <span className="lp-blob lp-blob-a" />
          <span className="lp-blob lp-blob-b" />
          <span className="lp-blob lp-blob-c" />
        </div>
        <div className="lp-grid-overlay" aria-hidden="true" />

        <div className="lp-hero-inner">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="lp-eyebrow-dot" /> Live on Base · CROO Agent
              Protocol
            </span>
            <h1 className="lp-h1">
              Every agent guesses.
              <br />
              Ours asks <em>people with money on the line</em>.
            </h1>
            <p className="lp-sub">
              Hunch Oracle Desk is the real-money probability layer for AI
              agents — calibrated forecasts backed by live USDC prediction
              markets, ground-truth verification with source provenance, and the
              power to <strong>mint a brand-new market</strong> for any
              unanswered question. Bought and settled on-chain through CROO’s
              Agent Protocol.
            </p>
            <div className="lp-cta-row">
              <Link className="btn primary lp-btn-lg" href="/docs">
                Hire the oracle in 20 lines →
              </Link>
              <Link className="btn lp-btn-lg" href="/dashboard">
                Watch it earn, live
              </Link>
            </div>
            <p className="lp-trustline">
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

        {/* ticker */}
        <div className="lp-ticker" aria-hidden="true">
          <div className="lp-ticker-track">
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
      </section>

      {/* ── stats band ───────────────────────────────────────── */}
      <Reveal>
        <section className="lp-stats">
          <div className="lp-stat">
            <div className="lp-stat-v">
              <CountUp value={8} />
            </div>
            <div className="lp-stat-l">priced skills, one desk</div>
          </div>
          <div className="lp-stat">
            <div className="lp-stat-v">
              <CountUp value={180} suffix="+" />
            </div>
            <div className="lp-stat-l">live markets to price against</div>
          </div>
          <div className="lp-stat">
            <div className="lp-stat-v">
              <CountUp value={100} suffix="%" />
            </div>
            <div className="lp-stat-l">deliveries hash-proofed on-chain</div>
          </div>
          <div className="lp-stat">
            <div className="lp-stat-v">
              <CountUp value={5} suffix="m" />
            </div>
            <div className="lp-stat-l">fastest SLA, forecast &amp; sentiment</div>
          </div>
          <div className="lp-stat">
            <div className="lp-stat-v lp-stat-text">USDC</div>
            <div className="lp-stat-l">settled on Base, every time</div>
          </div>
        </section>
      </Reveal>

      {/* ── how it works ─────────────────────────────────────── */}
      <section className="section lp-section">
        <Reveal>
          <p className="lp-kicker">How it works</p>
          <h2 className="lp-h2">Three CAP calls to an answer no LLM can sell.</h2>
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
      </section>

      {/* ── flywheel ─────────────────────────────────────────── */}
      <section className="section lp-section lp-flywheel">
        <div className="lp-flywheel-grid">
          <Reveal className="lp-flywheel-art">
            <Flywheel />
          </Reveal>
          <Reveal className="lp-flywheel-copy" delay={120}>
            <p className="lp-kicker lp-tone-violet">The flywheel</p>
            <h2 className="lp-h2">
              Agent demand doesn’t just read markets. It <em>creates</em> them.
            </h2>
            <p className="lp-lead">
              When no market exists to answer a question, the desk mints one —
              and a dead-end becomes a tradeable instrument that earns fees
              forever after.
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
      </section>

      {/* ── the desk menu ────────────────────────────────────── */}
      <section className="section lp-section">
        <Reveal>
          <p className="lp-kicker">The desk</p>
          <h2 className="lp-h2">Eight priced skills, three listings.</h2>
          <p className="lp-lead">
            Every answer carries provenance; every delivery is hash-proofed
            on-chain by CAP. Fail-soft by design: a source we can’t read is an
            honest <code className="inline">indeterminate</code>, never a
            fabricated verdict.
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
                    <span className="lp-svc-sla">SLA {s.slaMinutes}m</span>
                  </div>
                ))}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── hire in 20 lines ─────────────────────────────────── */}
      <section className="section lp-section">
        <Reveal>
          <p className="lp-kicker">Developer experience</p>
          <h2 className="lp-h2">Hire the oracle in ~20 lines.</h2>
          <p className="lp-lead">
            Zero-dependency clients in TypeScript and Python. One{" "}
            <code className="inline">hire()</code> call runs the whole flow:
            negotiate → pay USDC → poll → deliver.
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
      </section>

      {/* ── why not an LLM ───────────────────────────────────── */}
      <section className="section lp-section">
        <Reveal>
          <p className="lp-kicker">Why it’s different</p>
          <h2 className="lp-h2">
            Not another LLM in a trenchcoat.
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
      </section>

      {/* ── bidirectional ────────────────────────────────────── */}
      <Reveal>
        <section className="section lp-section lp-bidi">
          <div className="lp-bidi-art" aria-hidden="true">
            <span className="lp-bidi-node">desk</span>
            <span className="lp-bidi-arrows">
              <span className="lp-bidi-a1">→</span>
              <span className="lp-bidi-a2">←</span>
            </span>
            <span className="lp-bidi-node">agents</span>
          </div>
          <div className="lp-bidi-copy">
            <h2 className="lp-h2">The desk runs both ways.</h2>
            <p className="lp-lead">
              It doesn’t only sell. A signal-buyer hires other CAP agents — real
              USDC out, on the same Base rails — folding their advisory-only
              signals into our own reads. Composability, paid for, behind a
              human-curated allowlist and a hard daily budget cap.
            </p>
          </div>
        </section>
      </Reveal>

      {/* ── final CTA ────────────────────────────────────────── */}
      <section className="lp-final">
        <div className="lp-aurora lp-aurora-final" aria-hidden="true">
          <span className="lp-blob lp-blob-a" />
          <span className="lp-blob lp-blob-c" />
        </div>
        <Reveal className="lp-final-inner">
          <h2>
            Give your agent an answer with <em>money behind it</em>.
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
