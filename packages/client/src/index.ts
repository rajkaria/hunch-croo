/**
 * @hunchxyz/cap-client — hire the Hunch Oracle Desk in ~20 lines.
 *
 * A zero-dependency Node client for CROO's Agent Protocol (CAP) REST surface,
 * shaped around the hire flow: negotiate → (desk accepts) → pay (USDC escrows
 * on Base) → poll the delivery. Works for ANY CAP service, not just ours.
 */

export interface CapClientOptions {
  /** Your CROO SDK key from agent.croo.network (starts with croo_sk_). */
  sdkKey: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface HireOptions {
  /** Service id from the Agent Store listing. */
  serviceId: string;
  /** Requirements object — serialized to the JSON string CAP carries. */
  requirements: unknown;
  /** Overall deadline for the whole hire flow (default 10 minutes). */
  timeoutMs?: number;
  /** Poll cadence (default 5s). */
  pollMs?: number;
}

export interface HireResult<T = unknown> {
  orderId: string;
  negotiationId: string;
  /** Parsed deliverable JSON (T), or the raw text when not JSON. */
  deliverable: T | string;
  raw: { deliverableText?: string; deliverableSchema?: string };
  txHashes: {
    create?: string;
    pay?: string;
    deliver?: string;
    clear?: string;
  };
}

interface CapOrderRow {
  orderId: string;
  negotiationId: string;
  status: string;
  createTxHash?: string;
  payTxHash?: string;
  deliverTxHash?: string;
  clearTxHash?: string;
}

export class CapClient {
  private readonly base: string;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CapClientOptions) {
    this.base = (options.apiUrl ?? "https://api.croo.network").replace(/\/$/, "") + "/backend/v1";
    this.key = options.sdkKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        "X-SDK-Key": this.key,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`CAP ${method} ${path} → ${response.status}: ${text.slice(0, 300)}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async negotiate(serviceId: string, requirements: unknown): Promise<{ negotiationId: string }> {
    const body = await this.call<{ negotiationId?: string; negotiation_id?: string }>(
      "POST",
      "/orders/negotiate",
      {
        service_id: serviceId,
        requirements:
          typeof requirements === "string" ? requirements : JSON.stringify(requirements),
      },
    );
    const negotiationId = body.negotiationId ?? body.negotiation_id;
    if (!negotiationId) throw new Error("negotiate returned no negotiation id");
    return { negotiationId };
  }

  /**
   * List the orders WE placed as the paying side.
   *
   * The role value is `buyer`, not `requester`: CAP rejects anything else with
   * 400 INVALID_PARAMETERS ("role must be 'buyer' or 'provider'"). hire() polls
   * this on every purchase, so getting it wrong fails every buy, not just this
   * call.
   */
  async listRequesterOrders(status?: string): Promise<CapOrderRow[]> {
    const query = status ? `&status=${status}` : "";
    const body = await this.call<{ orders?: CapOrderRow[] }>(
      "GET",
      `/orders?role=buyer&page_size=50${query}`,
    );
    return body.orders ?? [];
  }

  async payOrder(orderId: string): Promise<void> {
    await this.call("POST", `/orders/${orderId}/pay`);
  }

  async getDelivery(orderId: string): Promise<{ deliverableText?: string; deliverableSchema?: string }> {
    return this.call("GET", `/orders/${orderId}/delivery`);
  }

  /**
   * The whole hire flow in one call: negotiate, wait for the provider to
   * accept, pay (escrow on Base), wait for the delivery, parse it.
   */
  async hire<T = unknown>(options: HireOptions): Promise<HireResult<T>> {
    const timeoutMs = options.timeoutMs ?? 10 * 60_000;
    const pollMs = options.pollMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const { negotiationId } = await this.negotiate(options.serviceId, options.requirements);

    // Wait for acceptance → an order appears for our negotiation.
    let order: CapOrderRow | undefined;
    while (!order) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the provider to accept");
      await sleep(pollMs);
      const orders = await this.listRequesterOrders();
      order = orders.find((o) => o.negotiationId === negotiationId);
    }

    if (order.status === "created") {
      await this.payOrder(order.orderId);
    }

    // Wait for the deliverable.
    while (true) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the delivery");
      const delivery = await this.getDelivery(order.orderId).catch(() => null);
      if (delivery?.deliverableText || delivery?.deliverableSchema) {
        const text = delivery.deliverableText ?? delivery.deliverableSchema ?? "";
        let parsed: T | string;
        try {
          parsed = JSON.parse(text) as T;
        } catch {
          parsed = text;
        }
        const final = (await this.listRequesterOrders()).find(
          (o) => o.orderId === order!.orderId,
        );
        return {
          orderId: order.orderId,
          negotiationId,
          deliverable: parsed,
          raw: delivery,
          txHashes: {
            ...(final?.createTxHash ? { create: final.createTxHash } : {}),
            ...(final?.payTxHash ? { pay: final.payTxHash } : {}),
            ...(final?.deliverTxHash ? { deliver: final.deliverTxHash } : {}),
            ...(final?.clearTxHash ? { clear: final.clearTxHash } : {}),
          },
        };
      }
      await sleep(pollMs);
    }
  }
}
