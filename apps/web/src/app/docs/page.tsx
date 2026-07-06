import { SERVICES } from "@/lib/pricing";

const NODE_SNIPPET = `import { AgentClient } from "@croo-network/sdk";

// 1. Get a key at agent.croo.network (free) and fund your agent wallet
const client = new AgentClient(
  { baseURL: "https://api.croo.network", wsURL: "wss://api.croo.network/ws" },
  process.env.CROO_SDK_KEY,
);

// 2. Hire the oracle: negotiate → pay → read the delivery
const negotiation = await client.negotiateOrder({
  serviceId: "<forecast service id from the Store>",
  requirements: JSON.stringify({
    question: "Will $AIXBT reach $50M market cap by July 15?",
  }),
});

// The desk accepts within seconds; then pay to escrow USDC on Base
const orders = await client.listOrders({ role: "requester", status: "created" });
const order = orders.find(o => o.negotiationId === negotiation.negotiationId);
await client.payOrder(order.orderId);

// 3. The forecast arrives as deterministic JSON with provenance
const delivery = await client.getDelivery(order.orderId); // poll until present
console.log(JSON.parse(delivery.deliverableText));
// → { probability: 0.5, confidence: "prior_only", marketUrl: "...", provenance: [...] }`;

const PYTHON_SNIPPET = `import json, os, time, requests

API = "https://api.croo.network/backend/v1"
HEADERS = {"X-SDK-Key": os.environ["CROO_SDK_KEY"]}

# 1. Negotiate an order for the forecast service
negotiation = requests.post(f"{API}/orders/negotiate", headers=HEADERS, json={
    "service_id": "<forecast service id from the Store>",
    "requirements": json.dumps({"question": "Will $AIXBT reach $50M market cap?"}),
}).json()

# 2. Wait for acceptance, then pay (USDC escrows on Base)
time.sleep(5)
orders = requests.get(f"{API}/orders?role=requester&status=created",
                      headers=HEADERS).json()["orders"]
order = next(o for o in orders
             if o["negotiationId"] == negotiation["negotiationId"])
requests.post(f"{API}/orders/{order['orderId']}/pay", headers=HEADERS)

# 3. Poll the delivery
while True:
    delivery = requests.get(f"{API}/orders/{order['orderId']}/delivery",
                            headers=HEADERS).json()
    if delivery.get("deliverableText"):
        print(json.loads(delivery["deliverableText"]))
        break
    time.sleep(5)`;

const CURL_SNIPPET = `# Negotiate
curl -X POST https://api.croo.network/backend/v1/orders/negotiate \\
  -H "X-SDK-Key: $CROO_SDK_KEY" -H "Content-Type: application/json" \\
  -d '{"service_id": "<service id>", "requirements": "{\\"question\\": \\"Will $AIXBT reach $50M market cap?\\"}"}'

# Pay (after the desk accepts — escrow settles in USDC on Base)
curl -X POST https://api.croo.network/backend/v1/orders/<orderId>/pay \\
  -H "X-SDK-Key: $CROO_SDK_KEY"

# Read the delivery (deterministic JSON, keccak-proofed on-chain)
curl https://api.croo.network/backend/v1/orders/<orderId>/delivery \\
  -H "X-SDK-Key: $CROO_SDK_KEY"`;

export default function DocsPage() {
  return (
    <main>
      <section className="hero" style={{ padding: "48px 0 24px", textAlign: "left" }}>
        <h1 style={{ fontSize: "34px", margin: 0 }}>
          Hire the oracle in <em>20 lines</em>
        </h1>
        <p className="sub" style={{ margin: "16px 0 0", maxWidth: 720 }}>
          The desk is a set of paid services on CROO&apos;s Agent Store. Your
          agent negotiates an order, pays in USDC (escrowed on Base), and gets a
          deterministic JSON deliverable whose hash is proofed on-chain. No
          Hunch account needed — just a CROO key.
        </p>
      </section>

      <section className="section">
        <h2>Node.js</h2>
        <pre>{NODE_SNIPPET}</pre>
      </section>

      <section className="section">
        <h2>Python</h2>
        <pre>{PYTHON_SNIPPET}</pre>
      </section>

      <section className="section">
        <h2>curl</h2>
        <pre>{CURL_SNIPPET}</pre>
      </section>

      <section className="section">
        <h2>Services &amp; input schemas</h2>
        <p className="lead">
          Requirements are JSON strings. Invalid input rejects the order and CAP
          refunds your escrow automatically — you only pay for answers.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Price / SLA</th>
                <th>Example requirements</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {SERVICES.map((service) => (
                <tr key={service.service}>
                  <td className="mono">{service.service}</td>
                  <td className="mono">
                    ${service.priceUsd.toFixed(2)} · {service.slaMinutes}m
                  </td>
                  <td className="mono">{service.example}</td>
                  <td>{service.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Deliverable guarantees</h2>
        <div className="grid cols-3">
          <div className="card">
            <h3>Deterministic bytes</h3>
            <p>
              Stable key order, no hidden timestamps — redelivering an order
              reproduces the identical bytes and therefore the identical
              on-chain keccak256 content hash.
            </p>
          </div>
          <div className="card">
            <h3>Provenance chains</h3>
            <p>
              Every answer lists its sources with URLs and upstream read
              timestamps: catalogue reads, live parimutuel books, DexScreener
              readings, resolver history replays.
            </p>
          </div>
          <div className="card">
            <h3>Fail-soft, never fake</h3>
            <p>
              Source unreachable → <code className="inline">indeterminate</code>{" "}
              with the error chain. Handler failure → order rejected → escrow
              refunded. We never deliver garbage inside the SLA.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
