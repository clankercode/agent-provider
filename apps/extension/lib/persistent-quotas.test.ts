import { describe, expect, it } from "vitest";
import {
  InMemoryQuotaStateStore,
  PersistentQuotaManager,
} from "./persistent-quotas.js";
import type { QuotaLimits } from "./quotas.js";

const limits: QuotaLimits = {
  requestsPerMinute: 2,
  requestsPerDay: 4,
  tokensPerDay: 100,
  allowUnknownPricing: false,
};

describe("PersistentQuotaManager", () => {
  it("persists reservations and settled usage across manager instances", async () => {
    const store = new InMemoryQuotaStateStore();
    const first = new PersistentQuotaManager(store);
    const reservation = await first.reserve(limits, {
      id: "request-1",
      scope: "https://app.example",
      estimatedTokens: 40,
      pricingKnown: false,
      now: 1_000,
    });
    await first.settle(limits, reservation.id, { tokens: 12, now: 2_000 });

    const second = new PersistentQuotaManager(store);
    expect(await second.snapshot(limits, 3_000)).toEqual({
      reservations: [],
      settled: [
        {
          scope: "https://app.example",
          timestamp: 2_000,
          tokens: 12,
        },
      ],
    });
  });

  it("reconciles abandoned work conservatively without replay", async () => {
    const store = new InMemoryQuotaStateStore();
    const first = new PersistentQuotaManager(store);
    await first.reserve(limits, {
      id: "unknown-1",
      scope: "https://app.example",
      estimatedTokens: 40,
      pricingKnown: false,
      now: 1_000,
    });

    const restarted = new PersistentQuotaManager(store);
    expect(await restarted.recoverUnknownOutcomes(limits, 2_000)).toEqual([
      expect.objectContaining({ id: "unknown-1", estimatedTokens: 40 }),
    ]);
    expect(await restarted.snapshot(limits, 3_000)).toEqual({
      reservations: [],
      settled: [
        {
          scope: "https://app.example",
          timestamp: 2_000,
          tokens: 40,
        },
      ],
    });
  });

  it("serializes concurrent reservations against the same persisted state", async () => {
    const manager = new PersistentQuotaManager(new InMemoryQuotaStateStore());
    const results = await Promise.allSettled([
      manager.reserve(limits, {
        scope: "https://app.example",
        estimatedTokens: 10,
        pricingKnown: false,
        now: 1_000,
      }),
      manager.reserve(limits, {
        scope: "https://app.example",
        estimatedTokens: 10,
        pricingKnown: false,
        now: 1_000,
      }),
      manager.reserve(limits, {
        scope: "https://app.example",
        estimatedTokens: 10,
        pricingKnown: false,
        now: 1_000,
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });
});
