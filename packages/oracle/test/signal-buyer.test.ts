import { describe, expect, it } from "vitest";
import type { Clock } from "../src/ports/runtime.js";
import { MockCapRequesterTransport } from "../src/adapters/mock/requester.js";
import {
  decidePurchase,
  isAllowlisted,
  orderPriceUsd,
  utcDay,
  type AllowlistEntry,
  type BuyerBudget,
  type SpendSnapshot,
} from "../src/core/signal-buyer/policy.js";

/** Base mainnet USDC contract address — the live `paymentToken` (not "USDC"). */
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
import {
  InMemorySignalStore,
  summarizeCounterparties,
  type Purchase,
} from "../src/core/signal-buyer/ledger.js";
import {
  decide,
  normalizeDeliverable,
  type OwnReading,
  type RiskPolicy,
} from "../src/core/signal-buyer/signal.js";
import { buyOnce } from "../src/core/signal-buyer/purchase.js";
import { SignalBuyer } from "../src/core/signal-buyer/buyer.js";

const FROZEN = "2026-07-06T12:00:00.000Z";
const clock: Clock = { now: () => new Date(FROZEN) };

const entry = (over: Partial<AllowlistEntry> = {}): AllowlistEntry => ({
  serviceId: "svc-a",
  label: "Alpha Terminal",
  category: "research",
  ...over,
});

const emptySpend = (): SpendSnapshot => ({
  day: utcDay(new Date(FROZEN)),
  totalUsd: 0,
  perServiceUsd: {},
});

const budget: BuyerBudget = { dailyCapUsd: 5, maxPriceUsd: 1 };

// ── policy ───────────────────────────────────────────────────────────────

describe("signal-buyer policy", () => {
  it("approves a purchase inside every cap", () => {
    const d = decidePurchase({ entry: entry(), priceUsd: 0.5, budget, spend: emptySpend() });
    expect(d.approved).toBe(true);
  });

  it("rejects a price over the global per-order cap", () => {
    const d = decidePurchase({ entry: entry(), priceUsd: 2, budget, spend: emptySpend() });
    expect(d).toMatchObject({ approved: false, code: "over_price_cap" });
  });

  it("honours a tighter per-entry price cap", () => {
    const d = decidePurchase({
      entry: entry({ maxPriceUsd: 0.3 }),
      priceUsd: 0.5,
      budget,
      spend: emptySpend(),
    });
    expect(d).toMatchObject({ approved: false, code: "over_price_cap" });
  });

  it("rejects when the daily cap would be breached", () => {
    const spend: SpendSnapshot = { ...emptySpend(), totalUsd: 4.8 };
    const d = decidePurchase({ entry: entry(), priceUsd: 0.5, budget, spend });
    expect(d).toMatchObject({ approved: false, code: "over_daily_cap" });
  });

  it("rejects when the per-counterparty cap would be breached", () => {
    const perCapBudget: BuyerBudget = { ...budget, perServiceDailyCapUsd: 0.6 };
    const spend: SpendSnapshot = {
      ...emptySpend(),
      totalUsd: 0.5,
      perServiceUsd: { "svc-a": 0.5 },
    };
    const d = decidePurchase({ entry: entry(), priceUsd: 0.5, budget: perCapBudget, spend });
    expect(d).toMatchObject({ approved: false, code: "over_service_cap" });
  });

  it("rejects an unusable price", () => {
    const d = decidePurchase({ entry: entry(), priceUsd: Number.NaN, budget, spend: emptySpend() });
    expect(d).toMatchObject({ approved: false, code: "invalid_price" });
  });

  it("isAllowlisted gates by serviceId", () => {
    expect(isAllowlisted([entry()], "svc-a")).toBe(true);
    expect(isAllowlisted([entry()], "svc-x")).toBe(false);
  });
});

