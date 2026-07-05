import { describe, expect, it } from "vitest";
import { parseServiceMap } from "../src/config.js";

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
