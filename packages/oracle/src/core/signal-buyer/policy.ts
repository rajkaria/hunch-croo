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

/** USDC settles in 6 decimals, so base units ÷ 1e6 = dollars. */
const USDC_DECIMALS = 6;

/**
 * `paymentToken` on the live CAP API is the ERC-20 CONTRACT ADDRESS, not the
 * ticker. Base mainnet USDC — the only token our desk settles in. Matched
 * case-insensitively; the literal "USDC" is also accepted for the mock and any
 * ticker-style caller.
 */
const USDC_TOKENS = new Set<string>([
  "usdc",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base mainnet USDC
]);

function isUsdc(token: string): boolean {
  return USDC_TOKENS.has(token.trim().toLowerCase());
}

/**
 * The real USD value of a created order — the number the pay-gate checks.
 *
 * WHY this is subtle (it cost a live incident): the CAP API does NOT return a
 * decimal-dollar price. A created $0.10 order reads
 *   price: "100000", amount: "100000.00000000",
 *   paymentToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
 * i.e. the value is in USDC **base units** (÷1e6) and the token is the **contract
 * address**, not "USDC". The old code treated `price` as decimal dollars and
 * gated the token on the literal string "USDC", so every real order died as
 * `invalid_price: NaN`. Here: reject non-USDC settlement (→ NaN → the gate
 * declines, no money moves), else read `price` (or `amount`) as base units ÷ 1e6.
 */
export function orderPriceUsd(order: {
  price: string;
  paymentToken: string;
  amount?: string;
}): number {
  if (!isUsdc(order.paymentToken)) return Number.NaN;
  // price and amount are both USDC base units; price is the SDK's canonical
  // field, amount a redundant fallback for the rare empty-price order.
  const raw = order.price !== "" ? order.price : (order.amount ?? "");
  const base = Number.parseFloat(raw);
  return Number.isFinite(base) && base > 0 ? base / 10 ** USDC_DECIMALS : Number.NaN;
}
