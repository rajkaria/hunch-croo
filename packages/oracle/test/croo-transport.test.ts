import { describe, expect, it } from "vitest";
import type { Order as SdkOrder } from "@croo-network/sdk";
import { toCapOrder } from "../src/adapters/croo/transport.js";
import { orderPriceUsd } from "../src/core/signal-buyer/policy.js";

/**
 * The real CAP adapter is otherwise mock-substituted in the suite, but the
 * SDK→domain order mapping carries the money-path value, so it gets a unit.
 *
 * Ground truth off the live API (2026-07-15) — a $0.10 created order:
 *   price: "100000", amount: "100000.00000000",
 *   paymentToken: "0x8335…2913"  (the USDC CONTRACT ADDRESS, not "USDC")
 * `toCapOrder` is a faithful passthrough — it must NOT lose `amount` (a field the
 * SDK's own `Order` type doesn't declare) and must not mangle the base-units
 * price or the address token; `orderPriceUsd` interprets them downstream.
 */
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const sdkOrder = (over: Record<string, unknown> = {}): SdkOrder =>
  ({
    orderId: "order-1",
    negotiationId: "neg-1",
    serviceId: "svc-a",
    requesterAgentId: "req-1",
    price: "100000",
    amount: "100000.00000000",
    paymentToken: USDC,
    status: "created",
    ...over,
  }) as unknown as SdkOrder;

describe("toCapOrder — SDK order → domain CapOrder", () => {
  it("passes the real live shape through, and it prices to $0.10", () => {
    const cap = toCapOrder(sdkOrder());
    expect(cap.price).toBe("100000"); // base units, untouched
    expect(cap.amount).toBe("100000.00000000");
    expect(cap.paymentToken).toBe(USDC); // contract address, untouched
    expect(orderPriceUsd(cap)).toBeCloseTo(0.1, 9); // the number the gate checks
  });

  it("surfaces the off-type `amount` field (SDK Order omits it)", () => {
    const cap = toCapOrder(sdkOrder({ amount: "500000.00000000" }));
    expect(cap.amount).toBe("500000.00000000");
  });

  it("omits `amount` when the live order doesn't carry one", () => {
    const cap = toCapOrder(sdkOrder({ amount: undefined }));
    expect(cap.amount).toBeUndefined();
    expect(orderPriceUsd(cap)).toBeCloseTo(0.1, 9); // still prices off `price`
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
      paymentToken: USDC,
      status: "created",
      payTxHash: "0xpay",
      clearTxHash: "0xclear",
      slaDeadline: "2026-07-15T00:00:00Z",
    });
  });
});
