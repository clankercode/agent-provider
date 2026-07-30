import { describe, expect, it } from "vitest";
import {
  getCatalog,
  lookupModelCapabilities,
  DEFAULT_UNKNOWN_MAX_OUTPUT_TOKENS,
  refreshCatalog,
} from "./model-capabilities.js";

describe("models.dev catalog (live)", () => {
  it("fetches and parses the real catalog.json", async () => {
    // Force a fresh fetch from the network.
    const ok = await refreshCatalog();
    if (!ok) {
      // Network may be unavailable in CI; skip rather than fail.
      console.warn("Skipping live catalog fetch — network unavailable.");
      return;
    }
    const catalog = await getCatalog();
    expect(catalog).toBeDefined();
    if (catalog === undefined) return;

    // Sanity: the big three providers should be present.
    expect(catalog.providers.openai).toBeDefined();
    expect(catalog.providers.anthropic).toBeDefined();
    expect(catalog.providers.google).toBeDefined();

    // Each provider should have at least one model.
    expect(
      Object.keys(catalog.providers.openai!.models).length,
    ).toBeGreaterThan(0);
    expect(
      Object.keys(catalog.providers.anthropic!.models).length,
    ).toBeGreaterThan(0);
  });

  it("resolves capabilities for a known OpenAI model", async () => {
    const caps = await lookupModelCapabilities(
      "openai-compatible",
      "gpt-5-mini",
    );
    // If the catalog wasn't fetched (offline), we get the fallback.
    if (caps.maxOutputTokens === DEFAULT_UNKNOWN_MAX_OUTPUT_TOKENS) {
      console.warn("Skipping — catalog unavailable, using fallback.");
      return;
    }
    expect(caps.maxOutputTokens).toBeGreaterThan(1_000);
    expect(caps.maxOutputTokens).toBeLessThanOrEqual(524_288);
    // gpt-5-mini supports reasoning per the catalog.
    expect(caps.supportsReasoning).toBe(true);
  });

  it("resolves capabilities for a known Anthropic model", async () => {
    const caps = await lookupModelCapabilities(
      "anthropic-compatible",
      "claude-sonnet-4-6",
    );
    if (caps.maxOutputTokens === DEFAULT_UNKNOWN_MAX_OUTPUT_TOKENS) {
      console.warn("Skipping — catalog unavailable, using fallback.");
      return;
    }
    expect(caps.maxOutputTokens).toBeGreaterThanOrEqual(8_192);
    expect(caps.supportsReasoning).toBe(true);
  });

  it("falls back gracefully for an unknown model", async () => {
    const caps = await lookupModelCapabilities(
      "openai-compatible",
      "this-model-does-not-exist-xyz-12345",
    );
    expect(caps.maxOutputTokens).toBe(DEFAULT_UNKNOWN_MAX_OUTPUT_TOKENS);
    expect(caps.supportsReasoning).toBe(false);
  });
});
