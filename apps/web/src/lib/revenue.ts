import { usdcToNumber, type CrooOrder, type PublicAgent } from "./croo";

/**
 * Settled revenue per service, grouped from the on-chain-verifiable CROO
 * completed-order feed. This is REAL money that cleared on Base — distinct from
 * the worker's `oracle_revenue_usd` metric, which is *booked at list price* from
 * the in-memory delivery log. Both are honest; they answer different questions
 * ("what cleared" vs "what we delivered x list price").
 */
export interface ServiceRevenue {
  serviceId: string;
  name: string;
  delivered: number;
  revenueUsd: number;
}

export interface RevenueBreakdown {
  lines: ServiceRevenue[];
  totalDelivered: number;
  totalUsd: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function revenueByService(
  orders: CrooOrder[],
  agents: PublicAgent[],
): RevenueBreakdown {
  const names = new Map<string, string>();
  for (const agent of agents) {
    for (const service of agent.services ?? []) {
      names.set(service.serviceId, service.name);
    }
  }

  const acc = new Map<string, { delivered: number; revenueUsd: number }>();
  for (const order of orders) {
    const cur = acc.get(order.serviceId) ?? { delivered: 0, revenueUsd: 0 };
    cur.delivered += 1;
    cur.revenueUsd += usdcToNumber(order.amount);
    acc.set(order.serviceId, cur);
  }

  const lines: ServiceRevenue[] = [...acc.entries()]
    .map(([serviceId, v]) => ({
      serviceId,
      name: names.get(serviceId) ?? serviceId,
      delivered: v.delivered,
      revenueUsd: round2(v.revenueUsd),
    }))
    .sort((a, b) => b.revenueUsd - a.revenueUsd);

  return {
    lines,
    totalDelivered: lines.reduce((sum, l) => sum + l.delivered, 0),
    totalUsd: round2(lines.reduce((sum, l) => sum + l.revenueUsd, 0)),
  };
}
