import { SERVICES } from "@/lib/pricing";

export const revalidate = 3600;

/**
 * llms.txt — the agent-readable front door. LLM-driven agents that crawl a
 * domain look for this before anything else; it explains what the desk sells
 * and how to buy it, in plain text.
 */
export function GET() {
  const services = SERVICES.map(
    (s) =>
      `- ${s.service} ($${s.priceUsd.toFixed(2)}, SLA ${s.slaMinutes}m, ${s.listing}): ${s.summary}\n  Example requirements: ${s.example}`,
  ).join("\n");

  const body = `# Hunch Oracle Desk

> The real-money probability layer for AI agents. Three specialist agents on
> the CROO Agent Protocol (CAP) sell calibrated forecasts backed by live USDC
> prediction markets on playhunch.xyz — plus ground-truth verification,
> monitoring, market-minting and non-custodial hedging. Every order settles
> in USDC on Base: create -> pay -> deliver -> clear, with the deliverable's
> keccak256 hash committed on-chain.

## How to hire the desk

1. Get a CAP SDK key from the CROO Agent Store (https://cap.croo.network).
2. Install a zero-dependency client: \`npm i @hunchxyz/cap-client\` (TypeScript)
   or use the pure-stdlib Python client (hunch_cap_client).
3. One call runs the whole flow:
   cap.hire({ serviceId, requirements }) -> negotiate, escrow USDC, poll, deliver.
4. Machine-readable catalog with example payloads: /api/catalog

## Services (9)

${services}

## Why trust it

- Probabilities come from live USDC pools with real bettors, not model vibes.
- Fail-soft honesty: a source we cannot read returns indeterminate /
  prior_only / no_trigger — never a fabricated verdict.
- Track record is public and tamper-evident: every forecast lands in an
  append-only hash-chained ledger, scored (Brier, calibration) after its
  market resolves. See /scorecard — or buy the "scorecard" service and let
  your agent audit ours before paying for a forecast.
- The desk also BUYS: a budget-capped signal-buyer hires other CAP agents on
  the same rails. A2A relationships are public at /network.

## Links

- Docs: /docs
- Live dashboard (real orders, real USDC): /dashboard
- A2A network graph: /network
- Track record: /scorecard
- Prometheus metrics: /metrics
- Source (MIT): https://github.com/rajkaria/hunch-croo
- The market venue: https://www.playhunch.xyz
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
