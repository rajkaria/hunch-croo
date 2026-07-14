import { describe, expect, it, vi } from "vitest";
import { CapClient } from "../src/index.js";

/**
 * The CAP client is the money path — every hire() goes through it — and it had
 * no tests until a live probe caught `role=requester` 400ing against
 * api.croo.network. These tests pin the wire contract against the shapes the
 * real API returns, so the next drift fails here and not in production.
 */

const ORDER = {
  orderId: "ord_1",
  negotiationId: "neg_1",
  serviceId: "svc_1",
  status: "created",
  createTxHash: "0xcreate",
  payTxHash: "0xpay",
  deliverTxHash: "0xdeliver",
  clearTxHash: "0xclear",
};

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** Indexed read that fails the test loudly instead of returning `undefined`. */
function callAt(calls: RecordedCall[], index: number): RecordedCall {
  const call = calls[index];
  if (!call) throw new Error(`expected a request at index ${index}, saw ${calls.length}`);
  return call;
}

/** A fetch double that records every request and replays queued responses. */
function stubFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: RecordedCall[] = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const client = (fetchImpl: typeof fetch) =>
  new CapClient({ sdkKey: "croo_sk_test", fetchImpl });

describe("CapClient wire contract", () => {
  it("lists buyer-side orders with role=buyer — CAP 400s on any other role", async () => {
    const { impl, calls } = stubFetch([{ body: { orders: [ORDER], total: 1 } }]);

    const orders = await client(impl).listRequesterOrders();

    expect(orders).toEqual([ORDER]);
    expect(callAt(calls, 0).url).toContain("role=buyer");
    // The regression: CAP rejects role=requester with 400 INVALID_PARAMETERS.
    expect(callAt(calls, 0).url).not.toContain("role=requester");
  });

  it("targets /backend/v1 and authenticates with the X-SDK-Key header", async () => {
    const { impl, calls } = stubFetch([{ body: { orders: [] } }]);

    await client(impl).listRequesterOrders();

    expect(callAt(calls, 0).url).toContain("https://api.croo.network/backend/v1/orders");
    expect(callAt(calls, 0).headers["X-SDK-Key"]).toBe("croo_sk_test");
  });

  it("passes an optional status filter through as a query param", async () => {
    const { impl, calls } = stubFetch([{ body: { orders: [] } }]);

    await client(impl).listRequesterOrders("completed");

    expect(callAt(calls, 0).url).toContain("status=completed");
  });

  it("negotiate() sends snake_case service_id and accepts either id casing back", async () => {
    const { impl, calls } = stubFetch([{ body: { negotiation_id: "neg_9" } }]);

    const { negotiationId } = await client(impl).negotiate("svc_1", { symbol: "BTC" });

    expect(negotiationId).toBe("neg_9");
    expect(callAt(calls, 0).method).toBe("POST");
    expect(callAt(calls, 0).url).toContain("/orders/negotiate");
  });

  it("throws with the status and body when CAP rejects a call", async () => {
    const { impl } = stubFetch([
      {
        status: 400,
        body: { code: 400, reason: "INVALID_PARAMETERS", message: "role must be 'buyer' or 'provider'" },
      },
    ]);

    await expect(client(impl).listRequesterOrders()).rejects.toThrow(/400.*INVALID_PARAMETERS/s);
  });

  it("hire() negotiates, waits for the order, pays it, and returns the deliverable + tx hashes", async () => {
    const { impl, calls } = stubFetch([
      { body: { negotiationId: "neg_1" } }, // negotiate
      { body: { orders: [ORDER] } }, // poll → provider accepted
      { body: {} }, // pay
      { body: { deliverableText: '{"probability":0.62}' } }, // delivery
      { body: { orders: [{ ...ORDER, status: "completed" }] } }, // final row for tx hashes
    ]);

    const result = await client(impl).hire<{ probability: number }>({
      serviceId: "svc_1",
      requirements: { question: "BTC > 100k?" },
      pollMs: 1,
    });

    expect(result.deliverable).toEqual({ probability: 0.62 });
    expect(result.orderId).toBe("ord_1");
    expect(result.txHashes).toEqual({
      create: "0xcreate",
      pay: "0xpay",
      deliver: "0xdeliver",
      clear: "0xclear",
    });
    // The pay call must actually have fired — escrow is the whole point.
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/orders/ord_1/pay"))).toBe(true);
    // Every order poll used the role CAP accepts.
    for (const call of calls.filter((c) => c.url.includes("role="))) {
      expect(call.url).toContain("role=buyer");
    }
  });

  it("hire() returns a non-JSON deliverable as raw text rather than throwing", async () => {
    const { impl } = stubFetch([
      { body: { negotiationId: "neg_1" } },
      { body: { orders: [{ ...ORDER, status: "paid" }] } },
      { body: { deliverableText: "10 lines of plain text" } },
      { body: { orders: [ORDER] } },
    ]);

    const result = await client(impl).hire({ serviceId: "svc_1", requirements: {}, pollMs: 1 });

    expect(result.deliverable).toBe("10 lines of plain text");
  });

  it("hire() does not re-pay an order the provider already moved past 'created'", async () => {
    const { impl, calls } = stubFetch([
      { body: { negotiationId: "neg_1" } },
      { body: { orders: [{ ...ORDER, status: "paid" }] } },
      { body: { deliverableText: "{}" } },
      { body: { orders: [ORDER] } },
    ]);

    await client(impl).hire({ serviceId: "svc_1", requirements: {}, pollMs: 1 });

    expect(calls.some((c) => c.url.endsWith("/pay"))).toBe(false);
  });
});
