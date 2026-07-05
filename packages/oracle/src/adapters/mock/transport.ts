import type {
  CapDeliverable,
  CapEvent,
  CapNegotiation,
  CapOrder,
  CapProviderTransport,
} from "../../ports/cap.js";

/**
 * Deterministic, credential-free in-memory CAP — drives the whole test suite.
 * Test code scripts the requester side (createNegotiation / payOrder) and
 * asserts on provider behavior (accepted / rejected / delivered).
 */
export class MockCapTransport implements CapProviderTransport {
  private negotiations = new Map<string, CapNegotiation>();
  private orders = new Map<string, CapOrder>();
  readonly deliveries = new Map<string, CapDeliverable>();
  readonly rejectedNegotiations = new Map<string, string>();
  readonly rejectedOrders = new Map<string, string>();
  private listener: ((event: CapEvent) => void) | null = null;
  private seq = 0;

  async connect(onEvent: (event: CapEvent) => void) {
    this.listener = onEvent;
    return { close: () => (this.listener = null) };
  }

  private emit(event: CapEvent) {
    this.listener?.(event);
  }

  /** Test helper: a requester opens a negotiation. */
  createNegotiation(input: {
    serviceId: string;
    requirements?: string;
    fundAmount?: string;
  }): CapNegotiation {
    const negotiationId = `neg-${++this.seq}`;
    const negotiation: CapNegotiation = {
      negotiationId,
      serviceId: input.serviceId,
      requirements: input.requirements ?? "",
      status: "pending",
      ...(input.fundAmount !== undefined
        ? { fundAmount: input.fundAmount }
        : {}),
    };
    this.negotiations.set(negotiationId, negotiation);
    this.emit({
      type: "negotiation_created",
      negotiationId,
      serviceId: input.serviceId,
      raw: {},
    });
    return negotiation;
  }

  /** Test helper: the requester pays a created order. */
  payOrder(orderId: string): void {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`mock: unknown order ${orderId}`);
    if (order.status !== "created")
      throw new Error(`mock: pay in state ${order.status}`);
    order.status = "paid";
    order.payTxHash = `0xpay${orderId}`;
    this.emit({ type: "order_paid", orderId, raw: {} });
  }

  async getNegotiation(negotiationId: string): Promise<CapNegotiation> {
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) throw new Error(`mock: unknown negotiation`);
    return negotiation;
  }

  async acceptNegotiation(negotiationId: string): Promise<{ orderId: string }> {
    const negotiation = await this.getNegotiation(negotiationId);
    if (negotiation.status !== "pending")
      throw new Error(`mock: accept in state ${negotiation.status}`);
    negotiation.status = "accepted";
    const orderId = `order-${++this.seq}`;
    this.orders.set(orderId, {
      orderId,
      negotiationId,
      serviceId: negotiation.serviceId,
      requesterAgentId: "mock-requester",
      price: "0.10",
      paymentToken: "USDC",
      status: "created",
    });
    this.emit({ type: "order_created", orderId, raw: {} });
    return { orderId };
  }

  async rejectNegotiation(negotiationId: string, reason: string) {
    const negotiation = await this.getNegotiation(negotiationId);
    negotiation.status = "rejected";
    this.rejectedNegotiations.set(negotiationId, reason);
  }

  async getOrder(orderId: string): Promise<CapOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`mock: unknown order ${orderId}`);
    return order;
  }

  async listPaidOrders(): Promise<CapOrder[]> {
    return [...this.orders.values()].filter((o) => o.status === "paid");
  }

  async listPendingNegotiations(): Promise<CapNegotiation[]> {
    return [...this.negotiations.values()].filter(
      (n) => n.status === "pending",
    );
  }

  async deliverOrder(orderId: string, deliverable: CapDeliverable) {
    const order = await this.getOrder(orderId);
    if (order.status !== "paid")
      throw new Error(`mock: deliver in state ${order.status}`);
    if (this.deliveries.has(orderId))
      throw new Error(`mock: duplicate delivery for ${orderId}`);
    order.status = "completed";
    order.clearTxHash = `0xclear${orderId}`;
    this.deliveries.set(orderId, deliverable);
    this.emit({ type: "order_completed", orderId, raw: {} });
    return { txHash: order.clearTxHash };
  }

  async rejectOrder(orderId: string, reason: string) {
    const order = await this.getOrder(orderId);
    order.status = "rejected";
    this.rejectedOrders.set(orderId, reason);
    this.emit({ type: "order_rejected", orderId, raw: {} });
  }
}
