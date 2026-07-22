import { describe, expect, it } from "vitest";
import { normalizeSettings, persistentAuditEnabled } from "./settings.js";

describe("extension provider settings", () => {
  it("canonicalizes the legacy endpoint while preserving reviewed defaults", () => {
    const settings = normalizeSettings({
      provider: {
        endpoint: "https://API.OPENAI.com:443/v1",
        apiKey: " fixture-key ",
      },
    });
    expect(settings.provider.endpoint).toBe("https://api.openai.com/v1/");
    expect(settings.provider.apiKey).toBe("fixture-key");
    expect(settings.aliases.default).toBeDefined();
  });

  it("accepts all supported custom profile families and binds aliases to them", () => {
    const settings = normalizeSettings({
      profiles: {
        custom: {
          family: "anthropic-compatible",
          endpoint: "https://provider.fixture.invalid/api/v1",
          apiKey: "fixture",
          authorityOptions: { beta: ["safe"] },
        },
      },
      aliases: {
        reasoning: {
          profileId: "custom",
          model: "model-fixture",
          maxOutputTokens: 512,
        },
      },
    });
    expect(settings.profiles.custom).toMatchObject({
      id: "custom",
      family: "anthropic-compatible",
      endpoint: "https://provider.fixture.invalid/api/v1/",
    });
    expect(settings.aliases.reasoning?.profileId).toBe("custom");
  });

  it("drops unsafe profiles and does not retain dangling profile authority", () => {
    const settings = normalizeSettings({
      profiles: {
        unsafe: {
          family: "openai-compatible",
          endpoint: "https://provider.fixture.invalid/v1?redirect=evil",
          apiKey: "fixture",
        },
      },
      aliases: {
        default: {
          profileId: "unsafe",
          model: "model-fixture",
          maxOutputTokens: 512,
        },
      },
    });
    expect(settings.profiles).toEqual({});
    expect(settings.aliases.default?.profileId).toBeUndefined();
    expect(settings.aliases.default?.model).toBe("gpt-5-mini");
  });

  it("normalizes execution, audit, and durable quota controls", () => {
    const settings = normalizeSettings({
      execution: { defaultMode: "audit-first", privateByDefault: true },
      audit: {
        persistentEnabled: false,
        requirePersistent: true,
        originOverrides: {
          "https://enabled.example": true,
          "https://disabled.example": false,
          "not an origin": true,
        },
        retention: {
          maxAgeMs: Number.MAX_SAFE_INTEGER,
          maxEvents: 500,
          maxBytes: 100_000,
        },
      },
      quotas: {
        requestsPerMinute: 3,
        requestsPerDay: 25,
        tokensPerDay: 12_000,
        costMicrosPerDay: 500_000,
        allowUnknownPricing: true,
      },
    });
    expect(settings.execution).toEqual({
      defaultMode: "audit-first",
      privateByDefault: true,
    });
    expect(settings.audit.persistentEnabled).toBe(true);
    expect(settings.audit.requirePersistent).toBe(true);
    expect(settings.audit.originOverrides).toEqual({
      "https://enabled.example": true,
      "https://disabled.example": false,
    });
    expect(persistentAuditEnabled(settings, "https://enabled.example")).toBe(
      true,
    );
    expect(persistentAuditEnabled(settings, "https://disabled.example")).toBe(
      false,
    );
    expect(persistentAuditEnabled(settings, "https://other.example")).toBe(
      true,
    );
    expect(settings.audit.retention.maxAgeMs).toBeLessThan(
      Number.MAX_SAFE_INTEGER,
    );
    expect(settings.quotas).toEqual({
      requestsPerMinute: 3,
      requestsPerDay: 25,
      tokensPerDay: 12_000,
      costMicrosPerDay: 500_000,
      allowUnknownPricing: true,
    });
  });
});
