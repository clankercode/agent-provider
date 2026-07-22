import { describe, expect, it } from "vitest";
import { decodeWireValue, encodeWireValue, estimateWireBytes } from "./wire.js";

describe("AgentProvider wire codec", () => {
  it("round-trips binary, dates, errors, bigint, and undefined", () => {
    const input = {
      data: new Uint8Array([1, 2, 3, 255]),
      when: new Date("2026-07-22T01:02:03.000Z"),
      count: 123n,
      missing: undefined,
      error: new TypeError("bad input"),
      nested: [true, null, "ok"],
      reservedTag: { $agentProvider: "date", value: "not-a-date" },
    };

    const encoded = encodeWireValue(input);
    const decoded = decodeWireValue(encoded) as typeof input;

    expect([...decoded.data]).toEqual([1, 2, 3, 255]);
    expect(decoded.when.toISOString()).toBe("2026-07-22T01:02:03.000Z");
    expect(decoded.count).toBe(123n);
    expect(decoded.missing).toBeUndefined();
    expect(decoded.error).toBeInstanceOf(TypeError);
    expect(decoded.error.message).toBe("bad input");
    expect(decoded.nested).toEqual([true, null, "ok"]);
    expect(decoded.reservedTag).toEqual({
      $agentProvider: "date",
      value: "not-a-date",
    });
    expect(estimateWireBytes(encoded)).toBeGreaterThan(0);
  });

  it("rejects cycles and non-plain objects", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => encodeWireValue(cyclic)).toThrow(/cyclic/i);
    expect(() => encodeWireValue(new Map())).toThrow(/plain objects/i);
  });
});
