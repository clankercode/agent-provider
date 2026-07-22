import { describe, expect, it } from "vitest";
import { QuotaExceededError, QuotaLedger } from "./quotas.js";

const limits = {
  requestsPerMinute: 2,
  requestsPerDay: 3,
  tokensPerDay: 100,
  costMicrosPerDay: 500,
  allowUnknownPricing: false,
};

describe("quota reserve and settle", () => {
  it("rejects invalid limits and snapshots mutable caller configuration", () => {
    expect(
      () => new QuotaLedger({ ...limits, tokensPerDay: Number.NaN }),
    ).toThrow("tokensPerDay");
    const mutable = { ...limits };
    const ledger = new QuotaLedger(mutable);
    mutable.tokensPerDay = Number.POSITIVE_INFINITY;
    expect(() =>
      ledger.reserve({
        scope: "origin-a",
        estimatedTokens: 101,
        estimatedCostMicros: 1,
        pricingKnown: true,
      }),
    ).toThrowError(expect.objectContaining({ dimension: "tokens" }));
  });
  it("counts concurrent reservations before provider completion", () => {
    const ledger = new QuotaLedger(limits);
    ledger.reserve({
      id: "a",
      scope: "origin-a",
      estimatedTokens: 50,
      estimatedCostMicros: 50,
      pricingKnown: true,
      now: 1_000,
    });
    ledger.reserve({
      id: "b",
      scope: "origin-a",
      estimatedTokens: 50,
      estimatedCostMicros: 50,
      pricingKnown: true,
      now: 1_000,
    });
    expect(() =>
      ledger.reserve({
        id: "c",
        scope: "origin-a",
        estimatedTokens: 1,
        estimatedCostMicros: 1,
        pricingKnown: true,
        now: 1_000,
      }),
    ).toThrow(QuotaExceededError);
  });

  it("settles actual use exactly once and releases only pre-dispatch work", () => {
    const ledger = new QuotaLedger(limits);
    ledger.reserve({
      id: "a",
      scope: "origin-a",
      estimatedTokens: 80,
      estimatedCostMicros: 100,
      pricingKnown: true,
      now: 1_000,
    });
    ledger.settle("a", { tokens: 20, costMicros: 100, now: 2_000 });
    expect(() => ledger.settle("a", { tokens: 20 })).toThrow("already settled");
    ledger.reserve({
      id: "b",
      scope: "origin-a",
      estimatedTokens: 80,
      estimatedCostMicros: 100,
      pricingKnown: true,
      now: 2_000,
    });
    expect(ledger.release("b")).toBe(true);
    expect(ledger.release("b")).toBe(false);
  });

  it("fails closed for unknown pricing when a cost cap applies", () => {
    const ledger = new QuotaLedger(limits);
    expect(() =>
      ledger.reserve({
        scope: "origin-a",
        estimatedTokens: 1,
        pricingKnown: false,
      }),
    ).toThrowError(expect.objectContaining({ dimension: "cost" }));
  });
});
