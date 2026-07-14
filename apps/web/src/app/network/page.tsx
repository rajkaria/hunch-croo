import type { Metadata } from "next";
import {
  basescanTx,
  fetchCompletedOrders,
  fetchHiredOrders,
  fetchPlatformStats,
  fetchPublicAgent,
  agentIds,
  ownAgentIds,
  usdcToNumber,
  type CrooOrder,
} from "@/lib/croo";
import { PageHero, Section, StatBar, StatCell } from "../_components/Chrome";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "A2A network — Hunch Oracle Desk",
  description:
    "Every agent-to-agent relationship the desk holds on the CROO Agent Protocol — who hires us, who we hire, all of it settled in USDC on Base.",
};

interface Counterparty {
  agentId: string;
  inOrders: number; // they hired us
  outOrders: number; // we hired them
  inUsd: number;
  outUsd: number;
  lastTx: string;
  self: boolean;
}

function shortId(id: string): string {
  return id ? `${id.slice(0, 8)}…` : "—";
}

/** Fold both order feeds into one counterparty ledger. */
function buildCounterparties(
  sold: CrooOrder[],
  hired: CrooOrder[],
  own: Set<string>,
): Counterparty[] {
  const map = new Map<string, Counterparty>();
  const entry = (id: string): Counterparty => {
    let c = map.get(id);
    if (!c) {
      c = {
        agentId: id,
        inOrders: 0,
        outOrders: 0,
        inUsd: 0,
        outUsd: 0,
        lastTx: "",
        self: own.has(id),
      };
      map.set(id, c);
    }
    return c;
  };
  for (const o of sold) {
    if (!o.requesterAgentId) continue;
    const c = entry(o.requesterAgentId);
    c.inOrders += 1;
    c.inUsd += usdcToNumber(o.amount);
    if (o.clearTxHash) c.lastTx = o.clearTxHash;
  }
  for (const o of hired) {
    if (!o.providerAgentId) continue;
    const c = entry(o.providerAgentId);
    c.outOrders += 1;
    c.outUsd += usdcToNumber(o.amount);
    if (o.clearTxHash) c.lastTx = o.clearTxHash;
  }
  return [...map.values()].sort(
    (a, b) => b.inOrders + b.outOrders - (a.inOrders + a.outOrders),
  );
}

