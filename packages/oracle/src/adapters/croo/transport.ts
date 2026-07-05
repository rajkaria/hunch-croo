import {
  AgentClient,
  DeliverableType,
  EventType,
  type Config,
  type Event as SdkEvent,
  type Negotiation as SdkNegotiation,
  type Order as SdkOrder,
} from "@croo-network/sdk";
import type {
  CapConnection,
  CapDeliverable,
  CapEvent,
  CapEventType,
  CapNegotiation,
  CapOrder,
  CapProviderTransport,
  CapRequesterTransport,
} from "../../ports/cap.js";
import type { OracleLogger } from "../../ports/runtime.js";

const EVENT_MAP: Record<string, CapEventType> = {
  [EventType.NegotiationCreated]: "negotiation_created",
  [EventType.NegotiationRejected]: "negotiation_rejected",
  [EventType.NegotiationExpired]: "negotiation_expired",
  [EventType.OrderCreated]: "order_created",
  [EventType.OrderPaid]: "order_paid",
  [EventType.OrderCompleted]: "order_completed",
  [EventType.OrderRejected]: "order_rejected",
  [EventType.OrderExpired]: "order_expired",
};

function toCapEvent(event: SdkEvent): CapEvent | null {
  const type = EVENT_MAP[event.type];
  if (!type) return null;
  const out: CapEvent = { type, raw: event.raw ?? {} };
  if (event.negotiation_id) out.negotiationId = event.negotiation_id;
  if (event.order_id) out.orderId = event.order_id;
  if (event.service_id) out.serviceId = event.service_id;
  return out;
}

function toCapNegotiation(negotiation: SdkNegotiation): CapNegotiation {
  const out: CapNegotiation = {
    negotiationId: negotiation.negotiationId,
    serviceId: negotiation.serviceId,
    requirements: negotiation.requirements ?? "",
    status: negotiation.status,
  };
  if (negotiation.expiresAt) out.expiresAt = negotiation.expiresAt;
  if (negotiation.fundAmount) out.fundAmount = negotiation.fundAmount;
  if (negotiation.fundToken) out.fundToken = negotiation.fundToken;
  return out;
}

function toCapOrder(order: SdkOrder): CapOrder {
  const out: CapOrder = {
    orderId: order.orderId,
    negotiationId: order.negotiationId,
    serviceId: order.serviceId,
    requesterAgentId: order.requesterAgentId,
    price: order.price,
    paymentToken: order.paymentToken,
    status: order.status,
  };
  if (order.payTxHash) out.payTxHash = order.payTxHash;
  if (order.clearTxHash) out.clearTxHash = order.clearTxHash;
  if (order.slaDeadline) out.slaDeadline = order.slaDeadline;
  return out;
}

export interface CrooTransportOptions {
  apiUrl: string;
  wsUrl: string;
  sdkKey: string;
  logger: OracleLogger;
}

/**
 * Real CAP adapter over `@croo-network/sdk`. One AgentClient serves both the
 * provider and requester ports (the SDK key identifies the agent; role is
 * per-call). WS reconnect/backoff/heartbeat are handled inside the SDK.
 */
export class CrooCapTransport
  implements CapProviderTransport, CapRequesterTransport
{
  private readonly client: AgentClient;
  private readonly logger: OracleLogger;

  constructor(options: CrooTransportOptions) {
    // Route SDK logs through a redacting logger — the SDK's default console
    // logger prints the WS URL including the `croo_sk_` key.
    const redact = (value: unknown): unknown => {
      if (typeof value === "string") {
        return value.replace(/croo_sk_[a-zA-Z0-9]+/g, "croo_sk_***");
      }
      if (value && typeof value === "object") {
        try {
          return JSON.parse(
            JSON.stringify(value).replace(
              /croo_sk_[a-zA-Z0-9]+/g,
              "croo_sk_***",
            ),
          ) as unknown;
        } catch {
          return "[unserializable]";
        }
      }
      return value;
    };
    const sdkLogger = {
      info: (m: string, ...args: unknown[]) =>
        options.logger.info(String(redact(m)), { args: args.map(redact) }),
      warn: (m: string, ...args: unknown[]) =>
        options.logger.warn(String(redact(m)), { args: args.map(redact) }),
      error: (m: string, ...args: unknown[]) =>
        options.logger.error(String(redact(m)), { args: args.map(redact) }),
      debug: (_m: string, ..._args: unknown[]) => {},
    };
    const config: Config = {
      baseURL: options.apiUrl,
      wsURL: options.wsUrl,
      logger: sdkLogger,
    };
    this.client = new AgentClient(config, options.sdkKey);
    this.logger = options.logger;
  }

  async connect(onEvent: (event: CapEvent) => void): Promise<CapConnection> {
    const stream = await this.client.connectWebSocket();
    stream.onAny((event: SdkEvent) => {
      const mapped = toCapEvent(event);
      if (mapped) onEvent(mapped);
      else this.logger.warn("unmapped CAP event", { type: event.type });
    });
    return { close: () => stream.close() };
  }

  async getNegotiation(negotiationId: string): Promise<CapNegotiation> {
    return toCapNegotiation(await this.client.getNegotiation(negotiationId));
  }

  async acceptNegotiation(negotiationId: string): Promise<{ orderId: string }> {
    const result = await this.client.acceptNegotiation(negotiationId);
    return { orderId: result.order.orderId };
  }

  async rejectNegotiation(negotiationId: string, reason: string) {
    await this.client.rejectNegotiation(negotiationId, reason);
  }

  async getOrder(orderId: string): Promise<CapOrder> {
    return toCapOrder(await this.client.getOrder(orderId));
  }

  async listPaidOrders(): Promise<CapOrder[]> {
    const orders = await this.client.listOrders({
      role: "provider",
      status: "paid",
      pageSize: 50,
    });
    return (orders ?? []).map(toCapOrder);
  }

  async listPendingNegotiations(): Promise<CapNegotiation[]> {
    const negotiations = await this.client.listNegotiations({
      role: "provider",
      status: "pending",
      pageSize: 50,
    });
    return (negotiations ?? []).map(toCapNegotiation);
  }

  async deliverOrder(orderId: string, deliverable: CapDeliverable) {
    const result = await this.client.deliverOrder(orderId, {
      deliverableType:
        deliverable.type === "schema"
          ? DeliverableType.Schema
          : DeliverableType.Text,
      ...(deliverable.text !== undefined
        ? { deliverableText: deliverable.text }
        : {}),
      ...(deliverable.schema !== undefined
        ? { deliverableSchema: deliverable.schema }
        : {}),
    });
    return { txHash: result.txHash };
  }

  async rejectOrder(orderId: string, reason: string) {
    await this.client.rejectOrder(orderId, reason);
  }

  // ── requester side ──────────────────────────────────────────────────────

  async negotiateOrder(req: { serviceId: string; requirements?: string }) {
    const negotiation = await this.client.negotiateOrder({
      serviceId: req.serviceId,
      ...(req.requirements !== undefined
        ? { requirements: req.requirements }
        : {}),
    });
    return { negotiationId: negotiation.negotiationId };
  }

  async payOrder(orderId: string): Promise<{ txHash: string }> {
    const result = await this.client.payOrder(orderId);
    return { txHash: result.txHash };
  }

  async getDelivery(orderId: string) {
    const delivery = await this.client.getDelivery(orderId);
    const out: { text?: string; schema?: string } = {};
    if (delivery.deliverableText) out.text = delivery.deliverableText;
    if (delivery.deliverableSchema) out.schema = delivery.deliverableSchema;
    return out;
  }
}
