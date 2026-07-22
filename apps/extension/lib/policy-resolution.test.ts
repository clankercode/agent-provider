import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTHORITY_POLICY,
  mergeTighteningPolicies,
} from "./policy-resolution.js";

describe("tightening-only policy resolution", () => {
  it("takes minimum limits, intersects aliases, and strengthens modes/booleans", () => {
    const result = mergeTighteningPolicies(
      { ...DEFAULT_AUTHORITY_POLICY, allowedAliases: ["default", "reasoning"] },
      {
        maxOutputTokens: 1_000,
        allowedAliases: ["default"],
        minimumMode: "audit-first",
        requireAudit: true,
        allowPersistentAudit: false,
      },
      {
        maxOutputTokens: 100_000,
        allowedAliases: ["default", "other"],
        minimumMode: "standard",
        requireAudit: false,
        allowPersistentAudit: true,
        allowUnknownPricing: true,
      },
    );
    expect(result.maxOutputTokens).toBe(1_000);
    expect(result.allowedAliases).toEqual(["default"]);
    expect(result.minimumMode).toBe("audit-first");
    expect(result.requireAudit).toBe(true);
    expect(result.allowPersistentAudit).toBe(false);
    expect(result.allowUnknownPricing).toBe(false);
  });

  it("adds and then only lowers an optional cost cap", () => {
    const result = mergeTighteningPolicies(
      DEFAULT_AUTHORITY_POLICY,
      { costMicrosPerDay: 5_000_000 },
      { costMicrosPerDay: 9_000_000 },
      { costMicrosPerDay: 2_000_000 },
    );
    expect(result.costMicrosPerDay).toBe(2_000_000);
  });
});
