import {
  basescanTx,
  fetchCompletedOrders,
  fetchHiredOrders,
  fetchPlatformStats,
  fetchPublicAgent,
  ownAgentIds,
  usdcToNumber,
} from "@/lib/croo";
import { fetchSpawnedMarkets } from "@/lib/hunch";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const AGENT_IDS = (
  process.env.CROO_AGENT_IDS ?? "013febe1-f57a-445d-95f4-adf2931bd2f9"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function shortHash(hash: string): string {
  return hash ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : "—";
}

function shortId(id: string): string {
  return id ? `${id.slice(0, 8)}…` : "—";
}

export default async function DashboardPage() {
  const [agents, platform, orders, spawned, hired] = await Promise.all([
    Promise.all(AGENT_IDS.map(fetchPublicAgent)),
    fetchPlatformStats(),
    fetchCompletedOrders(),
    fetchSpawnedMarkets(),
    fetchHiredOrders(),
  ]);
  const liveAgents = agents.filter(Boolean) as NonNullable<
    Awaited<ReturnType<typeof fetchPublicAgent>>
  >[];
  const own = ownAgentIds();

  // "Who we hired" (S8): completed orders where we are the requester. The
  // counterparty is the provider agent we paid — external ones are agents whose
  // counterparty count we seeded.
  const hiredSpendUsd = hired.reduce((sum, o) => sum + usdcToNumber(o.amount), 0);
  const externalCounterparties = new Set(
    hired.map((o) => o.providerAgentId).filter((id) => id && !own.has(id)),
  );

  const earnedUsd = liveAgents.reduce(
    (sum, agent) => sum + usdcToNumber(agent.totalEarned),
    0,
  );
  const completed = liveAgents.reduce(
    (sum, agent) => sum + Number.parseInt(agent.completedOrders || "0", 10),
    0,
  );
  const buyers = new Set(orders.map((o) => o.requesterAgentId).filter(Boolean));
  const externalBuyers = [...buyers].filter((id) => !own.has(id));
  const selfShare =
    orders.length === 0
      ? 0
      : Math.round(
          (orders.filter((o) => own.has(o.requesterAgentId)).length /
            orders.length) *
            100,
        );

  return (
    <main>
      <section className="hero" style={{ padding: "48px 0 32px" }}>
        <h1 style={{ fontSize: "34px" }}>
          Live desk — <em>real orders, real USDC, on Base</em>
        </h1>
        <p className="sub" style={{ fontSize: "15.5px" }}>
          Everything below reads from CROO&apos;s public Store API, our provider
          order feed, and playhunch.xyz — nothing is mocked. Self-trades are
          labelled: anti-sybil transparency on purpose.
        </p>
      </section>

      <section className="grid cols-4" style={{ paddingBottom: 40 }}>
        <div className="stat">
          <div className="label">USDC earned</div>
          <div className="value accent">${earnedUsd.toFixed(2)}</div>
          <div className="hint">across {liveAgents.length} listed agent(s)</div>
        </div>
        <div className="stat">
          <div className="label">Completed orders</div>
          <div className="value">{completed}</div>
          <div className="hint">
            avg delivery {liveAgents[0]?.avgDeliveryText ?? "—"}
          </div>
        </div>
        <div className="stat">
          <div className="label">Unique buyers</div>
          <div className="value">{buyers.size}</div>
          <div className="hint">{externalBuyers.length} external</div>
        </div>
        <div className="stat">
          <div className="label">Self-trade share</div>
          <div className="value">{selfShare}%</div>
          <div className="hint">own-wallet orders, labelled below</div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 40 }}>
        <h2>Order feed</h2>
        <p className="lead">
          Every CAP order our agents have completed — with all four Base
          transactions (create → pay → deliver → clear) verifiable on Basescan.
        </p>
        {orders.length === 0 ? (
          <div className="card">
            <p>
              No completed orders visible yet — the order feed reads the CROO API
              server-side with our provider keys.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Buyer agent</th>
                  <th>Amount</th>
                  <th>Delivered</th>
                  <th>Settlement</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 25).map((order) => (
                  <tr key={order.orderId}>
                    <td className="mono">
                      #{order.chainOrderId || shortId(order.orderId)}
                    </td>
                    <td className="mono">
                      {shortId(order.requesterAgentId)}{" "}
                      {own.has(order.requesterAgentId) ? (
                        <span className="pill amber">self</span>
                      ) : (
                        <span className="pill green">external</span>
                      )}
                    </td>
                    <td className="mono">
                      ${usdcToNumber(order.amount).toFixed(2)}
                    </td>
                    <td className="mono">
                      {order.deliveredAt
                        ? new Date(order.deliveredAt).toISOString().slice(0, 16).replace("T", " ")
                        : "—"}
                    </td>
                    <td className="mono">
                      {order.clearTxHash ? (
                        <a
                          href={basescanTx(order.clearTxHash)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shortHash(order.clearTxHash)}
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
      </section>

      <section className="section">
        <h2>Spawned markets</h2>
        <p className="lead">
          Real markets the desk has minted on playhunch.xyz through the
          production factory — agent demand becoming tradeable instruments.
        </p>
        {spawned.length === 0 ? (
          <div className="card">
            <p>No spawned markets yet.</p>
          </div>
        ) : (
          <div className="grid cols-3">
            {spawned.map((market) => (
              <div className="card" key={market.id}>
                <h3>
                  <a href={market.url} target="_blank" rel="noreferrer">
                    {market.question}
                  </a>
                </h3>
                <p>
                  {market.odds ? (
                    <>
                      <span className="pill green">
                        YES {market.odds.yesPriceCents}¢
                      </span>{" "}
                      <span className="pill dim">
                        NO {market.odds.noPriceCents}¢
                      </span>{" "}
                    </>
                  ) : null}
                  <span className="pill dim">${market.poolUsd} pool</span>{" "}
                  <span className="pill dim">{market.totalBets} bets</span>
                </p>
                <p style={{ marginTop: 8, fontSize: 13 }}>
                  closes {new Date(market.deadlineAt).toISOString().slice(0, 10)} ·{" "}
                  <span className="mono">{market.status}</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>Who we hired</h2>
        <p className="lead">
          The desk runs both ways. Our signal-buyer hires external CAP agents —
          real USDC out, on the same Base rails — and folds their (advisory-only)
          signals into our own reads. Every hire below seeds another agent&apos;s
          counterparty count: composability, paid for.
        </p>
        {hired.length === 0 ? (
          <div className="card">
            <p>
              No hires settled yet. The signal-buyer runs behind a human-curated
              allowlist and a hard daily budget cap; hires appear here the moment
              one clears, read from CROO&apos;s order API with our requester key.
            </p>
          </div>
        ) : (
          <>
            <p style={{ marginBottom: 16 }}>
              <span className="pill green">
                {externalCounterparties.size} external counterparties
              </span>{" "}
              <span className="pill dim">${hiredSpendUsd.toFixed(2)} paid out</span>{" "}
              <span className="pill dim">{hired.length} orders</span>
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Hired agent</th>
                    <th>Paid</th>
                    <th>Settlement</th>
                  </tr>
                </thead>
                <tbody>
                  {hired.slice(0, 25).map((order) => (
                    <tr key={order.orderId}>
                      <td className="mono">
                        #{order.chainOrderId || shortId(order.orderId)}
                      </td>
                      <td className="mono">
                        {shortId(order.providerAgentId)}{" "}
                        {own.has(order.providerAgentId) ? (
                          <span className="pill amber">self</span>
                        ) : (
                          <span className="pill green">external</span>
                        )}
                      </td>
                      <td className="mono">
                        ${usdcToNumber(order.amount).toFixed(2)}
                      </td>
                      <td className="mono">
                        {order.clearTxHash ? (
                          <a
                            href={basescanTx(order.clearTxHash)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shortHash(order.clearTxHash)}
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
          </>
        )}
      </section>

      <section className="section">
        <h2>Listed agents</h2>
        <div className="grid cols-3">
          {liveAgents.map((agent) => (
            <div className="card" key={agent.agentId}>
              <h3>
                {agent.name}{" "}
                <span
                  className={`pill ${agent.onlineStatus === "online" ? "green" : "dim"}`}
                >
                  {agent.onlineStatus}
                </span>
              </h3>
              <p>
                {agent.completedOrders} orders · $
                {usdcToNumber(agent.totalEarned).toFixed(2)} earned ·{" "}
                {agent.completionRate}% completion
              </p>
              <p style={{ marginTop: 8 }}>
                {(agent.services ?? []).map((service) => (
                  <span key={service.serviceId} className="pill dim" style={{ marginRight: 6 }}>
                    {service.name} ${usdcToNumber(service.price).toFixed(2)}
                  </span>
                ))}
              </p>
            </div>
          ))}
        </div>
        {platform ? (
          <p style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 16 }}>
            CROO network context: {platform.totalAgents} agents ·{" "}
            {platform.totalServices} services · {platform.totalOrders} orders
            settled platform-wide.
          </p>
        ) : null}
      </section>
    </main>
  );
}
