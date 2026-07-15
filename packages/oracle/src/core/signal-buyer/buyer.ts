import type { CapRequesterTransport } from "../../ports/cap.js";
import type { Clock, OracleLogger } from "../../ports/runtime.js";
import {
  decidePurchase,
  orderPriceUsd,
  utcDay,
  type AllowlistEntry,
  type BuyerBudget,
} from "./policy.js";
import {
  summarizeCounterparties,
  type CounterpartySummary,
  type Purchase,
  type SignalStore,
} from "./ledger.js";
import { normalizeDeliverable, type ExternalSignal } from "./signal.js";
import { buyOnce, type PayGate } from "./purchase.js";

/**
 * The signal-buyer: hires the human-curated allowlist of external CAP agents,
 * one at a time, each behind the money-path gate. Purchased signals become
 * ADVISORY inputs to our own decisions (see signal.ts#decide) — they are never
 * a money authority. Every attempt lands in the ledger, cap-safe: because the
 * round is sequential, each pay-gate sees the fully-settled spend of the ones
 * before it.
 *
 * `live: false` is a real dry run — it decides against each counterparty's
 * per-entry cap and logs what it WOULD do, touching neither the network nor a
 * dollar of escrow.
 */
export interface SignalBuyerConfig {
  allowlist: AllowlistEntry[];
  budget: BuyerBudget;
  live: boolean;
}

export interface SignalBuyerDeps {
  transport: CapRequesterTransport;
  store: SignalStore;
  clock: Clock;
  logger?: OracleLogger;
  timeoutMs?: number;
}

export interface BuyerRoundReport {
  day: string;
  live: boolean;
  attempted: number;
  purchased: number;
  skipped: number;
  failed: number;
  spentUsd: number;
  signals: ExternalSignal[];
  purchases: Purchase[];
  hired: CounterpartySummary[];
}

export class SignalBuyer {
  private seq = 0;

  constructor(
    private readonly deps: SignalBuyerDeps,
    private readonly config: SignalBuyerConfig,
  ) {}

  async runRound(): Promise<BuyerRoundReport> {
    const { store, clock, logger } = this.deps;
    const { allowlist, budget, live } = this.config;
    const day = utcDay(clock.now());

    const signals: ExternalSignal[] = [];
    const roundPurchases: Purchase[] = [];

    for (const entry of allowlist) {
      if (!live) {
        roundPurchases.push(this.paperDecision(entry, day));
        continue;
      }

      const gate: PayGate = (order) => {
        const priceUsd = orderPriceUsd(order);
        const decision = decidePurchase({
          entry,
          priceUsd,
          budget,
          spend: store.spendOn(day),
        });
        return decision.approved
          ? { pay: true }
          : { pay: false, reason: `${decision.code}: ${decision.reason}` };
      };

      const requestedAt = clock.now().toISOString();
      const outcome = await buyOnce(
        {
          transport: this.deps.transport,
          clock,
          ...(logger !== undefined ? { logger } : {}),
          ...(this.deps.timeoutMs !== undefined
            ? { timeoutMs: this.deps.timeoutMs }
            : {}),
        },
        {
          serviceId: entry.serviceId,
          ...(entry.requirements !== undefined
            ? { requirements: entry.requirements }
            : {}),
          gate,
        },
      );

      const priceUsd =
        outcome.order !== undefined
          ? orderPriceUsd(outcome.order)
          : Number.NaN;

      if (outcome.status === "delivered" && outcome.delivery) {
        const signal = normalizeDeliverable({
          entry,
          order: outcome.order!,
          delivery: outcome.delivery,
          clock,
          seq: ++this.seq,
        });
        signals.push(signal);
        const purchase: Purchase = {
          id: signal.id,
          serviceId: entry.serviceId,
          ...(entry.agentId !== undefined ? { agentId: entry.agentId } : {}),
          label: entry.label,
          category: entry.category,
          status: "delivered",
          priceUsd: Number.isFinite(priceUsd) ? priceUsd : 0,
          requestedAt,
          settledAt: clock.now().toISOString(),
          ...(outcome.orderId !== undefined ? { orderId: outcome.orderId } : {}),
          ...(outcome.payTxHash !== undefined
            ? { payTxHash: outcome.payTxHash }
            : {}),
          signalId: signal.id,
        };
        store.record(purchase);
        roundPurchases.push(purchase);
      } else {
        const purchase: Purchase = {
          id: `att-${day}-${++this.seq}`,
          serviceId: entry.serviceId,
          ...(entry.agentId !== undefined ? { agentId: entry.agentId } : {}),
          label: entry.label,
          category: entry.category,
          status: outcome.status === "delivered" ? "failed" : outcome.status,
          priceUsd: 0,
          requestedAt,
          ...(outcome.orderId !== undefined ? { orderId: outcome.orderId } : {}),
          ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
        };
        store.record(purchase);
        roundPurchases.push(purchase);
      }
    }

    const spentUsd = roundPurchases
      .filter((p) => p.status === "delivered")
      .reduce((sum, p) => sum + p.priceUsd, 0);

    return {
      day,
      live,
      attempted: allowlist.length,
      purchased: roundPurchases.filter((p) => p.status === "delivered").length,
      skipped: roundPurchases.filter((p) => p.status === "skipped").length,
      failed: roundPurchases.filter(
        (p) => p.status === "failed" || p.status === "rejected",
      ).length,
      spentUsd,
      signals,
      purchases: roundPurchases,
      hired: summarizeCounterparties(store.list()),
    };
  }

  /** Dry-run: decide against the declared cap, move nothing. */
  private paperDecision(entry: AllowlistEntry, day: string): Purchase {
    const assumedPrice = entry.maxPriceUsd ?? this.config.budget.maxPriceUsd;
    const decision = decidePurchase({
      entry,
      priceUsd: assumedPrice,
      budget: this.config.budget,
      spend: this.deps.store.spendOn(day),
    });
    return {
      id: `paper-${day}-${++this.seq}`,
      serviceId: entry.serviceId,
      ...(entry.agentId !== undefined ? { agentId: entry.agentId } : {}),
      label: entry.label,
      category: entry.category,
      status: "skipped",
      priceUsd: 0,
      requestedAt: this.deps.clock.now().toISOString(),
      reason: decision.approved
        ? `dry_run: would hire @ ~$${assumedPrice}`
        : `dry_run would skip — ${decision.code}: ${decision.reason}`,
    };
  }
}
