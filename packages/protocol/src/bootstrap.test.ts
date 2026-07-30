import { afterEach, describe, expect, it } from "vitest";
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

describe("sha256Canonical fallback (non-secure context)", () => {
  const realCrypto = globalThis.crypto;

  afterEach(() => {
    // Restore the real crypto object after each test.
    Object.defineProperty(globalThis, "crypto", {
      value: realCrypto,
      writable: true,
      configurable: true,
    });
  });

  it("returns 64 hex chars and does not throw when crypto.subtle is undefined", async () => {
    // Simulate a non-secure context: crypto.subtle is unavailable.
    Object.defineProperty(globalThis, "crypto", {
      value: { getRandomValues: realCrypto.getRandomValues },
      writable: true,
      configurable: true,
    });

    const hash = await sha256Canonical({ tool: "debug_echo", input: "hi" });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // Deterministic: same input → same hash.
    const hash2 = await sha256Canonical({ tool: "debug_echo", input: "hi" });
    expect(hash2).toBe(hash);
  });

  it("pure SHA-256 matches Web Crypto output (golden vector)", async () => {
    // With subtle available, both paths should produce identical results.
    const payload = { name: "test", description: "echo", risk: "read" };
    const fromSubtle = await sha256Canonical(payload);

    // Now stub subtle away and compare.
    Object.defineProperty(globalThis, "crypto", {
      value: { getRandomValues: realCrypto.getRandomValues },
      writable: true,
      configurable: true,
    });
    const fromPure = await sha256Canonical(payload);

    expect(fromPure).toBe(fromSubtle);
  });

  it("returns 64 hex chars when subtle.digest throws", async () => {
    Object.defineProperty(globalThis, "crypto", {
      value: {
        getRandomValues: realCrypto.getRandomValues,
        subtle: {
          digest: () => {
            throw new TypeError("broken");
          },
        },
      },
      writable: true,
      configurable: true,
    });

    const hash = await sha256Canonical({ test: true });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
