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
export interface MockCounterparty {
  serviceId: string;
  agentId?: string;
  /** Decimal USDC string the counterparty quotes at order_created. */
  price: string;
  paymentToken?: string;
  deliverable?: { text?: string; schema?: string };
  behavior?:
    | "deliver"
    | "reject_order"
    | "reject_negotiation"
    | "expire"
    | "no_response";
}

export class MockCapRequesterTransport implements CapRequesterTransport {
  private readonly counterparties = new Map<string, MockCounterparty>();
  private readonly orders = new Map<string, CapOrder>();
  readonly deliveries = new Map<string, { text?: string; schema?: string }>();
  readonly rejectedOrders = new Map<string, string>();
  private listener: ((event: CapEvent) => void) | null = null;
  private seq = 0;

  constructor(counterparties: MockCounterparty[]) {
    for (const cp of counterparties) this.counterparties.set(cp.serviceId, cp);
  }

  async connect(onEvent: (event: CapEvent) => void): Promise<CapConnection> {
    this.listener = onEvent;
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
    this.orders.set(orderId, {
      orderId,
      negotiationId,
      serviceId: cp.serviceId,
      requesterAgentId: "mock-signal-buyer",
      price: cp.price,
      paymentToken: cp.paymentToken ?? "USDC",
      status: "created",
    });
    this.emit({ type: "order_created", orderId, serviceId: cp.serviceId, raw: {} });
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
