import { describe, expect, it } from "vitest";
import { normalizeSettings } from "./settings.js";

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
});
