import type {
  CapConnection,
  CapEvent,
  CapOrder,
  CapRequesterTransport,
} from "../../ports/cap.js";

/**
 * Deterministic, credential-free requester-side CAP — a scriptable counterparty
 * for signal-buyer tests. Each allowlisted service maps to a MockCounterparty
 * that quotes a fixed price and either delivers a canned payload or exercises a
 * failure mode (rejects the order, expires, or never responds).
 *
 * Events are emitted synchronously, mirroring MockCapTransport, so the buyer's
 * negotiate → pay → deliver lifecycle runs to completion inside one microtask.
 */
/** Base mainnet USDC contract address — what the live CAP API sends as the
 * order's `paymentToken` (NOT the ticker "USDC"). The mock defaults to it so
 * every test exercises the real address + base-units shape. */
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** Author-friendly dollars → USDC base units string (6 decimals), the way the
 * live API actually carries an order's value. "0.50" → "500000". */
function dollarsToBaseUnits(dollars: string): string {
  const n = Number.parseFloat(dollars);
  return Number.isFinite(n) ? Math.round(n * 1_000_000).toString() : "";
}

export interface MockCounterparty {
  serviceId: string;
  agentId?: string;
  /** Price the counterparty quotes, in author-friendly DOLLARS ("0.50"). The
   * mock converts this to the live wire shape (base units + `USDC_ADDRESS`). */
  price: string;
  /** Override the settlement token (defaults to the Base USDC contract address).
   * Set a non-USDC token to exercise the "unpriceable → decline" path. */
  paymentToken?: string;
  deliverable?: { text?: string; schema?: string };
  behavior?:
    | "deliver"
    | "reject_order"
    | "reject_negotiation"
    | "expire"
    | "no_response";
}

export interface MockRequesterOptions {
  /** Events the server "replays" the instant a requester connects — models the
   * live CAP WS dumping historical events on (re)connect. A correct driver must
   * ignore these (they belong to orders it never negotiated). */
  replayOnConnect?: CapEvent[];
}

export class MockCapRequesterTransport implements CapRequesterTransport {
  private readonly counterparties = new Map<string, MockCounterparty>();
  private readonly orders = new Map<string, CapOrder>();
  readonly deliveries = new Map<string, { text?: string; schema?: string }>();
  readonly rejectedOrders = new Map<string, string>();
  private listener: ((event: CapEvent) => void) | null = null;
  private seq = 0;
  private readonly replayOnConnect: CapEvent[];

  constructor(counterparties: MockCounterparty[], opts: MockRequesterOptions = {}) {
    for (const cp of counterparties) this.counterparties.set(cp.serviceId, cp);
    this.replayOnConnect = opts.replayOnConnect ?? [];
  }

  async connect(onEvent: (event: CapEvent) => void): Promise<CapConnection> {
    this.listener = onEvent;
    // Replay history first, exactly as the live server does on connect.
    for (const event of this.replayOnConnect) this.emit(event);
    return { close: () => (this.listener = null) };
  }

  private emit(event: CapEvent) {
    this.listener?.(event);
  }

  async negotiateOrder(req: { serviceId: string; requirements?: string }) {
    const cp = this.counterparties.get(req.serviceId);
    if (!cp) throw new Error(`mock: no counterparty for ${req.serviceId}`);
    const negotiationId = `neg-${++this.seq}`;

    if (cp.behavior === "reject_negotiation") {
      this.emit({
        type: "negotiation_rejected",
        negotiationId,
        serviceId: cp.serviceId,
        raw: {},
      });
      return { negotiationId };
    }

    const orderId = `order-${++this.seq}`;
    // Emit the REAL live wire shape: value in USDC base units, token = contract
    // address. `orderPriceUsd` converts back to dollars — so a mock bug in this
    // conversion now fails a test instead of shipping (the last one didn't).
    const base = dollarsToBaseUnits(cp.price);
    this.orders.set(orderId, {
      orderId,
      negotiationId,
      serviceId: cp.serviceId,
      requesterAgentId: "mock-signal-buyer",
      price: base,
      amount: base,
      paymentToken: cp.paymentToken ?? USDC_ADDRESS,
      status: "created",
    });
    this.emit({
      type: "order_created",
      orderId,
      negotiationId,
      serviceId: cp.serviceId,
      raw: {},
    });
    return { negotiationId };
  }

  async getOrder(orderId: string): Promise<CapOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`mock: unknown order ${orderId}`);
    return order;
  }

  async payOrder(orderId: string): Promise<{ txHash: string }> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`mock: unknown order ${orderId}`);
    if (order.status !== "created")
      throw new Error(`mock: pay in state ${order.status}`);
    order.status = "paid";
    order.payTxHash = `0xpay${orderId}`;

    const cp = this.counterparties.get(order.serviceId);
    const behavior = cp?.behavior ?? "deliver";
    if (behavior === "reject_order") {
      order.status = "rejected";
      this.emit({ type: "order_rejected", orderId, raw: {} });
    } else if (behavior === "expire") {
      order.status = "expired";
      this.emit({ type: "order_expired", orderId, raw: {} });
    } else if (behavior === "no_response") {
      // Counterparty goes dark after payment — the buyer's timeout handles it.
    } else {
      order.status = "completed";
      order.clearTxHash = `0xclear${orderId}`;
      this.deliveries.set(orderId, cp?.deliverable ?? { text: "{}" });
      this.emit({ type: "order_completed", orderId, raw: {} });
    }
    return { txHash: order.payTxHash };
  }

  async rejectOrder(orderId: string, reason: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (order && order.status === "created") order.status = "rejected";
    this.rejectedOrders.set(orderId, reason);
  }

  async getDelivery(orderId: string): Promise<{ text?: string; schema?: string }> {
    return this.deliveries.get(orderId) ?? {};
  }
}
