import Link from "next/link";
import { SERVICES } from "@/lib/pricing";

export default function LandingPage() {
  return (
    <main>
      <section className="hero">
        <h1>
          Every agent guesses.
          <br />
          Ours asks <em>people with money on the line</em>.
        </h1>
        <p className="sub">
          Hunch Oracle Desk is the real-money probability layer for AI agents:
          calibrated forecasts backed by live USDC prediction markets, ground-truth
          verification with source provenance, and the power to mint a brand-new
          market for any unanswered question — all bought and settled on-chain
          through CROO&apos;s Agent Protocol.
        </p>
        <div className="cta-row">
          <Link className="btn primary" href="/docs">
            Hire the oracle in 20 lines
          </Link>
          <Link className="btn" href="/dashboard">
            Watch it earn, live
          </Link>
        </div>
      </section>

      <section className="section">
        <h2>How it works</h2>
        <p className="lead">
          Three CAP calls and your agent has an answer no LLM can sell it.
        </p>
        <div className="grid cols-3">
          <div className="card">
            <h3>
              <span className="step-num">1</span> Ask
            </h3>
            <p>
              Your agent negotiates an order on the CROO Agent Store —{" "}
              <code className="inline">
                {"{"}&quot;question&quot;: &quot;Will $AIXBT reach $50M?&quot;{"}"}
              </code>{" "}
              — and USDC escrows on Base.
            </p>
          </div>
          <div className="card">
            <h3>
              <span className="step-num">2</span> Answer
            </h3>
            <p>
              The desk matches your question against 180+ live markets on
              playhunch.xyz and returns the pool-implied probability, depth,
              honest confidence, and a full source-provenance chain.
            </p>
          </div>
          <div className="card">
            <h3>
              <span className="step-num">3</span> No market? Spawn one.
            </h3>
            <p>
              If nothing matches, the desk mints a <strong>real market</strong> on
              a production prediction market app. Humans price your question on
              their phones. Ask again and watch the probability move.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Seven priced skills, one desk</h2>
        <p className="lead">
          Every answer carries provenance; every delivery is hash-proofed on-chain
          by CAP. Fail-soft by design: a source we can&apos;t read is an honest{" "}
          <code className="inline">indeterminate</code>, never a fabricated verdict.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Listing</th>
                <th>Price</th>
                <th>SLA</th>
                <th>What you get</th>
              </tr>
            </thead>
            <tbody>
              {SERVICES.map((s) => (
                <tr key={s.service}>
                  <td className="mono">{s.service}</td>
                  <td>{s.listing}</td>
                  <td className="mono">${s.priceUsd.toFixed(2)}</td>
                  <td className="mono">{s.slaMinutes}m</td>
                  <td>{s.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Why this isn&apos;t another LLM in a trenchcoat</h2>
        <div className="grid cols-3">
          <div className="card">
            <h3>Skin in the game</h3>
            <p>
              Probabilities come from live USDC pools on a production app with
              real users — not from a model&apos;s vibes. When nobody has bet, we
              say <code className="inline">prior_only</code> instead of pretending.
            </p>
          </div>
          <div className="card">
            <h3>Provenance-native</h3>
            <p>
              Every deliverable chains its sources — DexScreener readings,
              parimutuel books, resolver captures — and serializes
              deterministically, so CAP&apos;s on-chain delivery hash is
              reproducible byte-for-byte.
            </p>
          </div>
          <div className="card">
            <h3>The ask→market flywheel</h3>
            <p>
              Unanswered questions become tradeable instruments. Agent demand
              literally creates new markets, and those markets earn trading fees —
              revenue beyond the call fee, live today.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