// ── orderPriceUsd: the REAL live order shape ────────────────────────────────
// Ground truth captured off the live API (2026-07-15): a $0.10 order reads
//   price: "100000", amount: "100000.00000000",
//   paymentToken: "0x8335…2913"  (the USDC CONTRACT ADDRESS, not "USDC")
// i.e. value in USDC base units (÷1e6), token as an address. The old code
// treated price as decimal dollars and gated on the literal "USDC" → every real
// order died as invalid_price:NaN.
describe("orderPriceUsd — base units + USDC contract address", () => {
  it("converts base-units `price` with the USDC contract-address token to USD", () => {
    expect(orderPriceUsd({ price: "100000", paymentToken: USDC })).toBeCloseTo(0.1, 9);
    expect(orderPriceUsd({ price: "500000", paymentToken: USDC })).toBeCloseTo(0.5, 9);
    expect(orderPriceUsd({ price: "9990000", paymentToken: USDC })).toBeCloseTo(9.99, 9);
  });

  it("accepts the literal ticker \"USDC\" too (case-insensitive)", () => {
    expect(orderPriceUsd({ price: "100000", paymentToken: "USDC" })).toBeCloseTo(0.1, 9);
    expect(orderPriceUsd({ price: "100000", paymentToken: "usdc" })).toBeCloseTo(0.1, 9);
  });

  it("falls back to base-units `amount` when `price` is empty", () => {
    expect(
      orderPriceUsd({ price: "", paymentToken: USDC, amount: "100000.00000000" }),
    ).toBeCloseTo(0.1, 9);
  });

  it("is NaN when the value is unusable (gate then declines)", () => {
    expect(Number.isNaN(orderPriceUsd({ price: "", paymentToken: USDC }))).toBe(true);
    expect(Number.isNaN(orderPriceUsd({ price: "0", paymentToken: USDC }))).toBe(true);
  });

  it("is NaN for a non-USDC settlement token", () => {
    // e.g. DAI / a random ERC-20 / native-ETH zero address → unpriceable here
    expect(Number.isNaN(orderPriceUsd({ price: "100000", paymentToken: "DAI" }))).toBe(true);
    expect(
      Number.isNaN(
        orderPriceUsd({ price: "100000", paymentToken: "0x0000000000000000000000000000000000000000" }),
      ),
    ).toBe(true);
  });
});

// ── purchase session (buyOnce) ─────────────────────────────────────────────

describe("buyOnce lifecycle", () => {
  it("delivers when the gate approves", async () => {
    const transport = new MockCapRequesterTransport([
      { serviceId: "svc-a", price: "0.50", deliverable: { schema: "{\"probability\":0.7}" } },
    ]);
    const out = await buyOnce(
      { transport, clock },
      { serviceId: "svc-a", gate: () => ({ pay: true }) },
    );
    expect(out.status).toBe("delivered");
    expect(out.payTxHash).toBeDefined();
    expect(out.delivery?.schema).toContain("0.7");
  });

  it("skips with zero escrow when the gate declines (order rejected, never paid)", async () => {
    const transport = new MockCapRequesterTransport([
      { serviceId: "svc-a", price: "9.99", deliverable: { text: "unreachable" } },
    ]);
    const out = await buyOnce(
      { transport, clock },
      { serviceId: "svc-a", gate: () => ({ pay: false, reason: "over_price_cap" }) },
    );
    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("over_price_cap");
    expect(transport.deliveries.size).toBe(0); // nothing delivered
    expect([...transport.rejectedOrders.values()]).toContain("over_price_cap");
  });

  it("reports rejected when the counterparty ends the order", async () => {
    const transport = new MockCapRequesterTransport([
      { serviceId: "svc-a", price: "0.50", behavior: "reject_order" },
    ]);
    const out = await buyOnce(
      { transport, clock },
      { serviceId: "svc-a", gate: () => ({ pay: true }) },
    );
    expect(out.status).toBe("rejected");
  });

  it("fails soft on a silent counterparty (timeout, no throw)", async () => {
    const transport = new MockCapRequesterTransport([
      { serviceId: "svc-a", price: "0.50", behavior: "no_response" },
    ]);
    const out = await buyOnce(
      { transport, clock, timeoutMs: 30 },
      { serviceId: "svc-a", gate: () => ({ pay: true }) },
    );
    expect(out.status).toBe("failed");
    expect(out.reason).toContain("timeout");
  });

  it("ignores a replayed historical order_completed for a foreign order (WS replay guard)", async () => {
    // The CAP WS replays history on connect. A stale order_completed for an
    // order we never negotiated must NOT drive this purchase — before the guard
    // buyOnce fetched the ghost order (mock throws) and false-"failed".
    const transport = new MockCapRequesterTransport(
      [{ serviceId: "svc-a", price: "0.50", deliverable: { schema: '{"probability":0.7}' } }],
      { replayOnConnect: [{ type: "order_completed", orderId: "order-ghost", raw: {} }] },
    );
    const out = await buyOnce(
      { transport, clock },
      { serviceId: "svc-a", gate: () => ({ pay: true }) },
    );
    expect(out.status).toBe("delivered");
    expect(out.orderId).not.toBe("order-ghost");
    expect(out.delivery?.schema).toContain("0.7");
  });

  it("ignores a replayed historical order_rejected for a foreign order", async () => {
    const transport = new MockCapRequesterTransport(
      [{ serviceId: "svc-a", price: "0.50", deliverable: { text: "ok" } }],
      { replayOnConnect: [{ type: "order_rejected", orderId: "order-ghost", raw: {} }] },
    );
    const out = await buyOnce(
      { transport, clock },
      { serviceId: "svc-a", gate: () => ({ pay: true }) },
    );
    expect(out.status).toBe("delivered"); // NOT a false "rejected" from the ghost
  });
});

