/**
 * Pricing table for the web surfaces. Mirrors
 * `packages/oracle/src/core/pricing.ts` (the worker's source of truth) — the
 * web app is deliberately dependency-free of the worker so it deploys alone.
 *
 * `serviceId` / `agentId` are the REAL CAP identifiers minted by the CROO
 * store — the same UUIDs the workers key their handlers on. They are public
 * (anyone can read them off the Agent Store) and they are what makes the
 * machine-readable surfaces actually actionable: without the serviceId, an
 * agent that reads /api/catalog still cannot call `hire()`. Verified against
 * https://api.croo.network/backend/v1/public/agents/<agentId> on 2026-07-20.
 */
export const AGENT_IDS = {
  "Hunch Oracle": "10582fea-07e1-423c-bc3b-dfa02de2691f",
  "Hunch TruthCheck": "990fa2a5-9be6-4632-864c-c8d23a09048f",
  "Hunch Market Desk": "d019b1ba-c933-4137-8cbc-30d37126ee50",
} as const;

export type Listing = keyof typeof AGENT_IDS;

export interface ServicePricing {
  service: string;
  listing: Listing;
  /** Real CAP service UUID — pass straight to `cap.hire({ serviceId })`. */
  serviceId: string;
  priceUsd: number;
  slaMinutes: number;
  summary: string;
  example: string;
}

export const SERVICES: ServicePricing[] = [
  {
    service: "forecast",
    listing: "Hunch Oracle",
    serviceId: "f1c77b72-c6d8-4481-ba33-134b7ac7e7f3",
    priceUsd: 0.25,
    slaMinutes: 5,
    summary:
      "Money-weighted probability for any question, backed by live USDC prediction-market pools with full source provenance.",
    example: '{"question": "Will $AIXBT reach $50M market cap by July 15?"}',
  },
  {
    service: "sentiment",
    listing: "Hunch Oracle",
    serviceId: "d69114e5-67ed-4895-b261-90961b6e4ea5",
    priceUsd: 0.1,
    slaMinutes: 5,
    summary:
      "Crowd-conviction signal for a token, aggregated across every live Hunch market that prices it.",
    example: '{"token": "ANSEM"}',
  },
  {
    service: "research",
    listing: "Hunch Oracle",
    serviceId: "a722d355-cbfb-4b84-adec-e1576264b34e",
    priceUsd: 0.5,
    slaMinutes: 10,
    summary:
      "Full research bundle for one market: live odds, pool stats, token reading, resolution criteria, related markets.",
    example: '{"marketSlug": "ansem-flip-pump"}',
  },
  {
    service: "verify",
    listing: "Hunch TruthCheck",
    serviceId: "286798ac-34ef-4159-96f4-d073c98a5fd2",
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
    serviceId: "6d044163-6ba7-4f14-a2a6-8f9fdff262e8",
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
    serviceId: "dafdec76-8e8f-42b3-a3b0-6d9186714481",
    priceUsd: 2.5,
    slaMinutes: 10,
    summary:
      "Mints a real prediction market on playhunch.xyz for your question and returns the live link — your question becomes a tradeable instrument.",
    example: '{"token": "VIRTUAL", "multiplier": 2, "horizonDays": 30}',
  },
  {
    service: "hedge-quote",
    listing: "Hunch Market Desk",
    serviceId: "9c02208a-ac8f-4e84-a1ac-bd8fa46b3f36",
    priceUsd: 1,
    slaMinutes: 10,
    summary:
      "Non-custodial hedge plan for a position: market, side, size and executable trade instructions against the live book.",
    example: '{"marketSlug": "ansem-flip-pump", "side": "yes", "stakeUsd": 5}',
  },
  {
    service: "portfolio-hedge",
    listing: "Hunch Market Desk",
    serviceId: "9eccc75e-bc3f-43e3-84a8-153c67a89b75",
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
    serviceId: "51b83b1c-e535-4374-ad5c-69e010c91df2",
    // $0.01 is what the listing actually charges on the store — the cheapest
    // way to audit the desk before trusting it with a real question.
    priceUsd: 0.01,
    slaMinutes: 5,
    summary:
      "The desk's own track record, scored honestly: Brier score, hit-rate and calibration across every delivered forecast that has since resolved, read from an append-only hash-chained ledger.",
    example: "{}",
  },
];

/** The agent that fulfils a given service — for the "who do I hire" surfaces. */
export function agentIdForService(service: ServicePricing): string {
  return AGENT_IDS[service.listing];
}
