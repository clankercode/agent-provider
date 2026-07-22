import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { providerAlias, PROVIDER_PROFILES } from "./fixtures/providers.js";

const sdk = vi.hoisted(() => ({
  configurations: new Map<string, Record<string, unknown>>(),
}));

function providerFactory(family: string) {
  return (configuration: Record<string, unknown>) => {
    sdk.configurations.set(family, configuration);
    return (modelId: string) => ({
      doGenerate: async () => {
        if (modelId === "fail") throw new Error("Bearer raw-provider-secret");
        return {
          content: [{ type: "text", text: `${family}:${modelId}` }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        };
      },
      doStream: async () => ({ stream: new ReadableStream() }),
    });
  };
}

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: providerFactory("openai-compatible"),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: providerFactory("anthropic-compatible"),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: providerFactory("gemini"),
}));

import {
  createProviderAdapter,
  ProviderAdapterError,
} from "./provider-adapters.js";

describe("normalized AI SDK provider adapters", () => {
  beforeEach(() => sdk.configurations.clear());

  it.each(["openai", "anthropic", "gemini"] as const)(
    "creates the %s family behind one LanguageModel V4 seam",
    async (name) => {
      const profile = PROVIDER_PROFILES[name]!;
      const result = await createProviderAdapter(profile).generate(
        providerAlias(profile.id),
        { prompt: [] } as unknown as LanguageModelV4CallOptions,
        new AbortController().signal,
      );
      expect(result.content[0]).toEqual({
        type: "text",
        text: `${profile.family}:fixture-model`,
      });
      expect(sdk.configurations.get(profile.family)).toMatchObject({
        apiKey: "agent-provider-managed-credential",
        baseURL: profile.endpoint,
        fetch: expect.any(Function),
      });
    },
  );

  it("does not expose raw provider errors through the normalized seam", async () => {
    const profile = PROVIDER_PROFILES.openai!;
    await expect(
      createProviderAdapter(profile).generate(
        { ...providerAlias(profile.id), modelId: "fail" },
        { prompt: [] } as unknown as LanguageModelV4CallOptions,
        new AbortController().signal,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ProviderAdapterError",
        message: "The configured model provider request failed.",
      }) as ProviderAdapterError,
    );
  });

  it("maps an Anthropic-compatible service root to its v1 API base", async () => {
    const profile = {
      ...PROVIDER_PROFILES.anthropic!,
      endpoint: "https://anthropic.fixture.invalid/",
    };
    await createProviderAdapter(profile).generate(
      providerAlias(profile.id),
      { prompt: [] } as unknown as LanguageModelV4CallOptions,
      new AbortController().signal,
    );
    expect(sdk.configurations.get(profile.family)).toMatchObject({
      baseURL: "https://anthropic.fixture.invalid/v1/",
    });
  });

  it("does not construct or dispatch a model for a pre-aborted request", async () => {
    const profile = PROVIDER_PROFILES.gemini!;
    const controller = new AbortController();
    controller.abort();
    await expect(
      createProviderAdapter(profile).generate(
        providerAlias(profile.id),
        { prompt: [] } as unknown as LanguageModelV4CallOptions,
        controller.signal,
      ),
    ).rejects.toEqual(expect.objectContaining({ name: "AbortError" }));
    expect(sdk.configurations).toEqual(new Map());
  });
});
