import { z } from "zod";

/**
 * Signal-buyer money-path policy — the deterministic gate every purchase
 * passes before a dollar of escrow moves. This is a MONEY PATH, so it obeys
 * the same invariants as the market factory:
 *
 *  - the counterparty set is a HUMAN-CURATED allowlist (no discovery can add a
 *    service the buyer will pay); an LLM is never in this decision;
 *  - every spend is bounded by a per-order price cap, a per-UTC-day cap, and an
 *    optional per-counterparty daily cap;
 *  - the gate runs against the REAL negotiated price (read off the created
 *    order), not an estimate — a counterparty cannot quote us into overspend.
 */

/** One human-vetted counterparty service the buyer is allowed to hire. */
export const AllowlistEntrySchema = z.object({
  serviceId: z.string().trim().min(1),
  agentId: z.string().trim().min(1).optional(),
  /** Human name for the "who we hired" feed. */
  label: z.string().trim().min(1),
  category: z.string().trim().min(1).default("research"),
  /** Per-entry price ceiling; the effective cap is min(this, global max). */
  maxPriceUsd: z.number().positive().optional(),
  /** JSON requirements string sent with the negotiation. */
  requirements: z.string().optional(),
});
export type AllowlistEntry = z.infer<typeof AllowlistEntrySchema>;

export const BuyerBudgetSchema = z.object({
  /** Hard ceiling on money that may move in one UTC day, across all counterparties. */
  dailyCapUsd: z.number().nonnegative(),
  /** No single order above this, ever. */
  maxPriceUsd: z.number().positive(),
  /** Optional ceiling per counterparty per UTC day. */
  perServiceDailyCapUsd: z.number().positive().optional(),
});
export type BuyerBudget = z.infer<typeof BuyerBudgetSchema>;

/** Money that has actually moved on a given UTC day. */
export interface SpendSnapshot {
  day: string;
  totalUsd: number;
  perServiceUsd: Record<string, number>;
}

export type DecisionCode =
  | "not_allowlisted"
  | "invalid_price"
  | "over_price_cap"
  | "over_daily_cap"
  | "over_service_cap";

export type PurchaseDecision =
  | { approved: true }
  | { approved: false; code: DecisionCode; reason: string };

/** UTC calendar day (YYYY-MM-DD) — the unit daily caps reset on. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function isAllowlisted(
  allowlist: readonly AllowlistEntry[],
  serviceId: string,
): boolean {
  return allowlist.some((entry) => entry.serviceId === serviceId);
}

const EPSILON = 1e-9;

/**
 * The whole gate in one pure function. `spend` is the money already moved today
 * (delivered purchases only); `priceUsd` is the counterparty's real quote.
 */
export function decidePurchase(args: {
  entry: AllowlistEntry;
  priceUsd: number;
  budget: BuyerBudget;
  spend: SpendSnapshot;
}): PurchaseDecision {
  const { entry, priceUsd, budget, spend } = args;

  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    return {
      approved: false,
      code: "invalid_price",
      reason: `unusable price ${priceUsd}`,
    };
  }

  const effectiveMax =
    entry.maxPriceUsd !== undefined
      ? Math.min(entry.maxPriceUsd, budget.maxPriceUsd)
      : budget.maxPriceUsd;
  if (priceUsd > effectiveMax + EPSILON) {
    return {
      approved: false,
      code: "over_price_cap",
      reason: `price $${priceUsd} exceeds per-order cap $${effectiveMax}`,
    };
  }

  if (spend.totalUsd + priceUsd > budget.dailyCapUsd + EPSILON) {
    return {
      approved: false,
      code: "over_daily_cap",
      reason: `would push today's spend to $${(spend.totalUsd + priceUsd).toFixed(
        2,
      )} over the $${budget.dailyCapUsd} daily cap`,
    };
  }

  if (budget.perServiceDailyCapUsd !== undefined) {
    const already = spend.perServiceUsd[entry.serviceId] ?? 0;
    if (already + priceUsd > budget.perServiceDailyCapUsd + EPSILON) {
      return {
        approved: false,
        code: "over_service_cap",
        reason: `would push spend on ${entry.label} to $${(
          already + priceUsd
        ).toFixed(2)} over the $${budget.perServiceDailyCapUsd} per-counterparty cap`,
      };
    }
  }

  return { approved: true };
}

/** Parse a CAP order price string (USDC, decimal) to a number. */
export function parsePriceUsd(price: string, token: string): number {
  if (token && token.toUpperCase() !== "USDC") return Number.NaN;
  const value = Number.parseFloat(price);
  return Number.isFinite(value) ? value : Number.NaN;
}

/** USDC settles in 6 decimals, so base units ÷ 1e6 = dollars. */
const USDC_DECIMALS = 6;

/**
 * The real USD value of a created order — the number the pay-gate checks.
 *
 * WHY this exists: the live CAP API returns `price: ""` and carries the value
 * in `amount` (paymentToken base units, "100000.00000000" = $0.10). The mock
 * populated `price`, so an empty-`price` live order silently parsed to NaN and
 * the buyer self-rejected EVERY real order (`invalid_price`). Prefer a valid,
 * positive `price`; otherwise derive `amount ÷ 10^6`. Non-USDC settlement is
 * unpriceable in dollars here → NaN, and the gate then declines (no money moves).
 */
export function orderPriceUsd(order: {
  price: string;
  paymentToken: string;
  amount?: string;
}): number {
  const priced = parsePriceUsd(order.price, order.paymentToken);
  if (Number.isFinite(priced) && priced > 0) return priced;

  // `price` was empty/zero (the live shape) — fall back to base-units `amount`.
  if (order.paymentToken && order.paymentToken.toUpperCase() !== "USDC") {
    return Number.NaN;
  }
  const base = Number.parseFloat(order.amount ?? "");
  return Number.isFinite(base) && base > 0 ? base / 10 ** USDC_DECIMALS : Number.NaN;
}
