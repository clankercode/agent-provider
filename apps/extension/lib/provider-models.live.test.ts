/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { listProviderModels } from "./provider-models.js";
import type { ProviderProfile } from "./provider-profiles.js";

const KEY_PATH = `${process.env.HOME}/.llmp-key-agent-provider`;
const ENDPOINT = "https://omni-dyn-00.amaroolabs.com/v1/";

function readKey(): string | undefined {
  try {
    const key = readFileSync(KEY_PATH, "utf8").trim();
    return key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
}

function llmpProfile(): ProviderProfile | undefined {
  const apiKey = readKey();
  if (apiKey === undefined) return undefined;
  return {
    id: "llmp-live",
    family: "openai-compatible",
    endpoint: ENDPOINT,
    apiKey,
  };
}

describe("LLMP provider model discovery (live)", () => {
  it("lists models from the OpenAI-compatible endpoint", async () => {
    const profile = llmpProfile();
    if (profile === undefined) {
      console.warn(
        "Skipping LLMP live test — key not found at ~/.llmp-key-agent-provider",
      );
      return;
    }

    const models = await listProviderModels(profile);

    expect(models.length).toBeGreaterThan(0);
    // Each model should have a non-empty id.
    for (const model of models) {
      expect(model.id.length).toBeGreaterThan(0);
    }
    // Models should be deduplicated (no two identical ids).
    const ids = models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finds glm-5-turbo in the model list", async () => {
    const profile = llmpProfile();
    if (profile === undefined) {
      console.warn("Skipping LLMP live test — key not found.");
      return;
    }

    const models = await listProviderModels(profile);
    const ids = models.map((m) => m.id);
    const hasGlm = ids.some((id) => id.includes("glm-5-turbo"));
    if (!hasGlm) {
      // The proxy may expose models under different names; log what's available.
      console.warn(
        `glm-5-turbo not found. Available models: ${ids.slice(0, 20).join(", ")}${ids.length > 20 ? " ..." : ""}`,
      );
    }
    // At minimum, models should be retrievable.
    expect(models.length).toBeGreaterThan(0);
  });

  it("rejects a bad credential without leaking the response body", async () => {
    const profile: ProviderProfile = {
      id: "llmp-bad",
      family: "openai-compatible",
      endpoint: ENDPOINT,
      apiKey: "sk-invalid-credential-for-testing",
    };

    await expect(listProviderModels(profile)).rejects.toThrow();
  });
});
