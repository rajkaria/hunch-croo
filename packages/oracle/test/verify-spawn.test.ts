import { describe, expect, it } from "vitest";
import { MockHunchApi } from "../src/adapters/mock/hunch.js";
import { createSpawnService } from "../src/core/services/spawn.js";
import { createVerifyService } from "../src/core/services/verify.js";
import { stableStringify } from "../src/core/stable-json.js";
import type { HunchVerifyResult } from "../src/ports/hunch.js";
import { FROZEN_NOW, fakeOrder, fixtureCatalogue, frozenClock } from "./helpers.js";

const YES_VERDICT: HunchVerifyResult = {
  verdict: "yes",
  claim: { family: "mcap_at_least", token: "AIXBT", lineUsd: 10_000_000 },
  reading: { marketCapUsd: 20_581_567, observedAt: FROZEN_NOW },
  method: "dexscreener_stable_pair_live",
  provenance: [
    { source: "dexscreener (stable-pair selector)", url: "https://dexscreener.com/base/0xpair", readAt: FROZEN_NOW },
  ],
  asOf: FROZEN_NOW,
};

const INDETERMINATE_VERDICT: HunchVerifyResult = {
  verdict: "indeterminate",
  claim: { family: "mcap_at_least", token: "AIXBT", lineUsd: 1, onDay: "2026-06-01" },
  reading: null,
  method: "observation_history_day_close",
  reason: "no marketCapUsd readings recorded for AIXBT on 2026-06-01 — history does not cover this claim",
  provenance: [],
  asOf: FROZEN_NOW,
};

function hunchWithFixtures() {
  return new MockHunchApi({
    catalogue: fixtureCatalogue(),
    readAt: FROZEN_NOW,
    synthesizeQuotes: true,
    verifications: {
      [JSON.stringify({ family: "mcap_at_least", token: "AIXBT", lineUsd: 10_000_000 })]:
        YES_VERDICT,
      [JSON.stringify({
        family: "mcap_at_least",
        token: "AIXBT",
        lineUsd: 1,
        onDay: "2026-06-01",
      })]: INDETERMINATE_VERDICT,
    },
    mints: {
      AIXBT: {
        status: "minted",
        market: fixtureCatalogue()
          .categories.flatMap((c) => c.markets)
          .find((m) => m.id === "aixbt-50m-mcap-2026-07-15")!,
      },
      BNKR: { status: "exists", marketId: "bnkr-mcap-ladder-2026-06-29", market: null },
    },
  });
}

describe("verify service (TruthCheck bridge)", () => {
  const service = createVerifyService(hunchWithFixtures());

  it("delivers a yes verdict with the resolver provenance chain", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { family: "mcap_at_least", token: "AIXBT", lineUsd: 10_000_000 },
      clock: frozenClock,
    });
    expect(payload.status).toBe("ok");
    expect(payload.verdict).toBe("yes");
    const provenance = payload.provenance as Array<{ source: string }>;
    expect(provenance[0]?.source).toContain("production resolver stack");
    expect(provenance.length).toBeGreaterThanOrEqual(2);
  });

  it("delivers indeterminate as a legitimate paid answer (never fakes)", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { family: "mcap_at_least", token: "AIXBT", lineUsd: 1, onDay: "2026-06-01" },
      clock: frozenClock,
    });
    expect(payload.status).toBe("ok");
    expect(payload.verdict).toBe("indeterminate");
    expect(payload.reason).toContain("history does not cover");
  });

  it("rejects free-text claims before they reach any resolver", async () => {
    await expect(
      service.handle({
        order: fakeOrder(),
        requirements: "",
        input: { family: "free_text", claim: "the sky is green" },
        clock: frozenClock,
      }),
    ).rejects.toThrow(/invalid verify claim/);
  });

  it("rejects (→ escrow refund) when upstream 422s an unvetted token", async () => {
    await expect(
      service.handle({
        order: fakeOrder(),
        requirements: "",
        input: { family: "mcap_at_least", token: "UNVETTED", lineUsd: 5 },
        clock: frozenClock,
      }),
    ).rejects.toThrow(/claim rejected by the resolver stack/);
  });

  it("is byte-deterministic", async () => {
    const run = () =>
      service.handle({
        order: fakeOrder(),
        requirements: "",
        input: { family: "mcap_at_least", token: "AIXBT", lineUsd: 10_000_000 },
        clock: frozenClock,
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});

describe("spawn service (Market Desk flywheel)", () => {
  const service = createSpawnService(hunchWithFixtures());

  it("mints, confirms visibility via a live quote, then delivers the link", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { token: "$aixbt", multiplier: 2.5, horizonDays: 30 },
      clock: frozenClock,
    });
    expect(payload.status).toBe("live");
    expect(payload.marketUrl).toContain("playhunch.xyz");
    expect(payload.seededOdds).toBeTruthy();
    const provenance = payload.provenance as Array<{ source: string }>;
    expect(provenance.map((p) => p.source)).toEqual([
      "playhunch.xyz partner mint (production market factory)",
      "playhunch.xyz partner quote (visibility confirmation)",
    ]);
  });

  it("delivers already_live for idempotent re-mints", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { token: "BNKR" },
      clock: frozenClock,
    });
    expect(payload.status).toBe("already_live");
    expect(payload.marketId).toBe("bnkr-mcap-ladder-2026-06-29");
  });

  it("rejects unpinned tokens (→ escrow refund) with the allowlist message", async () => {
    await expect(
      service.handle({
        order: fakeOrder(),
        requirements: "",
        input: { token: "NOTPINNED" },
        clock: frozenClock,
      }),
    ).rejects.toThrow(/not on the human-curated factory allowlist/);
  });

  it("rejects invalid multipliers deterministically — LLM never in this path", async () => {
    await expect(
      service.handle({
        order: fakeOrder(),
        requirements: "",
        input: { token: "AIXBT", multiplier: 0.5 },
        clock: frozenClock,
      }),
    ).rejects.toThrow(/invalid spawn input/);
  });
});
