/**
 * degen-trader — a fork-me example requester for the Hunch Oracle Desk.
 *
 * Buys a forecast + sentiment for a token before "sizing a position", then
 * prints what a disciplined degen would do. Adapt the strategy block to your
 * own agent — the point is the two paid CAP calls.
 *
 * Setup:
 *   export CROO_SDK_KEY=croo_sk_...          # agent.croo.network (free)
 *   export FORECAST_SERVICE_ID=...           # from the Hunch Oracle listing
 *   export SENTIMENT_SERVICE_ID=...
 *   node index.mjs '$AIXBT' 'Will $AIXBT reach $50M market cap by July 15?'
 */
import { CapClient } from "@hunchxyz/cap-client";

const token = (process.argv[2] ?? "$AIXBT").replace(/^\$/, "").toUpperCase();
const question =
  process.argv[3] ?? `Will $${token} reach $50M market cap by July 15?`;

const client = new CapClient({ sdkKey: process.env.CROO_SDK_KEY });

console.log(`hiring the desk about $${token}…`);

const [forecast, sentiment] = await Promise.all([
  client.hire({
    serviceId: process.env.FORECAST_SERVICE_ID,
    requirements: { question, token },
  }),
  client.hire({
    serviceId: process.env.SENTIMENT_SERVICE_ID,
    requirements: { token },
  }),
]);

const f = forecast.deliverable;
const s = sentiment.deliverable;

console.log(`\nforecast  → ${f.status}`, f.status === "ok"
  ? `p=${f.probability} (${f.confidence}) pool=$${f.poolUsd} ${f.marketUrl}`
  : `(${f.spawnHint ? "spawnHint available — mint the market for $2.50" : ""})`);
console.log(`sentiment → ${s.status}`, s.status === "ok"
  ? `${s.lean} conviction=${s.conviction} quality=${s.quality} over ${s.marketsQuoted} books`
  : "");

// ── the "strategy" (replace with your agent's brain) ─────────────────────────
if (f.status === "ok" && s.status === "ok") {
  const bullish = f.probability >= 0.6 && s.lean === "bullish";
  const bearish = f.probability <= 0.4 && s.lean === "bearish";
  console.log(
    `\ndecision  → ${
      bullish ? `size a YES position on ${f.marketSlug}` :
      bearish ? `size a NO position on ${f.marketSlug}` :
      "stay flat — the crowd isn't paying you to disagree"
    }`,
  );
} else if (f.status === "no_market") {
  console.log(
    "\ndecision  → no market prices this yet. Feed f.spawnHint.input to the spawn service and BE the market.",
  );
}

console.log(`\nsettlements on Base: forecast=${forecast.txHashes.clear ?? "…"} sentiment=${sentiment.txHashes.clear ?? "…"}`);
