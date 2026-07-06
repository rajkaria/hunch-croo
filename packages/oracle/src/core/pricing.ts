/**
 * The one pricing table. Rendered on the docs page, quoted in listings, and
 * asserted in tests — change prices here and nowhere else.
 *
 * Philosophy: cheap enough that another hackathon team integrates on pocket
 * change; expensive enough that earnings are visible on the dashboard.
 */
export interface ServicePricing {
  /** Agent Store listing this service ships under. */
  listing: "Hunch Oracle" | "Hunch TruthCheck" | "Hunch Market Desk";
  priceUsd: number;
  slaMinutes: number;
  summary: string;
}

export const SERVICE_PRICING: Record<string, ServicePricing> = {
  forecast: {
    listing: "Hunch Oracle",
    priceUsd: 0.25,
    slaMinutes: 5,
    summary:
      "Money-weighted probability for any question, backed by live USDC prediction-market pools with full source provenance.",
  },
  sentiment: {
    listing: "Hunch Oracle",
    priceUsd: 0.1,
    slaMinutes: 5,
    summary:
      "Crowd-conviction signal for a token, aggregated across every live Hunch market that prices it.",
  },
  research: {
    listing: "Hunch Oracle",
    priceUsd: 0.5,
    slaMinutes: 10,
    summary:
      "Full research bundle for one market: live odds, pool stats, token reading, resolution criteria, related markets.",
  },
  verify: {
    listing: "Hunch TruthCheck",
    priceUsd: 0.5,
    slaMinutes: 10,
    summary:
      "Deterministic ground-truth verdict for a structured claim, read from Hunch's production resolver stack with provenance.",
  },
  watch: {
    listing: "Hunch TruthCheck",
    priceUsd: 0.5,
    slaMinutes: 120,
    summary:
      "Monitoring order: delivers when odds cross a threshold or a market resolves — or an honest no_trigger at SLA.",
  },
  spawn: {
    listing: "Hunch Market Desk",
    priceUsd: 2.5,
    slaMinutes: 10,
    summary:
      "Mints a real prediction market on playhunch.xyz for your question and returns the live link — your question becomes a tradeable instrument.",
  },
  "hedge-quote": {
    listing: "Hunch Market Desk",
    priceUsd: 1,
    slaMinutes: 10,
    summary:
      "Non-custodial hedge plan for a position: market, side, size and executable trade instructions against the live book.",
  },
  "portfolio-hedge": {
    listing: "Hunch Market Desk",
    priceUsd: 3,
    slaMinutes: 10,
    summary:
      "Non-custodial basket hedge for a whole book: one budget allocated across many positions, each priced off the live market, with portfolio aggregates and an executable trade call per leg.",
  },
};
