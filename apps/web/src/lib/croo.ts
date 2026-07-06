/**
 * Server-side CROO reads for the live dashboard.
 *
 * Two surfaces:
 *  - the public Store API (`/backend/v1/public/*`) — no auth, per-agent
 *    earnings/completion stats anyone can verify;
 *  - the authed orders list (`/backend/v1/orders`, X-SDK-Key) — per-order
 *    detail incl. requester agent ids and all four Base tx hashes. Keys stay
 *    server-side; the page renders aggregates + public hashes only.
 */

const CROO_API = process.env.CROO_API_URL ?? "https://api.croo.network";

/** Our provider agents (Hunch Oracle first; TruthCheck/Market Desk once registered). */
export function providerKeys(): string[] {
  const raw = process.env.CROO_PROVIDER_KEYS ?? process.env.CROO_SDK_KEY ?? "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Wallets/agents we operate ourselves — marked on the dashboard for anti-sybil transparency. */
export function ownAgentIds(): Set<string> {
  const raw =
    process.env.CROO_OWN_AGENT_IDS ??
    // Hunch provider agent + hunch-buyer requester agent (defaults from S0).
    "013febe1-f57a-445d-95f4-adf2931bd2f9,b373b1bc-d960-491e-bb52-3fba07635f55";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export interface PublicAgent {
  agentId: string;
  name: string;
  status: string;
  completedOrders: string;
  totalEarned: string;
  totalVolume: string;
  completionRate: number;
  avgDeliveryText: string;
  onlineStatus: string;
  services?: Array<{
    serviceId: string;
    name: string;
    price: string;
    slaMinutes: number;
    orders7d: string;
  }>;
}

export interface CrooOrder {
  orderId: string;
  serviceId: string;
  providerAgentId: string;
  requesterAgentId: string;
  status: string;
  chainOrderId: string;
  createTxHash: string;
  payTxHash: string;
  deliverTxHash: string;
  clearTxHash: string;
  amount: string;
  createdAt: string;
  deliveredAt: string;
  clearAt: string;
}

async function get<T>(path: string, sdkKey?: string): Promise<T | null> {
  try {
    const response = await fetch(`${CROO_API}${path}`, {
      headers: sdkKey ? { "X-SDK-Key": sdkKey } : {},
      next: { revalidate: 30 },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchPublicAgent(agentId: string): Promise<PublicAgent | null> {
  const body = await get<{ agent: PublicAgent }>(`/backend/v1/public/agents/${agentId}`);
  return body?.agent ?? null;
}

export async function fetchPlatformStats(): Promise<{
  totalAgents: string;
  totalServices: string;
  totalOrders: string;
  totalVolume: string;
} | null> {
  return get(`/backend/v1/public/platform-stats`);
}

/** All completed provider orders across our agents (newest first). */
export async function fetchCompletedOrders(): Promise<CrooOrder[]> {
  const keys = providerKeys();
  const all: CrooOrder[] = [];
  for (const key of keys) {
    const body = await get<{ orders: CrooOrder[] }>(
      `/backend/v1/orders?role=provider&status=completed&page_size=50`,
      key,
    );
    if (body?.orders) all.push(...body.orders);
  }
  return all.sort(
    (a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""),
  );
}

/** USDC amounts arrive in 6-decimal base units. */
export function usdcToNumber(baseUnits: string): number {
  const value = Number.parseFloat(baseUnits);
  if (!Number.isFinite(value)) return 0;
  // Heuristic: the public API reports 6dp base units ("10000" = $0.01).
  return value / 1_000_000;
}

export function basescanTx(hash: string): string {
  return `https://basescan.org/tx/${hash}`;
}
