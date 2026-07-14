import { computeScorecard, readLedger, type LedgerEntry } from "@/lib/scorecard";
import { PageHero, Section, StatBar, StatCell } from "../_components/Chrome";

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
      <PageHero
        kicker="Track record"
        title={
          <>
            The desk you can <em>audit.</em>
          </>
        }
      >
        Every forecast this desk sells is recorded to an append-only,
        hash-chained ledger, then scored against the market&apos;s real
        resolution. Only <strong>resolved</strong> markets count toward the
        score — pending ones are listed but never inflate the numbers.
        Don&apos;t trust, verify — turned on the oracle itself.
      </PageHero>

      {card.total === 0 ? (
        <Section index="01" kicker="Ledger">
          <div className="card">
            <p>
              No forecasts recorded yet. The track record turns on when the
              worker runs with <span className="mono">ORACLE_LEDGER_PATH</span>{" "}
              set: each delivered <span className="mono">forecast</span> is
              appended here and scored once its market resolves. Try it
              credential-free with{" "}
              <span className="mono">
                pnpm --filter @hunch/oracle smoke:scorecard
              </span>
              .
            </p>
          </div>
        </Section>
      ) : (
        <>
          <StatBar>
            <StatCell
              label="Forecasts sold"
              value={card.total}
              hint={`${card.pending} still pending resolution`}
            />
            <StatCell
              label="Brier score"
              value={card.meanBrier.toFixed(4)}
              hint="0 = perfect · 0.25 = coin-flip"
              accent
            />
            <StatCell
              label="Resolved & scored"
              value={card.resolved}
              hint={`log loss ${card.meanLogLoss.toFixed(3)}`}
            />
            <StatCell
              label="Predicted-outcome rate"
              value={`${Math.round(card.hitRate * 100)}%`}
              hint="called outcome occurred"
            />
          </StatBar>

          <Section index="01" kicker="Calibration">
            <h2 className="sec-h2 sm">
              Predicted probability vs. <em>observed reality.</em>
            </h2>
            <p className="sec-lead">
              A well-calibrated desk&apos;s predicted probability matches the
              observed rate in every bucket. Bars show the observed hit rate;
              &ldquo;predicted&rdquo; is the desk&apos;s mean probability for
              that bucket. Resolved forecasts only.
            </p>
            <div style={{ marginTop: 32 }}>
              {populated.length === 0 ? (
                <div className="card">
                  <p>
                    No markets have resolved yet — calibration appears once they
                    do.
                  </p>
                </div>
              ) : (
                <div className="card">
                  {populated.map((b) => (
                    <div className="cal-row" key={b.lo}>
                      <div className="cal-row-meta">
                        <span>
                          {Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}%
                        </span>
                        <span className="faint">
                          predicted {Math.round(b.predictedMean * 100)}% ·
                          observed {Math.round(b.observedRate * 100)}% · n=
                          {b.n}
                        </span>
                      </div>
                      <div className="cal-bar">
                        <div
                          className="cal-bar-fill"
                          style={{
                            width: `${Math.round(b.observedRate * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>

          <Section index="02" kicker="Recent forecasts" tone="cyan">
            <h2 className="sec-h2 sm">
              The tail of the ledger, <em>tamper-evident.</em>
            </h2>
            <p className="sec-lead">
              Each row is a forecast the desk sold; its{" "}
              <span className="mono">entryHash</span> chains to the previous
              one, so nothing can be edited after the fact.
            </p>
            <div className="table-wrap" style={{ marginTop: 32 }}>
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
                            <a
                              href={e.resolution.proofUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
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
          </Section>

          <Section index="03" kicker="Ledger head" tone="violet">
            <div className="card">
              <h3>Ledger head</h3>
              <p className="mono" style={{ wordBreak: "break-all", fontSize: 13 }}>
                {shortHash(card.headHash)}
              </p>
              <p style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 8 }}>
                Pin this hash. Re-request the{" "}
                <span className="mono">scorecard</span> service later — the head
                still covers this exact history, or the chain is broken.
                That&apos;s the audit.
              </p>
            </div>
          </Section>
        </>
      )}
    </main>
  );
}
