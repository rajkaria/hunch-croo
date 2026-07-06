import type { Clock } from "../../ports/runtime.js";
import type { CapOrder } from "../../ports/cap.js";
import type { ProvenanceEntry, Confidence } from "../forecast/composer.js";
import type { AllowlistEntry } from "./policy.js";

/**
 * A signal we PURCHASED from an external CAP agent. It carries provenance and a
 * hard-coded `authority: "advisory"` — the whole point of the type is that a
 * bought signal can *inform* a decision but can never *authorize* money on its
 * own. Our own reading (the pool-implied forecast) stays the only authority.
 */
export interface ExternalSignal {
  id: string;
  source: "cap";
  serviceId: string;
  agentId?: string;
  label: string;
  category: string;
  /** Advisory authority is not a field a caller sets — it is the invariant. */
  authority: "advisory";
  /** Best-effort normalized reading pulled from the deliverable. */
  reading: {
    probability?: number;
    sentiment?: number;
    summary?: string;
  };
  raw: { text?: string; schema?: string };
  provenance: ProvenanceEntry;
  purchasedAt: string;
}

function clamp01(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (value < 0 || value > 1) return undefined;
  return value;
}

/**
 * Turn a purchased deliverable into an ExternalSignal. Best-effort and
 * NEVER throws: an unparseable or empty deliverable still yields a valid
 * advisory signal (raw text preserved, reading empty). We do not fabricate a
 * probability we were not given.
 */
export function normalizeDeliverable(args: {
  entry: AllowlistEntry;
  order: CapOrder;
  delivery: { text?: string; schema?: string };
  clock: Clock;
  seq: number;
}): ExternalSignal {
  const { entry, order, delivery, clock, seq } = args;
  const purchasedAt = clock.now().toISOString();

  const reading: ExternalSignal["reading"] = {};
  const rawJson = delivery.schema ?? delivery.text;
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      const prob = pickNumber(parsed, ["probability", "prob", "yesProbability"]);
      if (prob !== undefined) {
        const p = clamp01(prob > 1 ? prob / 100 : prob);
        if (p !== undefined) reading.probability = p;
      }
      const sentiment = pickNumber(parsed, ["sentiment", "conviction", "score"]);
      if (sentiment !== undefined) reading.sentiment = sentiment;
      const summary = pickString(parsed, ["summary", "note", "headline"]);
      if (summary !== undefined) reading.summary = summary;
    } catch {
      // Non-JSON deliverable: keep the raw text, leave the reading empty.
    }
  }

  return {
    id: `sig-${order.orderId}-${seq}`,
    source: "cap",
    serviceId: entry.serviceId,
    ...(entry.agentId !== undefined ? { agentId: entry.agentId } : {}),
    label: entry.label,
    category: entry.category,
    authority: "advisory",
    reading,
    raw: {
      ...(delivery.text !== undefined ? { text: delivery.text } : {}),
      ...(delivery.schema !== undefined ? { schema: delivery.schema } : {}),
    },
    provenance: {
      source: `CAP purchase from ${entry.label} (${entry.serviceId})`,
      url: `cap://order/${order.orderId}`,
      readAt: purchasedAt,
      note: "advisory input — never authorizes a money action on its own",
    },
    purchasedAt,
  };
}

