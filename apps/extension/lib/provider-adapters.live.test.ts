import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { createProviderAdapter } from "./provider-adapters.js";
import { listProviderModels } from "./provider-models.js";
import type {
  ProviderAlias,
  ProviderFamily,
  ProviderProfile,
} from "./provider-profiles.js";

const KEY_PATHS = [
  `${homedir()}/.llmp-key-test-1`,
  `${homedir()}/.llmp-key-test-1.bak.20260722152638`,
];

// The authorized test gateway is kept out of git; vitest loads it from the
// repo's gitignored .env (see .env.example).
const GATEWAY = process.env.AGENT_PROVIDER_LIVE_GATEWAY;
if (!GATEWAY) {
  throw new Error(
    "Live provider tests require AGENT_PROVIDER_LIVE_GATEWAY (see .env.example).",
  );
}

const CASES: Array<{
  family: ProviderFamily;
  endpoint: string;
  modelId: string;
}> = [
  {
    family: "openai-compatible",
    endpoint: `${GATEWAY}/v1`,
    modelId: "MiniMax-M2.7-highspeed",
  },
  {
    family: "anthropic-compatible",
    endpoint: `${GATEWAY}/`,
    modelId: "MiniMax-M2.7-highspeed",
  },
];

const callOptions = {
  prompt: [
    {
      role: "user",
      content: [{ type: "text", text: "Reply with exactly: ok" }],
    },
  ],
  maxOutputTokens: 128,
  temperature: 0,
} as LanguageModelV4CallOptions;

async function credential(path: string): Promise<string> {
  const value = (await readFile(path, "utf8")).trim();
  if (value.length === 0) throw new Error(`Credential file is empty: ${path}`);
  return value;
}

async function generateWithCredentialFallback(
  providerCase: (typeof CASES)[number],
) {
  let lastError: unknown;

  for (const [index, keyPath] of KEY_PATHS.entries()) {
    let authenticationFailed = false;
    const profile: ProviderProfile = {
      id: `live-${providerCase.family}`,
      family: providerCase.family,
      endpoint: providerCase.endpoint,
      apiKey: await credential(keyPath),
    };
    const alias: ProviderAlias = {
      id: "default",
      profileId: profile.id,
      modelId: providerCase.modelId,
      maxOutputTokens: 128,
    };
    const trackedFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      authenticationFailed ||=
        response.status === 401 || response.status === 403;
      return response;
    };

    try {
      const models = await listProviderModels(profile, { fetch: trackedFetch });
      if (!models.some((model) => model.id === providerCase.modelId)) {
        throw new Error(
          `The live provider catalog does not include ${providerCase.modelId}.`,
        );
      }
      const result = await createProviderAdapter(profile, {
        fetch: trackedFetch,
      }).generate(alias, callOptions, new AbortController().signal);
      return { modelCount: models.length, result, usedFallback: index > 0 };
    } catch (error) {
      lastError = error;
      if (!authenticationFailed || index === KEY_PATHS.length - 1) throw error;
    }
  }

  throw lastError;
}

describe("live provider adapters", () => {
  it.each(CASES)(
    "generates through $family without exposing credentials",
    async (providerCase) => {
      const { modelCount, result, usedFallback } =
        await generateWithCredentialFallback(providerCase);
      const text = result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();

      expect(text.length).toBeGreaterThan(0);
      expect(result.finishReason.unified).toMatch(/^(stop|length)$/u);
      expect(modelCount).toBeGreaterThan(0);
      expect(typeof usedFallback).toBe("boolean");
    },
  );
});