// ── the buyer over a round ─────────────────────────────────────────────────

function threeCounterparties() {
  return new MockCapRequesterTransport([
    { serviceId: "svc-a", agentId: "agent-a", price: "0.50", deliverable: { schema: JSON.stringify({ probability: 0.71 }) } },
    { serviceId: "svc-pricey", agentId: "agent-p", price: "9.99", deliverable: { text: "nope" } },
    { serviceId: "svc-c", agentId: "agent-c", price: "0.25", deliverable: { schema: JSON.stringify({ sentiment: 0.4 }) } },
  ]);
}

const allowlist: AllowlistEntry[] = [
  { serviceId: "svc-a", agentId: "agent-a", label: "Alpha Terminal", category: "research" },
  { serviceId: "svc-pricey", agentId: "agent-p", label: "Overpriced Oracle", category: "research" },
  { serviceId: "svc-c", agentId: "agent-c", label: "Cheap Sentiment", category: "sentiment" },
];

describe("SignalBuyer round", () => {
  it("buys allowlisted, skips over-cap, records the ledger, folds signals", async () => {
    const store = new InMemorySignalStore();
    const buyer = new SignalBuyer(
      { transport: threeCounterparties(), store, clock },
      { allowlist, budget, live: true },
    );
    const report = await buyer.runRound();

    expect(report.purchased).toBe(2);
    expect(report.skipped).toBe(1); // the $9.99 one, priced out — no money
    expect(report.spentUsd).toBeCloseTo(0.75, 5);
    expect(report.signals).toHaveLength(2);
    expect(report.signals[0]?.authority).toBe("advisory");

    const pricey = report.purchases.find((p) => p.serviceId === "svc-pricey");
    expect(pricey?.status).toBe("skipped");
    expect(pricey?.priceUsd).toBe(0);
    expect(pricey?.reason).toContain("over_price_cap");

    // "who we hired" shows only the two paid counterparties
    expect(report.hired.map((c) => c.label).sort()).toEqual([
      "Alpha Terminal",
      "Cheap Sentiment",
    ]);
  });

  it("BUYS a live-shape order — base-units price + USDC contract-address token (invalid_price:NaN regression)", async () => {
    const store = new InMemorySignalStore();
    // The mock emits the exact live wire shape: value in USDC base units, token =
    // the contract address. A $0.10 hire proves the buyer prices it — before the
    // fix this died as invalid_price:NaN (token wasn't literal "USDC") and never spent.
    const transport = new MockCapRequesterTransport([
      {
        serviceId: "svc-a",
        agentId: "agent-a",
        price: "0.10",
        deliverable: { schema: JSON.stringify({ probability: 0.6 }) },
      },
    ]);
    const buyer = new SignalBuyer(
      { transport, store, clock },
      {
        allowlist: [
          { serviceId: "svc-a", agentId: "agent-a", label: "Alpha Terminal", category: "research" },
        ],
        budget,
        live: true,
      },
    );
    const report = await buyer.runRound();

    expect(report.purchased).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.spentUsd).toBeCloseTo(0.1, 5);
    const p = report.purchases[0];
    expect(p?.status).toBe("delivered");
    expect(p?.priceUsd).toBeCloseTo(0.1, 5);
    expect(report.signals).toHaveLength(1);
  });

  it("declines an order in a non-USDC token — unpriceable, no escrow", async () => {
    const store = new InMemorySignalStore();
    const transport = new MockCapRequesterTransport([
      { serviceId: "svc-a", agentId: "agent-a", price: "0.10", paymentToken: "DAI",
        deliverable: { text: "unreachable" } },
    ]);
    const buyer = new SignalBuyer(
      { transport, store, clock },
      { allowlist: [{ serviceId: "svc-a", agentId: "agent-a", label: "Alpha Terminal", category: "research" }],
        budget, live: true },
    );
    const report = await buyer.runRound();
    expect(report.purchased).toBe(0);
    expect(report.spentUsd).toBe(0);
    expect(report.purchases[0]?.reason).toContain("invalid_price");
  });

  it("stops mid-round when the daily cap is exhausted", async () => {
    const store = new InMemorySignalStore();
    // dailyCap $0.75 fits svc-a ($0.50) but not both real buys ($0.50 + $0.25)
    const tightBudget: BuyerBudget = { dailyCapUsd: 0.6, maxPriceUsd: 1 };
    const buyer = new SignalBuyer(
      { transport: threeCounterparties(), store, clock },
      { allowlist, budget: tightBudget, live: true },
    );
    const report = await buyer.runRound();

    expect(report.purchased).toBe(1); // only svc-a
    expect(report.spentUsd).toBeCloseTo(0.5, 5);
    const cheap = report.purchases.find((p) => p.serviceId === "svc-c");
    expect(cheap?.status).toBe("skipped");
    expect(cheap?.reason).toContain("over_daily_cap");
  });

  it("dry run moves no money and never touches a counterparty", async () => {
    const store = new InMemorySignalStore();
    let touched = false;
    const spy = new Proxy(threeCounterparties(), {
      get(target, prop, recv) {
        if (prop === "negotiateOrder" || prop === "connect") touched = true;
        return Reflect.get(target, prop, recv);
      },
    });
    // One entry declares a ceiling above the global cap → a paper skip; the
    // dry run cannot know a counterparty's *real* quote without a network hit,
    // so it decides against declared caps only. That is the honest contract.
    const withDeclaredCeiling: AllowlistEntry[] = [
      allowlist[0]!,
      { ...allowlist[1]!, maxPriceUsd: 2 }, // 2 > budget max 1 → over_price_cap
      allowlist[2]!,
    ];
    const buyer = new SignalBuyer(
      { transport: spy, store, clock },
      { allowlist: withDeclaredCeiling, budget, live: false },
    );
    const report = await buyer.runRound();

    expect(touched).toBe(false);
    expect(report.spentUsd).toBe(0);
    expect(report.purchased).toBe(0);
    expect(report.purchases.every((p) => p.status === "skipped")).toBe(true);
    expect(report.purchases.every((p) => (p.reason ?? "").startsWith("dry_run"))).toBe(true);
    const pricey = report.purchases.find((p) => p.serviceId === "svc-pricey");
    expect(pricey?.reason).toContain("dry_run would skip");
    const alpha = report.purchases.find((p) => p.serviceId === "svc-a");
    expect(alpha?.reason).toContain("would hire");
  });
});