function pickNumber(
  obj: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

// ── Advisory blend: fold purchased signals into a decision, bounded ──────────

const CONFIDENCE_RANK: Record<Confidence, number> = {
  prior_only: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/** Our own authoritative reading (e.g. the pool-implied forecast). */
export interface OwnReading {
  probability: number;
  confidence: Confidence;
  source: string;
  provenance?: ProvenanceEntry[];
}

/**
 * The risk policy external advisories can NEVER override. These bounds are set
 * by us, not by a counterparty, and are the reason a purchased signal can move
 * a decision only within a leash.
 */
export interface RiskPolicy {
  /** Max absolute nudge advisories may apply to our probability. */
  maxAdvisoryNudge: number;
  /** Hard ceiling on any position size a decision may authorize. */
  maxSizeUsd: number;
  /** Below this OWN confidence, advisories cannot make us act at all. */
  minOwnConfidence: Confidence;
}

export interface Decision {
  /** Base probability, nudged within ±policy.maxAdvisoryNudge. */
  probability: number;
  /** Never exceeds policy.maxSizeUsd; 0 when the risk gate blocks action. */
  authorizedSizeUsd: number;
  actedOnAdvisory: boolean;
  advisoriesConsidered: number;
  advisoryLabels: string[];
  rationale: string;
  provenance: ProvenanceEntry[];
}

/** Size we would take on our OWN conviction alone, before any advisory. */
function baseSizeFor(confidence: Confidence, maxSizeUsd: number): number {
  const fraction: Record<Confidence, number> = {
    high: 1,
    medium: 0.5,
    low: 0.2,
    prior_only: 0,
  };
  return maxSizeUsd * fraction[confidence];
}

/**
 * Fold advisory signals into a decision. The invariants this function
 * guarantees (and the tests pin):
 *
 *  1. probability moves at most ±maxAdvisoryNudge from our own reading;
 *  2. authorizedSizeUsd never exceeds what our OWN confidence warrants, and
 *     never exceeds policy.maxSizeUsd — advisories can only shrink it;
 *  3. if our own confidence is below minOwnConfidence, no advisory can make us
 *     act: authorizedSizeUsd is 0. Purchased conviction is not our conviction.
 */
export function decide(
  own: OwnReading,
  advisories: readonly ExternalSignal[],
  policy: RiskPolicy,
): Decision {
  const provenance: ProvenanceEntry[] = [
    ...(own.provenance ?? []),
    ...advisories.map((s) => s.provenance),
  ];
  const advisoryLabels = advisories.map((s) => s.label);

  const numeric = advisories
    .map((s) => s.reading.probability)
    .filter((p): p is number => typeof p === "number");

  let probability = own.probability;
  let nudge = 0;
  if (numeric.length > 0) {
    const mean = numeric.reduce((a, b) => a + b, 0) / numeric.length;
    const desired = mean - own.probability;
    nudge = Math.max(
      -policy.maxAdvisoryNudge,
      Math.min(policy.maxAdvisoryNudge, desired),
    );
    probability = Math.max(0, Math.min(1, own.probability + nudge));
  }

  const ownRank = CONFIDENCE_RANK[own.confidence];
  const gateRank = CONFIDENCE_RANK[policy.minOwnConfidence];
  const riskGateOpen = ownRank >= gateRank;

  const ownSize = Math.min(
    baseSizeFor(own.confidence, policy.maxSizeUsd),
    policy.maxSizeUsd,
  );

  // Advisories that disagree with our direction (relative to a 0.5 prior)
  // shrink size; agreement leaves it at our own conviction — never above.
  let sizeFactor = 1;
  if (numeric.length > 0) {
    const ownEdge = own.probability - 0.5;
    const advEdge =
      numeric.reduce((a, b) => a + b, 0) / numeric.length - 0.5;
    const agree = Math.sign(ownEdge) === Math.sign(advEdge) || advEdge === 0;
    sizeFactor = agree ? 1 : 0.5;
  }

  const authorizedSizeUsd = riskGateOpen ? ownSize * sizeFactor : 0;

  const rationale = !riskGateOpen
    ? `own confidence ${own.confidence} is below the ${policy.minOwnConfidence} risk gate — advisories cannot authorize action`
    : numeric.length === 0
      ? "no numeric advisory signal; decision rests on our own reading"
      : `own reading nudged ${nudge >= 0 ? "+" : ""}${nudge.toFixed(3)} by ${
          numeric.length
        } advisory signal(s), size ${sizeFactor === 1 ? "held at" : "halved from"} own conviction`;

  return {
    probability,
    authorizedSizeUsd,
    actedOnAdvisory: riskGateOpen && numeric.length > 0,
    advisoriesConsidered: advisories.length,
    advisoryLabels,
    rationale,
    provenance,
  };
}
