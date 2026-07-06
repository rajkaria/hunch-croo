import { z } from "zod";
import type {
  HunchApi,
  HunchMarketResult,
  HunchYesNoOdds,
} from "../../ports/hunch.js";
import type { Sleeper } from "../../ports/runtime.js";
import type { ServiceContext, ServiceHandler } from "../service-registry.js";
import type { ProvenanceEntry } from "../forecast/composer.js";

/**
 * `watch` — a monitoring order. The desk polls one market until the caller's
 * trigger fires (odds crossing a threshold, or resolution) and delivers the
 * alert payload — or an honest `no_trigger` at the watch window's end. Both
 * outcomes are legitimate paid answers: the caller bought attention, not a
 * guaranteed event.
 *
 * The window is bounded by the order's SLA (minus a delivery margin) so the
 * deliverable always lands inside the escrow's deadline.
 */
export const WatchInputSchema = z.object({
  marketSlug: z.string().trim().min(1).max(120),
  trigger: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("resolution") }),
    z.object({
      kind: z.literal("oddsCross"),
      /** Probability threshold in (0,1). */
      threshold: z.number().gt(0).lt(1),
      side: z.enum(["yes", "no"]).default("yes"),
      direction: z.enum(["above", "below"]).default("above"),
    }),
  ]),
  /** Poll cadence; bounded so a caller can't make us hammer the API. */
  pollSeconds: z.number().int().min(10).max(300).default(30),
});

export type WatchInput = z.infer<typeof WatchInputSchema>;

/** Hard ceiling on any watch, SLA or not. */
const MAX_WATCH_MS = 120 * 60 * 1000;
/** Delivery margin: stop watching this long before the SLA deadline. */
const SLA_MARGIN_MS = 60 * 1000;

export interface WatchDeps {
  hunch: HunchApi;
  sleeper: Sleeper;
}

function probabilityOf(odds: HunchYesNoOdds, side: "yes" | "no"): number {
  return (side === "yes" ? odds.yesPriceCents : odds.noPriceCents) / 100;
}

export function createWatchService(deps: WatchDeps): ServiceHandler {
  return {
    name: "watch",
    async handle(ctx: ServiceContext): Promise<Record<string, unknown>> {
      const parsed = WatchInputSchema.safeParse(ctx.input);
      if (!parsed.success) {
        throw new Error(
          `invalid watch input: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
            .join(
              "; ",
            )}. Expected {"marketSlug": string, "trigger": {"kind": "resolution"} | {"kind": "oddsCross", "threshold": 0-1, "side"?: "yes"|"no", "direction"?: "above"|"below"}, "pollSeconds"?: 10-300}`,
        );
      }
      const input = parsed.data;
      const { hunch, sleeper } = deps;

      const startedAt = ctx.clock.now();
      const slaMs = ctx.order.slaDeadline
        ? Date.parse(ctx.order.slaDeadline) - startedAt.getTime() - SLA_MARGIN_MS
        : MAX_WATCH_MS;
      const windowMs = Math.min(Math.max(slaMs, 0), MAX_WATCH_MS);
      const cutoff = startedAt.getTime() + windowMs;

      // Resolve the slug up front — a bad slug is caller error (reject →
      // refund), not a no_trigger.
      const firstQuote = await hunch.quote(input.marketSlug, {
        side: "yes",
        sizeUsd: 1,
      });
      const market = firstQuote.data.market;
      const provenance: ProvenanceEntry[] = [
        {
          source: "playhunch.xyz partner quote (watch begins)",
          url: firstQuote.url,
          readAt: firstQuote.readAt,
        },
      ];

      let checks = 0;
      let lastReading: Record<string, unknown> = {};

      const base = {
        service: "watch",
        marketId: market.id,
        marketSlug: market.slug,
        marketUrl: market.links.app,
        question: market.question,
        trigger: input.trigger as unknown as Record<string, unknown>,
        watchStartedAt: startedAt.toISOString(),
      };

      while (true) {
        checks += 1;

        if (input.trigger.kind === "resolution") {
          let result: HunchMarketResult | null = null;
          try {
            const read = await hunch.result(market.id);
            result = read.data.result;
            lastReading = {
              status: result.status,
              resolvedOutcome: result.resolvedOutcome,
              readAt: read.readAt,
            };
            if (result.status === "resolved" || result.resolvedOutcome) {
              provenance.push({
                source: "playhunch.xyz partner result (trigger fired)",
                url: read.url,
                readAt: read.readAt,
              });
              return {
                ...base,
                status: "triggered",
                firedAt: ctx.clock.now().toISOString(),
                checks,
                resolution: {
                  outcome: result.resolvedOutcome,
                  outcomeLabel: result.resolvedOutcomeLabel,
                  resolvedAt: result.resolvedAt,
                  source: result.source,
                  sourceUrl: result.sourceUrl,
                  proofUrl: result.proofUrl,
                  payoutPerShareUsd: result.payoutPerShareUsd,
                },
                provenance,
                asOf: ctx.clock.now().toISOString(),
              };
            }
          } catch {
            // A failed poll is not a verdict; keep watching until the window ends.
          }
        } else {
          try {
            const read = await hunch.quote(market.id, { side: "yes", sizeUsd: 1 });
            const odds = read.data.odds as HunchYesNoOdds;
            if (typeof odds.yesPriceCents === "number") {
              const probability = probabilityOf(odds, input.trigger.side);
              lastReading = {
                probability,
                side: input.trigger.side,
                readAt: read.readAt,
              };
              const fired =
                input.trigger.direction === "above"
                  ? probability >= input.trigger.threshold
                  : probability <= input.trigger.threshold;
              if (fired) {
                provenance.push({
                  source: "playhunch.xyz partner quote (trigger fired)",
                  url: read.url,
                  readAt: read.readAt,
                });
                return {
                  ...base,
                  status: "triggered",
                  firedAt: ctx.clock.now().toISOString(),
                  checks,
                  crossing: {
                    side: input.trigger.side,
                    direction: input.trigger.direction,
                    threshold: input.trigger.threshold,
                    probability,
                    odds: { yes: odds.yesPriceCents, no: odds.noPriceCents },
                    poolUsd: read.data.stats.totalPoolUsd,
                  },
                  provenance,
                  asOf: ctx.clock.now().toISOString(),
                };
              }
            }
          } catch {
            // Keep watching; transient quote failures don't end the order.
          }
        }

        const remaining = cutoff - ctx.clock.now().getTime();
        if (remaining <= 0) break;
        await sleeper.sleep(Math.min(input.pollSeconds * 1000, remaining));
      }

      return {
        ...base,
        status: "no_trigger",
        checks,
        watchedForSeconds: Math.round(
          (ctx.clock.now().getTime() - startedAt.getTime()) / 1000,
        ),
        lastReading,
        note: "The trigger did not fire inside the watch window. That is the honest answer — you paid for attention, not for an event to happen.",
        provenance,
        asOf: ctx.clock.now().toISOString(),
      };
    },
  };
}
