import type { CapOrder } from "../../ports/cap.js";
import type { Clock } from "../../ports/runtime.js";
import type { ForecastRecordDraft } from "./entry.js";

/**
 * Turn a delivered `forecast` payload into a ledger draft — or null when there
 * is nothing scoreable. This is the one bridge between a service output and the
 * track record; keeping it a pure, typed helper lets the provider loop stay
 * thin and lets us unit-test the recording rules without CAP.
 *
 * The recorded claim is deliberately *binary*: "the market's resolvedOutcome
 * will equal predictedOutcomeKey", at the desk's stated probability. That makes
 * Brier / log-loss unambiguous for both YES/NO and ladder markets.
 *  - YES/NO: predictedOutcomeKey = "yes", probability = the desk's P(yes). We
 *    sell a YES probability, so we score a YES probability — even a low one.
 *  - Ladder: predictedOutcomeKey = the top-priced outcome, probability = its
 *    implied price (exactly the `probability` the composer already reported).
 */
export function extractForecastRecord(
  payload: Record<string, unknown>,
  order: CapOrder,
  txHash: string | null,
  clock: Clock,
): ForecastRecordDraft | null {
  if (payload.service !== "forecast" || payload.status !== "ok") return null;

  const marketId = payload.marketId;
  const deadlineAt = payload.deadlineAt;
  const probability = payload.probability;
  if (
    typeof marketId !== "string" ||
    typeof deadlineAt !== "string" ||
    typeof probability !== "number" ||
    !Number.isFinite(probability)
  ) {
    return null;
  }

  const odds =
    payload.odds && typeof payload.odds === "object" && !Array.isArray(payload.odds)
      ? (payload.odds as Record<string, unknown>)
      : {};
  const predictedOutcomeKey = pickPredictedKey(payload, odds);
  if (!predictedOutcomeKey) return null;

  const question =
    typeof payload.question === "string"
      ? payload.question
      : typeof payload.marketQuestion === "string"
        ? payload.marketQuestion
        : "";

  return {
    orderId: order.orderId,
    txHash,
    recordedAt: clock.now().toISOString(),
    question,
    marketId,
    marketSlug: typeof payload.marketSlug === "string" ? payload.marketSlug : marketId,
    marketUrl: typeof payload.marketUrl === "string" ? payload.marketUrl : "",
    predictedOutcomeKey,
    probability,
    confidence: typeof payload.confidence === "string" ? payload.confidence : "unknown",
    deadlineAt,
    resolution: null,
  };
}

/**
 * A YES/NO market sells a YES probability → the claim is always "yes". A ladder
 * market's claim is its top-priced outcome (argmax of the odds ladder, tie-broken
 * by key like the composer does).
 */
function pickPredictedKey(
  payload: Record<string, unknown>,
  odds: Record<string, unknown>,
): string | null {
  const keys = Object.keys(odds);
  const isBinary =
    keys.length === 2 && keys.includes("yes") && keys.includes("no");
  if (isBinary) {
    return typeof payload.side === "string" ? payload.side : "yes";
  }
  let best: { key: string; value: number } | null = null;
  for (const [key, raw] of Object.entries(odds)) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    if (
      !best ||
      raw > best.value ||
      (raw === best.value && key.localeCompare(best.key) < 0)
    ) {
      best = { key, value: raw };
    }
  }
  return best?.key ?? null;
}
