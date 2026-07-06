import { MockCapRequesterTransport } from "../adapters/mock/requester.js";
import { SignalBuyer } from "../core/signal-buyer/buyer.js";
import { InMemorySignalStore } from "../core/signal-buyer/ledger.js";
import { decide, type OwnReading, type RiskPolicy } from "../core/signal-buyer/signal.js";
import type { AllowlistEntry, BuyerBudget } from "../core/signal-buyer/policy.js";
import { systemClock } from "../ports/runtime.js";

/**
 * Credential-free S8 demo — the whole bidirectional loop, no keys, no network.
 * Shows the money-path gate (one counterparty is priced out and skipped with
 * zero escrow), a real purchase folded into an ADVISORY input, and the risk
 * gate refusing to let a bought signal authorize action on weak own-conviction.
 *
 *   pnpm --filter @hunch/oracle tsx src/worker/smoke-signal-buyer.ts
 */
async function main() {
  const transport = new MockCapRequesterTransport([
    {
      serviceId: "svc-alpha-terminal",
      agentId: "agent-alpha",
      price: "0.50",
      deliverable: {
        schema: JSON.stringify({
          probability: 0.71,
          summary: "on-chain flows turning bullish over the last 48h",
        }),
      },
    },
    {
      serviceId: "svc-overpriced-oracle",
      agentId: "agent-pricey",
      price: "9.99", // over the $1 per-order cap → skipped, no money moves
      deliverable: { text: "you will never read this" },
    },
    {
      serviceId: "svc-cheap-sentiment",
      agentId: "agent-cheap",
      price: "0.25",
      deliverable: { schema: JSON.stringify({ sentiment: 0.4 }) },
    },
  ]);

  const allowlist: AllowlistEntry[] = [
    {
      serviceId: "svc-alpha-terminal",
      agentId: "agent-alpha",
      label: "Alpha Terminal",
      category: "research",
      requirements: JSON.stringify({ token: "AIXBT", question: "flip 50m mcap?" }),
    },
    {
      serviceId: "svc-overpriced-oracle",
      agentId: "agent-pricey",
      label: "Overpriced Oracle",
      category: "research",
    },
    {
      serviceId: "svc-cheap-sentiment",
      agentId: "agent-cheap",
      label: "Cheap Sentiment",
      category: "sentiment",
    },
  ];

  const budget: BuyerBudget = { dailyCapUsd: 5, maxPriceUsd: 1 };
  const store = new InMemorySignalStore();
  const buyer = new SignalBuyer(
    { transport, store, clock: systemClock },
    { allowlist, budget, live: true },
  );

  const report = await buyer.runRound();

  console.log("\n=== S8 signal-buyer round ===");
  console.log(
    `attempted ${report.attempted} · purchased ${report.purchased} · skipped ${report.skipped} · failed ${report.failed} · spent $${report.spentUsd.toFixed(2)}`,
  );
  for (const p of report.purchases) {
    console.log(
      `  · ${p.label.padEnd(20)} ${p.status.padEnd(10)} $${p.priceUsd.toFixed(2)}  ${p.reason ?? p.signalId ?? ""}`,
    );
  }

  console.log("\n=== who we hired (public feed) ===");
  for (const c of report.hired) {
    console.log(
      `  · ${c.label} — ${c.orders} order(s), $${c.spentUsd.toFixed(2)} spent (${c.category})`,
    );
  }

  // Fold the purchased advisories into a decision — bounded by our risk policy.
  const policy: RiskPolicy = {
    maxAdvisoryNudge: 0.05,
    maxSizeUsd: 100,
    minOwnConfidence: "medium",
  };

  const ownMedium: OwnReading = {
    probability: 0.62,
    confidence: "medium",
    source: "pool_implied_odds (our own forecast)",
  };
  const informed = decide(ownMedium, report.signals, policy);
  console.log("\n=== decision informed by purchased signals ===");
  console.log(
    `own 0.62 (medium) → ${informed.probability.toFixed(3)}; authorized size $${informed.authorizedSizeUsd.toFixed(
      2,
    )}`,
  );
  console.log(`  ${informed.rationale}`);

  // Same signals, but our OWN conviction is weak — the risk gate must refuse to
  // let a bought signal authorize action. This is the never-overrides invariant.
  const ownWeak: OwnReading = {
    probability: 0.62,
    confidence: "prior_only",
    source: "no betting history — seeded prior only",
  };
  const gated = decide(ownWeak, report.signals, policy);
  console.log("\n=== risk gate: weak own-conviction ===");
  console.log(
    `own 0.62 (prior_only) → authorized size $${gated.authorizedSizeUsd.toFixed(2)} (must be $0.00)`,
  );
  console.log(`  ${gated.rationale}`);

  if (gated.authorizedSizeUsd !== 0) {
    throw new Error("INVARIANT VIOLATED: advisory authorized action on weak own-conviction");
  }
  console.log("\n✅ S8 smoke: gate skips overpriced, advisory informs, risk gate holds.");
  process.exit(0);
}

main().catch((error) => {
  console.error("[smoke-signal-buyer] failed —", error);
  process.exit(1);
});
