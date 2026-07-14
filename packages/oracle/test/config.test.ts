import { describe, expect, it } from "vitest";
import {
  healthPortFromEnv,
  parseServiceMap,
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
});
