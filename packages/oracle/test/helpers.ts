import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Clock } from "../src/ports/runtime.js";
import type {
  HunchCatalogue,
  HunchQuote,
  HunchTrendingEntry,
} from "../src/ports/hunch.js";
import type { CapOrder } from "../src/ports/cap.js";
import { MockHunchApi } from "../src/adapters/mock/hunch.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as T;
}

/** Frozen just after the fixtures were recorded — every recorded market open. */
export const FROZEN_NOW = "2026-07-05T22:51:00.000Z";

export const frozenClock: Clock = { now: () => new Date(FROZEN_NOW) };

export function fixtureCatalogue(): HunchCatalogue {
  return loadFixture<HunchCatalogue>("catalogue.json");
}

export function fixtureHunchApi(): MockHunchApi {
  const quotes: Record<string, HunchQuote> = {};
  for (const file of [
    "quote-ansem-flip.json",
    "quote-aixbt-50m.json",
    "quote-ladder.json",
  ]) {
    const quote = loadFixture<HunchQuote>(file);
    quotes[quote.market.id] = quote;
  }
  return new MockHunchApi({
    catalogue: fixtureCatalogue(),
    quotes,
    trending: loadFixture<{ trending: HunchTrendingEntry[] }>("trending.json"),
    readAt: FROZEN_NOW,
    synthesizeQuotes: true,
  });
}

export function fakeOrder(overrides: Partial<CapOrder> = {}): CapOrder {
  return {
    orderId: "order-golden-1",
    negotiationId: "neg-golden-1",
    serviceId: "svc-forecast",
    requesterAgentId: "agent-tester",
    price: "0.25",
    paymentToken: "USDC",
    status: "paid",
    ...overrides,
  };
}
