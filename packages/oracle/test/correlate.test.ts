import { describe, expect, it } from "vitest";
import { PurchaseCorrelator } from "../src/core/signal-buyer/correlate.js";

/**
 * The CAP WS can replay historical events when a requester (re)connects, so a
 * naive "act on the first order_created / order_completed" driver pays or
 * false-completes on a STALE order. The correlator scopes a purchase to exactly
 * one order and rejects everything else. See docs/context/hosting-deploy.md.
 */
describe("PurchaseCorrelator — graceful mode (buyOnce)", () => {
  it("adopts the first created order, then owns only that order's terminal events", () => {
    const c = new PurchaseCorrelator({ requireNegotiationMatch: false });
    expect(c.adopt({ orderId: "order-1", negotiationId: "neg-1" })).toBe(true);
    expect(c.adoptedOrderId).toBe("order-1");
    expect(c.owns({ orderId: "order-1" })).toBe(true);
    expect(c.owns({ orderId: "order-ghost" })).toBe(false); // replayed/foreign
  });

  it("adopts only ONE order — a second created event is ignored", () => {
    const c = new PurchaseCorrelator({ requireNegotiationMatch: false });
    expect(c.adopt({ orderId: "order-1" })).toBe(true);
    expect(c.adopt({ orderId: "order-2" })).toBe(false);
    expect(c.adoptedOrderId).toBe("order-1");
  });

  it("owns nothing before an order is adopted (ignores replayed terminal events)", () => {
    const c = new PurchaseCorrelator({ requireNegotiationMatch: false });
    expect(c.owns({ orderId: "order-ghost" })).toBe(false);
  });

  it("tightens to our negotiation when BOTH the event and our id are known", () => {
    const c = new PurchaseCorrelator({ requireNegotiationMatch: false });
    c.setNegotiation("neg-1");
    expect(c.adopt({ orderId: "order-x", negotiationId: "neg-OTHER" })).toBe(false);
    expect(c.adopt({ orderId: "order-1", negotiationId: "neg-1" })).toBe(true);
  });
});

describe("PurchaseCorrelator — strict mode (spike:requester)", () => {
  it("adopts NOTHING until our negotiation id is known", () => {
    const c = new PurchaseCorrelator({ requireNegotiationMatch: true });
    // replayed history arrives before we've negotiated → must be ignored
    expect(c.adopt({ orderId: "order-old", negotiationId: "neg-old" })).toBe(false);
    c.setNegotiation("neg-mine");
    expect(c.adopt({ orderId: "order-mine", negotiationId: "neg-mine" })).toBe(true);
  });

  it("rejects a created event that lacks or mismatches our negotiation id", () => {
    const c = new PurchaseCorrelator({ requireNegotiationMatch: true });
    c.setNegotiation("neg-mine");
    expect(c.adopt({ orderId: "order-x", negotiationId: "neg-other" })).toBe(false);
    expect(c.adopt({ orderId: "order-y" })).toBe(false); // no negotiation id at all
    expect(c.adoptedOrderId).toBeUndefined();
  });
});
