/**
 * Pricing table for the web surfaces. Mirrors
 * `packages/oracle/src/core/pricing.ts` (the worker's source of truth) — the
 * web app is deliberately dependency-free of the worker so it deploys alone.
 */
export interface ServicePricing {
  service: string;
  listing: "Hunch Oracle" | "Hunch TruthCheck" | "Hunch Market Desk";
  priceUsd: number;
  slaMinutes: number;
  summary: string;
  example: string;
}

export const SERVICES: ServicePricing[] = [
  {
    service: "forecast",
    listing: "Hunch Oracle",
    priceUsd: 0.25,
    slaMinutes: 5,
    summary:
      "Money-weighted probability for any question, backed by live USDC prediction-market pools with full source provenance.",
    example: '{"question": "Will $AIXBT reach $50M market cap by July 15?"}',
  },
  {
    service: "sentiment",
    listing: "Hunch Oracle",
    priceUsd: 0.1,
    slaMinutes: 5,
    summary:
      "Crowd-conviction signal for a token, aggregated across every live Hunch market that prices it.",
    example: '{"token": "ANSEM"}',
  },
  {
    service: "research",
    listing: "Hunch Oracle",
    priceUsd: 0.5,
    slaMinutes: 10,
    summary:
      "Full research bundle for one market: live odds, pool stats, token reading, resolution criteria, related markets.",
    example: '{"marketSlug": "ansem-flip-pump"}',
  },
  {
    service: "verify",
    listing: "Hunch TruthCheck",
    priceUsd: 0.5,
    slaMinutes: 10,
    summary:
      "Deterministic ground-truth verdict for a structured claim, read from Hunch's production resolver stack with provenance.",
    example:
      '{"family": "price_at_least", "token": "BTC", "lineUsd": 100000, "onDay": "2026-07-01"}',
  },
  {
    service: "watch",
    listing: "Hunch TruthCheck",
    priceUsd: 0.5,
    slaMinutes: 120,
    summary:
      "Monitoring order: delivers when odds cross a threshold or a market resolves — or an honest no_trigger at SLA.",
    example:
      '{"marketSlug": "ansem-flip-pump", "trigger": {"kind": "oddsCross", "threshold": 0.7}}',
  },
  {
    service: "spawn",
    listing: "Hunch Market Desk",
    priceUsd: 2.5,
    slaMinutes: 10,
    summary:
      "Mints a real prediction market on playhunch.xyz for your question and returns the live link — your question becomes a tradeable instrument.",
    example: '{"token": "VIRTUAL", "multiplier": 2, "horizonDays": 30}',
  },
  {
    service: "hedge-quote",
    listing: "Hunch Market Desk",
    priceUsd: 1,
    slaMinutes: 10,
    summary:
      "Non-custodial hedge plan for a position: market, side, size and executable trade instructions against the live book.",
    example: '{"marketSlug": "ansem-flip-pump", "side": "yes", "stakeUsd": 5}',
  },
  {
    service: "portfolio-hedge",
    listing: "Hunch Market Desk",
    priceUsd: 3,
    slaMinutes: 10,
    summary:
      "Non-custodial basket hedge for a whole book: one budget allocated across many positions, each priced off the live market, with portfolio aggregates, a same-instrument correlation flag, and an executable trade call per leg.",
    example:
      '{"budgetUsd": 30, "positions": [{"marketSlug": "aixbt-50m", "side": "yes", "exposureUsd": 300}, {"marketSlug": "ansem-flip-pump", "side": "no", "exposureUsd": 100}]}',
  },
  {
    service: "scorecard",
    listing: "Hunch Oracle",
    priceUsd: 0.1,
    slaMinutes: 5,
    summary:
      "The desk's own track record, scored honestly: Brier score, hit-rate and calibration across every delivered forecast that has since resolved, read from an append-only hash-chained ledger.",
    example: "{}",
  },
];
