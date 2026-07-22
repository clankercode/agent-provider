import { describe, expect, it } from "vitest";
import { canonicalize, sha256Canonical } from "./canonical.js";
import {
  createBootstrapHello,
  isBootstrapMessage,
  negotiateProtocolVersion,
} from "./guards.js";

describe("bootstrap protocol", () => {
  it("negotiates the highest overlap and rejects no overlap", () => {
    const hello = createBootstrapHello({
      clientId: "client-1",
      min: 1,
      max: 3,
    });
    expect(isBootstrapMessage(hello)).toBe(true);
    expect(negotiateProtocolVersion(hello, { min: 2, max: 4 })).toBe(3);
    expect(negotiateProtocolVersion(hello, { min: 4, max: 5 })).toBeUndefined();
  });

  it("rejects malformed ranges and identifiers", () => {
    expect(
      isBootstrapMessage(createBootstrapHello({ clientId: "bad id" })),
    ).toBe(false);
    expect(
      isBootstrapMessage({
        ...createBootstrapHello({ clientId: "client-1" }),
        supported: { min: 2, max: 1 },
      }),
    ).toBe(false);
  });
});

describe("canonical approval values", () => {
  it("sorts keys and normalizes tagged values", async () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe(canonicalize({ a: 1, b: 2 }));
    expect(await sha256Canonical({ b: 2, a: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });
});
