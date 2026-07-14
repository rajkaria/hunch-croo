import { describe, expect, it } from "vitest";
import {
  healthPortFromEnv,
  parseServiceMap,
  suspectServiceIds,
  type OracleEnv,
} from "../src/config.js";

/** Only the two port fields matter here; the rest of OracleEnv is irrelevant. */
const env = (ports: Partial<OracleEnv>): OracleEnv => ports as OracleEnv;

describe("healthPortFromEnv", () => {
  it("takes the PaaS-injected PORT when ORACLE_HEALTH_PORT is unset", () => {
    // Railway/Render/Fly hand us PORT and healthcheck it — bind that or the
    // platform check never reaches the ops server and the deploy is marked dead.
    expect(healthPortFromEnv(env({ PORT: 4567 }))).toBe(4567);
  });

  it("prefers an explicit ORACLE_HEALTH_PORT over PORT", () => {
    // docker-compose pins a distinct port per worker (8080/8081/8082) while the
    // image ships PORT=8080 — the explicit one has to win or they'd collide.
    expect(healthPortFromEnv(env({ ORACLE_HEALTH_PORT: 8082, PORT: 8080 }))).toBe(
      8082,
    );
  });

  it("runs no ops server when neither is set", () => {
    expect(healthPortFromEnv(env({}))).toBeUndefined();
  });
});

describe("parseServiceMap", () => {
  it("parses a serviceId → handler map", () => {
    expect(parseServiceMap('{"svc_1":"echo"}')).toEqual({ svc_1: "echo" });
  });

  it("parses the empty default", () => {
    expect(parseServiceMap("{}")).toEqual({});
  });

  it("rejects non-object payloads", () => {
    expect(() => parseServiceMap('"echo"')).toThrow();
    expect(() => parseServiceMap("[1]")).toThrow();
  });

  it("rejects unsaved CROO draft ids, which silently reject every real order", () => {
    // This shipped: 8 of 9 listings were mapped under the dialog's draft id, so
    // the provider loop rejected every negotiation and it read as "no demand".
    expect(() => parseServiceMap('{"svc-new-1784028805049":"forecast"}')).toThrow(
      /draft ids/i,
    );
    expect(() => parseServiceMap('{"svc-new-1784028805049":"forecast"}')).toThrow(
      /dashboard/i,
    );
  });

  it("accepts a real CROO service UUID", () => {
    const real = '{"9eccc75e-bc3f-43e3-84a8-153c67a89b75":"portfolio-hedge"}';
    expect(parseServiceMap(real)).toEqual({
      "9eccc75e-bc3f-43e3-84a8-153c67a89b75": "portfolio-hedge",
    });
  });
});

describe("suspectServiceIds", () => {
  it("flags ids that are not CROO UUIDs", () => {
    expect(
      suspectServiceIds({
        "9eccc75e-bc3f-43e3-84a8-153c67a89b75": "portfolio-hedge",
        svc_1: "echo",
      }),
    ).toEqual(["svc_1"]);
  });

  it("stays quiet when every id is a UUID", () => {
    expect(
      suspectServiceIds({ "9eccc75e-bc3f-43e3-84a8-153c67a89b75": "portfolio-hedge" }),
    ).toEqual([]);
  });
});