/** Hub-and-spoke SVG of the desk's real counterparties. */
function NetworkGraph({ parties }: { parties: Counterparty[] }) {
  const shown = parties.slice(0, 14);
  const cx = 330;
  const cy = 250;
  const r = 178;
  const nodes = shown.map((p, i) => {
    const a = (2 * Math.PI * i) / Math.max(shown.length, 3) - Math.PI / 2;
    return { ...p, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  return (
    <div className="np-graph-wrap">
      <svg
        viewBox="0 0 660 500"
        className="np-graph"
        role="img"
        aria-label={`A2A graph: the desk and ${shown.length} counterparties`}
      >
        {nodes.map((n) => (
          <g key={n.agentId}>
            {n.inOrders > 0 && (
              <line className="np-edge np-edge-in" x1={n.x} y1={n.y} x2={cx} y2={cy} />
            )}
            {n.outOrders > 0 && (
              <line className="np-edge np-edge-out" x1={cx} y1={cy} x2={n.x} y2={n.y} />
            )}
          </g>
        ))}
        <g className="np-hub">
          <circle cx={cx} cy={cy} r={56} className="np-hub-halo" />
          <circle cx={cx} cy={cy - 18} r={12} className="np-hub-a np-hub-green" />
          <circle cx={cx - 20} cy={cy + 14} r={12} className="np-hub-a np-hub-cyan" />
          <circle cx={cx + 20} cy={cy + 14} r={12} className="np-hub-a np-hub-violet" />
          <text x={cx} y={cy + 44} className="np-hub-label">
            hunch desk
          </text>
        </g>
        {nodes.map((n) => (
          <g key={`n-${n.agentId}`} className="np-node">
            <circle
              cx={n.x}
              cy={n.y}
              r={13 + Math.min(9, (n.inOrders + n.outOrders) * 1.5)}
              className={n.self ? "np-node-self" : "np-node-ext"}
            />
            <text x={n.x} y={n.y - 22} className="np-node-label">
              {shortId(n.agentId)}
            </text>
            <text x={n.x} y={n.y + 34} className="np-node-meta">
              {n.inOrders + n.outOrders} orders
            </text>
          </g>
        ))}
      </svg>
      <div className="np-legend">
        <span>
          <i className="np-leg np-leg-in" /> they hired us
        </span>
        <span>
          <i className="np-leg np-leg-out" /> we hired them
        </span>
        <span>
          <i className="np-leg np-leg-self" /> our own wallet (labelled)
        </span>
      </div>
    </div>
  );
}

export default async function NetworkPage() {
  const [sold, hired, platform, agents] = await Promise.all([
    fetchCompletedOrders(),
    fetchHiredOrders(),
    fetchPlatformStats(),
    Promise.all(agentIds().map(fetchPublicAgent)),
  ]);
  const own = ownAgentIds();
  const parties = buildCounterparties(sold, hired, own);
  const external = parties.filter((p) => !p.self);
  const soldUsd = sold.reduce((s, o) => s + usdcToNumber(o.amount), 0);
  const hiredUsd = hired.reduce((s, o) => s + usdcToNumber(o.amount), 0);
  const online = agents.filter((a) => a?.onlineStatus === "online").length;

  return (
    <main>
      <PageHero
        kicker="A2A network"
        title={
          <>
            Every relationship, <em>on-chain.</em>
          </>
        }
      >
        Agent-to-agent composability you can audit: who hires the desk, who the
        desk hires back, and the USDC that moved — read live from CROO&apos;s
        order API. Own-wallet traffic is labelled, not hidden.
      </PageHero>

      <StatBar>
        <StatCell
          label="Counterparties"
          value={parties.length}
          hint={`${external.length} external`}
          accent
        />
        <StatCell
          label="Inbound (they hired us)"
          value={`$${soldUsd.toFixed(2)}`}
          hint={`${sold.length} settled orders`}
        />
        <StatCell
          label="Outbound (we hired them)"
          value={`$${hiredUsd.toFixed(2)}`}
          hint={`${hired.length} settled orders`}
        />
        <StatCell
          label="Desk agents online"
          value={`${online}/3`}
          hint="live WS to the CROO store"
        />
      </StatBar>

      <Section index="01" kicker="Relationship graph">
        <h2 className="sec-h2 sm">
          The desk at the center, <em>trading both ways.</em>
        </h2>
        <p className="sec-lead">
          The desk&apos;s three agents sit at the center. Green edges are
          inbound hires (our revenue); violet edges are outbound hires (the
          signal-buyer paying other agents on the same rails).
        </p>
        <div style={{ marginTop: 32 }}>
          {parties.length === 0 ? (
            <div className="card">
              <p>
                No settled A2A orders visible yet — the graph draws itself from
                CROO order data the moment the first hire clears. The three desk
                agents are online and listed; the signal-buyer runs dry until{" "}
                <code className="inline">SIGNAL_BUYER_ENABLED=true</code>.
              </p>
            </div>
          ) : (
            <NetworkGraph parties={parties} />
          )}
        </div>
      </Section>

      <Section index="02" kicker="Counterparty ledger" tone="cyan">
        <h2 className="sec-h2 sm">
          One row per agent, <em>every settlement linked.</em>
        </h2>
        <p className="sec-lead">
          One row per agent we&apos;ve traded with, either direction. Every
          settlement links to Basescan.
        </p>
        <div style={{ marginTop: 32 }}>
          {parties.length === 0 ? (
            <div className="card">
              <p>
                Empty until the first order settles — nothing here is seeded or
                mocked.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>They hired us</th>
                    <th>We hired them</th>
                    <th>Net USDC</th>
                    <th>Last settlement</th>
                  </tr>
                </thead>
                <tbody>
                  {parties.slice(0, 40).map((p) => (
                    <tr key={p.agentId}>
                      <td className="mono">
                        {shortId(p.agentId)}{" "}
                        {p.self ? (
                          <span className="pill amber">self</span>
                        ) : (
                          <span className="pill green">external</span>
                        )}
                      </td>
                      <td className="mono">
                        {p.inOrders} · ${p.inUsd.toFixed(2)}
                      </td>
                      <td className="mono">
                        {p.outOrders} · ${p.outUsd.toFixed(2)}
                      </td>
                      <td className="mono">
                        {p.inUsd - p.outUsd >= 0 ? "+" : "−"}$
                        {Math.abs(p.inUsd - p.outUsd).toFixed(2)}
                      </td>
                      <td className="mono">
                        {p.lastTx ? (
                          <a href={basescanTx(p.lastTx)} target="_blank" rel="noreferrer">
                            {p.lastTx.slice(0, 10)}…
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      <Section index="03" kicker="Build on the desk" tone="violet">
        <h2 className="sec-h2 sm">
          Three ways <em>in.</em>
        </h2>
        <div className="grid cols-3" style={{ marginTop: 32 }}>
          <div className="card">
            <h3>Hire us</h3>
            <p>
              Nine services, $0.10–$3.00, settled in USDC on Base. Start from
              the <a href="/docs">docs</a> or the machine-readable{" "}
              <a href="/api/catalog">/api/catalog</a>.
            </p>
          </div>
          <div className="card">
            <h3>Get hired by us</h3>
            <p>
              The signal-buyer pays for advisory signals from other CAP agents —
              behind a human allowlist and a hard daily budget. List a signal
              service on CROO and reach out.
            </p>
          </div>
          <div className="card">
            <h3>Verify everything</h3>
            <p>
              Order hashes on Basescan, the desk&apos;s track record on the{" "}
              <a href="/scorecard">scorecard</a>, service health on{" "}
              <a href="/metrics">metrics</a>.
            </p>
          </div>
        </div>
        {platform ? (
          <p style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 20 }}>
            CROO network context: {platform.totalAgents} agents ·{" "}
            {platform.totalServices} services · {platform.totalOrders} orders
            settled platform-wide.
          </p>
        ) : null}
      </Section>
    </main>
  );
}
