import { computeScorecard, readLedger, type LedgerEntry } from "@/lib/scorecard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function shortHash(hash: string | null): string {
  return hash ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : "—";
}

function outcomeLabel(entry: LedgerEntry): { text: string; cls: string } {
  if (!entry.resolution) return { text: "pending", cls: "dim" };
  return entry.resolution.hit
    ? { text: `hit · ${entry.resolution.outcomeKey}`, cls: "green" }
    : { text: `miss · ${entry.resolution.outcomeKey}`, cls: "amber" };
}

export default async function ScorecardPage() {
  const records = readLedger();
  const card = computeScorecard(records);
  const populated = card.calibration.filter((b) => b.n > 0);

  return (
    <main>
      <section className="hero" style={{ padding: "48px 0 32px" }}>
        <h1 style={{ fontSize: "34px" }}>
          The desk you can <em>audit</em>
        </h1>
        <p className="sub" style={{ fontSize: "15.5px" }}>
          Every forecast this desk sells is recorded to an append-only,
          hash-chained ledger, then scored against the market&apos;s real
          resolution. Only <strong>resolved</strong> markets count toward the
          score — pending ones are listed but never inflate the numbers. Don&apos;t
          trust, verify — turned on the oracle itself.
        </p>
      </section>

      {card.total === 0 ? (
        <section className="section" style={{ paddingTop: 24 }}>
          <div className="card">
            <p>
              No forecasts recorded yet. The track record turns on when the worker
              runs with <span className="mono">ORACLE_LEDGER_PATH</span> set: each
              delivered <span className="mono">forecast</span> is appended here and
              scored once its market resolves. Try it credential-free with{" "}
              <span className="mono">pnpm --filter @hunch/oracle smoke:scorecard</span>.
            </p>
          </div>
        </section>
      ) : (
        <>
          <section className="grid cols-4" style={{ paddingBottom: 40 }}>
            <div className="stat">
              <div className="label">Forecasts sold</div>
              <div className="value">{card.total}</div>
              <div className="hint">{card.pending} still pending resolution</div>
            </div>
            <div className="stat">
              <div className="label">Brier score</div>
              <div className="value accent">{card.meanBrier.toFixed(4)}</div>
              <div className="hint">0 = perfect · 0.25 = coin-flip</div>
            </div>
            <div className="stat">
              <div className="label">Resolved &amp; scored</div>
              <div className="value">{card.resolved}</div>
              <div className="hint">log loss {card.meanLogLoss.toFixed(3)}</div>
            </div>
            <div className="stat">
              <div className="label">Predicted-outcome rate</div>
              <div className="value">{Math.round(card.hitRate * 100)}%</div>
              <div className="hint">called outcome occurred</div>
            </div>
          </section>

          <section className="section" style={{ paddingTop: 24 }}>
            <h2>Calibration</h2>
            <p className="lead">
              A well-calibrated desk&apos;s predicted probability matches the
              observed rate in every bucket. Bars show the observed hit rate;
              &ldquo;predicted&rdquo; is the desk&apos;s mean probability for that
              bucket. Resolved forecasts only.
            </p>
            {populated.length === 0 ? (
              <div className="card">
                <p>No markets have resolved yet — calibration appears once they do.</p>
              </div>
            ) : (
              <div className="card">
                {populated.map((b) => (
                  <div key={b.lo} style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 13,
                        marginBottom: 4,
                      }}
                      className="mono"
                    >
                      <span>
                        {Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}%
                      </span>
                      <span style={{ color: "var(--text-faint)" }}>
                        predicted {Math.round(b.predictedMean * 100)}% · observed{" "}
                        {Math.round(b.observedRate * 100)}% · n={b.n}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 10,
                        borderRadius: 5,
                        background: "var(--surface-2, #1a1a1a)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round(b.observedRate * 100)}%`,
                          height: "100%",
                          background: "var(--accent, #6ee7b7)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="section">
            <h2>Recent forecasts</h2>
            <p className="lead">
              The tail of the ledger. Each row is a forecast the desk sold; its{" "}
              <span className="mono">entryHash</span> chains to the previous one,
              so nothing can be edited after the fact.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Called</th>
                    <th>Prob</th>
                    <th>Outcome</th>
                    <th>Proof</th>
                    <th>Entry</th>
                  </tr>
                </thead>
                <tbody>
                  {card.recent.map((e) => {
                    const o = outcomeLabel(e);
                    return (
                      <tr key={e.entryHash}>
                        <td>
                          {e.marketUrl ? (
                            <a href={e.marketUrl} target="_blank" rel="noreferrer">
                              {e.question || e.marketSlug}
                            </a>
                          ) : (
                            e.question || e.marketSlug
                          )}
                        </td>
                        <td className="mono">{e.predictedOutcomeKey}</td>
                        <td className="mono">{Math.round(e.probability * 100)}%</td>
                        <td>
                          <span className={`pill ${o.cls}`}>{o.text}</span>
                        </td>
                        <td className="mono">
                          {e.resolution?.proofUrl ? (
                            <a href={e.resolution.proofUrl} target="_blank" rel="noreferrer">
                              proof
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="mono" title={e.entryHash}>
                          {e.entryHash.slice(0, 8)}…
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="section">
            <div className="card">
              <h3>Ledger head</h3>
              <p className="mono" style={{ wordBreak: "break-all", fontSize: 13 }}>
                {shortHash(card.headHash)}
              </p>
              <p style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 8 }}>
                Pin this hash. Re-request the <span className="mono">scorecard</span>{" "}
                service later — the head still covers this exact history, or the
                chain is broken. That&apos;s the audit.
              </p>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
