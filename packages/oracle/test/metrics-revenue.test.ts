import { describe, expect, it } from "vitest";
import { revenueByService } from "../src/core/metrics/revenue.js";
import { SERVICE_PRICING } from "../src/core/pricing.js";

/**
 * Booked-revenue accounting: delivered count x list price, per service. Honest
 * about unpriced services (counted but $0), stable ordering, correct totals.
 */
describe("revenueByService", () => {
  it("prices delivered services from the pricing table", () => {
    const roll = revenueByService(
      { forecast: 4, spawn: 2 },
      SERVICE_PRICING,
    );
    const forecast = roll.lines.find((l) => l.service === "forecast")!;
    expect(forecast.priceUsd).toBe(0.25);
    expect(forecast.delivered).toBe(4);
    expect(forecast.revenueUsd).toBe(1); // 4 x 0.25
    expect(forecast.listing).toBe("Hunch Oracle");

    const spawn = roll.lines.find((l) => l.service === "spawn")!;
    expect(spawn.revenueUsd).toBe(5); // 2 x 2.5

    expect(roll.totalDelivered).toBe(6);
    expect(roll.totalUsd).toBe(6);
  });

  it("counts an unpriced service (echo/scorecard) as delivered but $0", () => {
    const roll = revenueByService({ echo: 3, scorecard: 1 }, SERVICE_PRICING);
    const echo = roll.lines.find((l) => l.service === "echo")!;
    expect(echo.priceUsd).toBe(0);
    expect(echo.revenueUsd).toBe(0);
    expect(echo.delivered).toBe(3);
    expect(echo.listing).toBe("unlisted");
    expect(roll.totalDelivered).toBe(4);
    expect(roll.totalUsd).toBe(0);
  });

  it("sorts lines by service name for a stable exposition", () => {
    const roll = revenueByService(
      { verify: 1, forecast: 1, "hedge-quote": 1 },
      SERVICE_PRICING,
    );
    expect(roll.lines.map((l) => l.service)).toEqual([
      "forecast",
      "hedge-quote",
      "verify",
    ]);
  });

  it("returns zeros for an empty delivery log", () => {
    const roll = revenueByService({}, SERVICE_PRICING);
    expect(roll.lines).toEqual([]);
    expect(roll.totalDelivered).toBe(0);
    expect(roll.totalUsd).toBe(0);
  });

  it("rounds revenue to cents", () => {
    // 3 x 0.10 = 0.30 exactly, but guard the float path
    const roll = revenueByService({ sentiment: 3 }, SERVICE_PRICING);
    expect(roll.lines[0]!.revenueUsd).toBe(0.3);
  });
});
