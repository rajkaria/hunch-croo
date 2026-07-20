#!/usr/bin/env node
/**
 * Reciprocity outreach generator.
 *
 * Paying first is the strongest cold open there is in a two-sided market: you
 * arrive with a receipt instead of a pitch. This script reads the orders our
 * signal-buyer has actually settled against other CROO agents and emits one
 * ready-to-send message per counterparty team, with the real order id and Base
 * tx hash inlined so the claim is verifiable on-chain in one click.
 *
 * It SENDS NOTHING. It prints. Copy what you want into the CROO / DoraHacks
 * channel yourself — the whole point is that a human vouches for the message.
 *
 * Usage:
 *   CROO_REQUESTER_SDK_KEY=croo_sk_... node scripts/outreach.mjs
 *   ... --json          machine-readable, for piping
 *   ... --all           include counterparties we have not paid yet (cold)
 */

const API = process.env.CROO_API_URL ?? "https://api.croo.network";
const KEY = process.env.CROO_REQUESTER_SDK_KEY ?? process.env.CROO_SDK_KEY;
const asJson = process.argv.includes("--json");
const includeCold = process.argv.includes("--all");

/** Our listings, and the one line a counterparty needs to hire each. */
const OURS = [
  ["forecast", "f1c77b72-c6d8-4481-ba33-134b7ac7e7f3", "$0.25", 'Money-weighted probability for any question, off live USDC pools'],
  ["sentiment", "d69114e5-67ed-4895-b261-90961b6e4ea5", "$0.10", "Crowd-conviction signal for a token"],
  ["verify", "286798ac-34ef-4159-96f4-d073c98a5fd2", "$0.50", "Deterministic ground-truth verdict for a structured claim"],
  ["scorecard", "51b83b1c-e535-4374-ad5c-69e010c91df2", "$0.01", "Our own track record — Brier, calibration, hash-chained ledger"],
];

const BASESCAN = (tx) => `https://basescan.org/tx/${tx}`;

async function get(path) {
  const res = await fetch(`${API}${path}`, {
    headers: KEY ? { "X-SDK-Key": KEY } : {},
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  if (!KEY) {
    console.error(
      "CROO_REQUESTER_SDK_KEY is not set. Export the buyer's key first:\n" +
        "  export CROO_REQUESTER_SDK_KEY=$(railway variables -s buyer --json | jq -r .CROO_REQUESTER_SDK_KEY)",
    );
    process.exit(1);
  }

  // What we have bought, and from whom.
  const { orders = [] } = await get(
    "/backend/v1/orders?role=buyer&page_size=100",
  );
  const settled = orders.filter((o) => o.status === "completed");

  // Public agent directory, so we can name the team rather than a UUID.
  const { agents = [] } = await get("/backend/v1/public/agents?limit=500");
  const nameOf = new Map(agents.map((a) => [a.agentId, a.name]));

  const byAgent = new Map();
  for (const o of settled) {
    const id = o.providerAgentId;
    if (!byAgent.has(id)) byAgent.set(id, []);
    byAgent.get(id).push(o);
  }

  if (includeCold) {
    for (const a of agents) {
      if (!byAgent.has(a.agentId) && !a.name.startsWith("Hunch")) {
        byAgent.set(a.agentId, []);
      }
    }
  }

  const hireLines = OURS.map(
    ([name, id, price, blurb]) => `  • ${name} (${price}) — ${blurb}\n    ${id}`,
  ).join("\n");

  const out = [];
  for (const [agentId, paid] of byAgent) {
    const team = nameOf.get(agentId) ?? agentId;
    const spend = paid.reduce((n, o) => n + Number(o.amount ?? 0), 0) / 1e6;
    const receipt = paid.find((o) => o.payTxHash) ?? paid[0];

    const opener = paid.length
      ? `We just paid for ${paid.length} order${paid.length === 1 ? "" : "s"} from ${team} — $${spend.toFixed(2)} USDC settled on Base, no notes, it worked.\n` +
        (receipt?.payTxHash
          ? `Receipt: ${BASESCAN(receipt.payTxHash)}  (order ${receipt.orderId})\n`
          : "")
      : `We run three agents on CROO and we're buying from the store, not just listing on it. ${team} is on our shortlist.\n`;

    const message =
      `${opener}\n` +
      `We're Hunch Oracle Desk — the probability layer for CAP agents. Every answer is priced off live USDC prediction markets on playhunch.xyz, and every forecast we sell goes into a public hash-chained ledger that gets scored after the market resolves. If we're wrong, it shows.\n\n` +
      `If any of your flows need a calibrated number, a ground-truth check, or a hedge, one line hires us:\n\n` +
      `${hireLines}\n\n` +
      `  npm i @hunchxyz/cap-client\n` +
      `  await cap.hire({ serviceId: "f1c77b72-c6d8-4481-ba33-134b7ac7e7f3", requirements: { question: "..." } })\n\n` +
      `Catalogue with every service_id: https://oracle.playhunch.xyz/llms.txt\n` +
      `Our track record, unedited: https://oracle.playhunch.xyz/scorecard\n\n` +
      `Happy to keep buying either way — tell us what you'd want priced.`;

    out.push({ team, agentId, ordersPaid: paid.length, spendUsd: Number(spend.toFixed(2)), message });
  }

  out.sort((a, b) => b.ordersPaid - a.ordersPaid || a.team.localeCompare(b.team));

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const warm = out.filter((o) => o.ordersPaid > 0);
  console.log(
    `\n${settled.length} settled purchase(s) across ${warm.length} counterpart${warm.length === 1 ? "y" : "ies"}.` +
      (warm.length === 0
        ? "\nNo receipts yet — the buyer loop may not have settled a round. Run with --all for cold openers.\n"
        : "\n"),
  );
  for (const o of out) {
    console.log("─".repeat(72));
    console.log(
      `${o.team}  ·  ${o.agentId}  ·  ${o.ordersPaid} paid  ·  $${o.spendUsd.toFixed(2)}${o.ordersPaid ? "  ← LEAD WITH THIS ONE" : ""}`,
    );
    console.log("─".repeat(72));
    console.log(o.message);
    console.log();
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
