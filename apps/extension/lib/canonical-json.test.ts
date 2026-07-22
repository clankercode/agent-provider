import { describe, expect, it } from "vitest";
import {
  CanonicalJsonError,
  canonicalJson,
  fingerprintCanonicalJson,
} from "./canonical-json.js";

describe("canonical authority JSON", () => {
  it("sorts object keys recursively and normalizes negative zero", () => {
    expect(canonicalJson({ z: -0, a: { d: 2, c: 1 } })).toBe(
      '{"a":{"c":1,"d":2},"z":0}',
    );
  });

  it("produces the same SHA-256 fingerprint for equivalent objects", async () => {
    await expect(fingerprintCanonicalJson({ b: 2, a: 1 })).resolves.toBe(
      await fingerprintCanonicalJson({ a: 1, b: 2 }),
    );
  });

  it("rejects cycles, accessors, non-finite values, and non-plain objects", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(
      CanonicalJsonError,
    );
    expect(() => canonicalJson(new Date())).toThrow(CanonicalJsonError);
    expect(() =>
      canonicalJson(Object.defineProperty({}, "secret", { get: () => "x" })),
    ).toThrow(CanonicalJsonError);
  });
});
