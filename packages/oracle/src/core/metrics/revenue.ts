import type { ServicePricing } from "../pricing.js";

/**
 * Deterministic revenue accounting from the desk's own delivery log. This is
 * *booked revenue at list price* — delivered count x the published price for
 * each service. It is intentionally distinct from the on-chain settled total the
 * dashboard reads off CROO: this is what the desk *should* have earned for what
 * it delivered, computed from `SERVICE_PRICING` and nothing else. No LLM, no
 * network, no funds — pure arithmetic.
 */
export interface RevenueLine {
  service: string;
  /** Store listing the service ships under, or "unlisted" (e.g. the `echo` spike). */
  listing: string;
  delivered: number;
  priceUsd: number;
  revenueUsd: number;
}

export interface RevenueRollup {
  lines: RevenueLine[];
  totalDelivered: number;
  totalUsd: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Roll up delivered-per-service counts into revenue lines. A delivered service
 * with no pricing row (e.g. the `echo` spike) contributes
 * `priceUsd: 0` but is still counted in `delivered`, so the throughput picture
 * stays honest. Lines are sorted by service name for a stable exposition.
 */
export function revenueByService(
  deliveredByService: Record<string, number>,
  pricing: Record<string, ServicePricing>,
): RevenueRollup {
  const lines: RevenueLine[] = Object.entries(deliveredByService)
    .map(([service, delivered]) => {
      const priced = pricing[service];
      const priceUsd = priced?.priceUsd ?? 0;
      const listing = priced?.listing ?? "unlisted";
      return {
        service,
        listing,
        delivered,
        priceUsd,
        revenueUsd: round2(delivered * priceUsd),
      };
    })
    .sort((a, b) => (a.service < b.service ? -1 : a.service > b.service ? 1 : 0));

  return {
    lines,
    totalDelivered: lines.reduce((sum, l) => sum + l.delivered, 0),
    totalUsd: round2(lines.reduce((sum, l) => sum + l.revenueUsd, 0)),
  };
}
