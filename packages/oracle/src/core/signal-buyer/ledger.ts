import type { SpendSnapshot } from "./policy.js";
import { utcDay } from "./policy.js";

/**
 * The signal-buyer's ledger: every hire attempt, its outcome, and how much
 * money moved. It is the source of truth for the daily-cap accounting (a
 * purchase counts against the cap the moment we pay) and for the public
 * "who we hired" feed.
 *
 * Only DELIVERED purchases moved money. Skipped/rejected/failed attempts are
 * recorded for honesty (and to show the gate working) but cost $0.
 */
export type PurchaseStatus =
  | "delivered" // paid → deliverable received; money moved
  | "skipped" // gate declined before paying; no escrow
  | "rejected" // counterparty/protocol ended the order; escrow refunds
  | "failed"; // our error / timeout; fail-soft, no fabricated signal

export interface Purchase {
  id: string;
  serviceId: string;
  agentId?: string;
  label: string;
  category: string;
  status: PurchaseStatus;
  /** Money moved; 0 unless status === "delivered". */
  priceUsd: number;
  requestedAt: string;
  settledAt?: string;
  orderId?: string;
  payTxHash?: string;
  /** Why we skipped/rejected/failed (decision code or error). */
  reason?: string;
  /** Links to the ExternalSignal produced (delivered purchases only). */
  signalId?: string;
}

export interface SignalStore {
  record(purchase: Purchase): void;
  list(): Purchase[];
  /** Money moved on a UTC day, keyed for the per-counterparty cap. */
  spendOn(day: string): SpendSnapshot;
}

/** Deterministic in-memory ledger (the worker owns one; tests own one). */
export class InMemorySignalStore implements SignalStore {
  private readonly purchases: Purchase[] = [];

  record(purchase: Purchase): void {
    this.purchases.push(purchase);
  }

  list(): Purchase[] {
    return [...this.purchases];
  }

  spendOn(day: string): SpendSnapshot {
    const perServiceUsd: Record<string, number> = {};
    let totalUsd = 0;
    for (const p of this.purchases) {
      if (p.status !== "delivered") continue;
      const stamp = p.settledAt ?? p.requestedAt;
      if (utcDay(new Date(stamp)) !== day) continue;
      totalUsd += p.priceUsd;
      perServiceUsd[p.serviceId] = (perServiceUsd[p.serviceId] ?? 0) + p.priceUsd;
    }
    return { day, totalUsd, perServiceUsd };
  }
}

/** One counterparty we have paid, aggregated for the public feed. */
export interface CounterpartySummary {
  label: string;
  agentId?: string;
  category: string;
  orders: number;
  spentUsd: number;
  lastHiredAt: string;
}

/**
 * The "who we hired" projection: delivered purchases grouped by counterparty.
 * Ordered by spend then label so the feed is stable across renders.
 */
export function summarizeCounterparties(
  purchases: readonly Purchase[],
): CounterpartySummary[] {
  const byKey = new Map<string, CounterpartySummary>();
  for (const p of purchases) {
    if (p.status !== "delivered") continue;
    const key = p.agentId ?? p.serviceId;
    const existing = byKey.get(key);
    const settledAt = p.settledAt ?? p.requestedAt;
    if (existing) {
      existing.orders += 1;
      existing.spentUsd += p.priceUsd;
      if (settledAt > existing.lastHiredAt) existing.lastHiredAt = settledAt;
    } else {
      byKey.set(key, {
        label: p.label,
        ...(p.agentId !== undefined ? { agentId: p.agentId } : {}),
        category: p.category,
        orders: 1,
        spentUsd: p.priceUsd,
        lastHiredAt: settledAt,
      });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.spentUsd - a.spentUsd || a.label.localeCompare(b.label),
  );
}
