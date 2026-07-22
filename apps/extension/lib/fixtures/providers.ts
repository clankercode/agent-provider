import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import type { ProviderAlias, ProviderProfile } from "../provider-profiles.js";

export const PROVIDER_FIXTURE_KEY = "fixture-secret-never-use-live";

export const PROVIDER_PROFILES: Readonly<Record<string, ProviderProfile>> = {
  openai: {
    id: "openai-fixture",
    family: "openai-compatible",
    endpoint: "https://openai.fixture.invalid/v1/",
    apiKey: PROVIDER_FIXTURE_KEY,
  },
  anthropic: {
    id: "anthropic-fixture",
    family: "anthropic-compatible",
    endpoint: "https://anthropic.fixture.invalid/v1/",
    apiKey: PROVIDER_FIXTURE_KEY,
  },
  gemini: {
    id: "gemini-fixture",
    family: "gemini",
    endpoint: "https://gemini.fixture.invalid/v1beta/",
    apiKey: PROVIDER_FIXTURE_KEY,
  },
};

export function providerAlias(profileId: string): ProviderAlias {
  return {
    id: "default",
    profileId,
    modelId: "fixture-model",
    maxOutputTokens: 256,
    reasoning: "low",
  };
}

export const NORMALIZED_GENERATE_FIXTURE = {
  content: [{ type: "text", text: "fixture output" }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 3, text: 3, reasoning: 0 },
  },
  warnings: [],
} as unknown as LanguageModelV4GenerateResult;
