import { NextResponse } from "next/server";
import { SERVICES } from "@/lib/pricing";
import { agentIds } from "@/lib/croo";

export const revalidate = 3600;

/**
 * Machine-readable service catalog — the surface an agent (or another
 * hackathon team) reads to integrate the desk without scraping HTML.
 * Deliberately static + dependency-free: it mirrors `lib/pricing.ts`,
 * the same source the human landing page renders.
 */
export function GET() {
  return NextResponse.json(
    {
      name: "Hunch Oracle Desk",
      tagline:
        "The real-money probability layer for AI agents — calibrated forecasts backed by live USDC prediction markets on playhunch.xyz.",
      protocol: {
        name: "CROO Agent Protocol (CAP)",
        store: "https://cap.croo.network",
        settlement: "USDC on Base — create → pay → deliver → clear",
        deliverableHash:
          "keccak256 over deterministic JSON serialization; reproducible byte-for-byte",
      },
      agents: [
        {
          listing: "Hunch Oracle",
          services: ["forecast", "sentiment", "research", "scorecard"],
        },
        { listing: "Hunch TruthCheck", services: ["verify", "watch"] },
        {
          listing: "Hunch Market Desk",
          services: ["spawn", "hedge-quote", "portfolio-hedge"],
        },
      ],
      agentIds: agentIds(),
      services: SERVICES.map((s) => ({
        service: s.service,
        listing: s.listing,
        priceUsd: s.priceUsd,
        slaMinutes: s.slaMinutes,
        summary: s.summary,
        exampleRequirements: JSON.parse(s.example) as unknown,
      })),
      clients: {
        typescript: "npm: @hunchxyz/cap-client (zero-dependency)",
        python: "packages/py-client — pure stdlib, no dependencies",
      },
      links: {
        docs: "https://oracle.playhunch.xyz/docs",
        dashboard: "https://oracle.playhunch.xyz/dashboard",
        scorecard: "https://oracle.playhunch.xyz/scorecard",
        network: "https://oracle.playhunch.xyz/network",
        metrics: "https://oracle.playhunch.xyz/metrics",
        source: "https://github.com/rajkaria/hunch-croo",
        markets: "https://www.playhunch.xyz",
      },
      honesty: {
        failSoft:
          "Degraded sources return indeterminate / prior_only / no_trigger — never a fabricated verdict.",
        trackRecord:
          "Every forecast is appended to a hash-chained ledger and scored (Brier, calibration) after its market resolves.",
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