// ── deliverable normalization + advisory blend ─────────────────────────────

describe("signal normalization + decide blend", () => {
  const order = {
    orderId: "order-1",
    negotiationId: "neg-1",
    serviceId: "svc-a",
    requesterAgentId: "me",
    price: "0.50",
    paymentToken: "USDC",
    status: "completed",
  };

  it("extracts a probability (and rescales a percentage) and marks it advisory", () => {
    const sig = normalizeDeliverable({
      entry: entry(),
      order,
      delivery: { schema: JSON.stringify({ probability: 71, summary: "bullish" }) },
      clock,
      seq: 1,
    });
    expect(sig.reading.probability).toBeCloseTo(0.71, 5); // 71 → 0.71
    expect(sig.reading.summary).toBe("bullish");
    expect(sig.authority).toBe("advisory");
    expect(sig.provenance.url).toContain("order-1");
  });

  it("never throws on a non-JSON deliverable; preserves raw text", () => {
    const sig = normalizeDeliverable({
      entry: entry(),
      order,
      delivery: { text: "not json at all" },
      clock,
      seq: 2,
    });
    expect(sig.reading.probability).toBeUndefined();
    expect(sig.raw.text).toBe("not json at all");
  });

  const policy: RiskPolicy = { maxAdvisoryNudge: 0.05, maxSizeUsd: 100, minOwnConfidence: "medium" };
  const advisory = (probability: number) =>
    normalizeDeliverable({
      entry: entry(),
      order,
      delivery: { schema: JSON.stringify({ probability }) },
      clock,
      seq: 1,
    });

  it("clamps the probability nudge to the policy leash", () => {
    const own: OwnReading = { probability: 0.62, confidence: "medium", source: "ours" };
    const d = decide(own, [advisory(0.95)], policy);
    expect(d.probability).toBeCloseTo(0.67, 5); // +0.33 desired, clamped to +0.05
    expect(d.actedOnAdvisory).toBe(true);
  });

  it("caps authorized size at own conviction and halves it on disagreement", () => {
    const own: OwnReading = { probability: 0.62, confidence: "medium", source: "ours" };
    expect(decide(own, [advisory(0.7)], policy).authorizedSizeUsd).toBeCloseTo(50, 5); // agree → 50% of 100
    expect(decide(own, [advisory(0.3)], policy).authorizedSizeUsd).toBeCloseTo(25, 5); // disagree → halved
  });

  it("NEVER lets an advisory authorize action below the own-confidence risk gate", () => {
    const weak: OwnReading = { probability: 0.62, confidence: "prior_only", source: "seeded prior" };
    const d = decide(weak, [advisory(0.95)], policy);
    expect(d.authorizedSizeUsd).toBe(0);
    expect(d.actedOnAdvisory).toBe(false);
    expect(d.rationale).toContain("risk gate");
  });

  it("carries every advisory's provenance into the decision", () => {
    const own: OwnReading = {
      probability: 0.62,
      confidence: "high",
      source: "ours",
      provenance: [{ source: "our forecast", url: "https://x", readAt: FROZEN }],
    };
    const d = decide(own, [advisory(0.7), advisory(0.66)], policy);
    expect(d.provenance).toHaveLength(3); // 1 own + 2 advisory
    expect(d.advisoryLabels).toHaveLength(2);
  });
});

