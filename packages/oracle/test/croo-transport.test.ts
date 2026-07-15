import { describe, expect, it } from "vitest";
import type { Order as SdkOrder } from "@croo-network/sdk";
import { toCapOrder } from "../src/adapters/croo/transport.js";

/**
 * The real CAP adapter is otherwise mock-substituted in the suite, but the
 * SDK→domain order mapping carries the money-path value, so it gets a unit.
 *
 * The live API returns `price: ""` and carries the order value in `amount`
 * (base units) — a field the SDK's own `Order` type does not even declare.
 * `toCapOrder` MUST surface `amount` into `CapOrder` or the buyer's pay-gate
 * parses an empty price to NaN and self-rejects every real order.
 */
const sdkOrder = (over: Record<string, unknown> = {}): SdkOrder =>
  ({
    orderId: "order-1",
    negotiationId: "neg-1",
    serviceId: "svc-a",
    requesterAgentId: "req-1",
    price: "",
    paymentToken: "USDC",
    status: "created",
    ...over,
  }) as unknown as SdkOrder;

describe("toCapOrder — SDK order → domain CapOrder", () => {
  it("carries the live `amount` field (base units) through the mapping", () => {
    const cap = toCapOrder(sdkOrder({ amount: "100000.00000000" }));
    expect(cap.amount).toBe("100000.00000000");
    expect(cap.price).toBe(""); // live price stays empty; value lives in amount
  });

  it("maps a mock-shaped order with a populated price (amount absent)", () => {
    const cap = toCapOrder(sdkOrder({ price: "0.50" }));
    expect(cap.price).toBe("0.50");
    expect(cap.amount).toBeUndefined();
  });

  it("preserves the core identity + optional tx fields", () => {
    const cap = toCapOrder(
      sdkOrder({ payTxHash: "0xpay", clearTxHash: "0xclear", slaDeadline: "2026-07-15T00:00:00Z" }),
    );
    expect(cap).toMatchObject({
      orderId: "order-1",
      negotiationId: "neg-1",
      serviceId: "svc-a",
      requesterAgentId: "req-1",
      paymentToken: "USDC",
      status: "created",
      payTxHash: "0xpay",
      clearTxHash: "0xclear",
      slaDeadline: "2026-07-15T00:00:00Z",
    });
  });
});