// ── ledger accounting ──────────────────────────────────────────────────────

describe("ledger accounting", () => {
  const delivered = (over: Partial<Purchase>): Purchase => ({
    id: "p",
    serviceId: "svc-a",
    label: "Alpha Terminal",
    category: "research",
    status: "delivered",
    priceUsd: 0.5,
    requestedAt: FROZEN,
    settledAt: FROZEN,
    ...over,
  });

  it("spendOn counts only delivered purchases on that UTC day", () => {
    const store = new InMemorySignalStore();
    store.record(delivered({ id: "a" }));
    store.record(delivered({ id: "b", serviceId: "svc-b", priceUsd: 0.25 }));
    store.record({ ...delivered({ id: "c" }), status: "skipped", priceUsd: 0 });
    store.record(delivered({ id: "old", settledAt: "2026-07-01T00:00:00.000Z" }));

    const snap = store.spendOn(utcDay(new Date(FROZEN)));
    expect(snap.totalUsd).toBeCloseTo(0.75, 5); // a + b; c skipped, old other-day
    expect(snap.perServiceUsd["svc-a"]).toBeCloseTo(0.5, 5);
    expect(snap.perServiceUsd["svc-b"]).toBeCloseTo(0.25, 5);
  });

  it("summarizeCounterparties aggregates delivered spend, sorted by spend", () => {
    const rows = summarizeCounterparties([
      delivered({ id: "1", agentId: "agent-a", priceUsd: 0.5 }),
      delivered({ id: "2", agentId: "agent-a", priceUsd: 0.5 }),
      delivered({ id: "3", agentId: "agent-b", label: "Cheap", priceUsd: 0.25 }),
      { ...delivered({ id: "4", agentId: "agent-c" }), status: "skipped" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.label).toBe("Alpha Terminal");
    expect(rows[0]?.orders).toBe(2);
    expect(rows[0]?.spentUsd).toBeCloseTo(1, 5);
  });
});
