import { describe, expect, it } from "vitest";
import { providerAlias, PROVIDER_PROFILES } from "./fixtures/providers.js";
import { fingerprintProviderAlias } from "./provider-profiles.js";

describe("provider alias fingerprints", () => {
  it("is stable across key rotation and equivalent endpoint spellings", async () => {
    const profile = PROVIDER_PROFILES.openai!;
    const alias = providerAlias(profile.id);
    const first = await fingerprintProviderAlias(profile, alias);
    const rotated = await fingerprintProviderAlias(
      {
        ...profile,
        apiKey: "rotated",
        endpoint: "https://OPENAI.fixture.invalid:443/v1",
      },
      alias,
    );
    expect(rotated).toBe(first);
  });

  it("changes on model, endpoint, provider identity, and provider options", async () => {
    const profile = PROVIDER_PROFILES.openai!;
    const alias = providerAlias(profile.id);
    const base = await fingerprintProviderAlias(profile, alias);
    const variants = [
      fingerprintProviderAlias(profile, { ...alias, modelId: "other-model" }),
      fingerprintProviderAlias(profile, {
        ...alias,
        authorityOptions: { webSearch: true },
      }),
      fingerprintProviderAlias(
        { ...profile, endpoint: "https://other.fixture.invalid/v1/" },
        alias,
      ),
      fingerprintProviderAlias(
        { ...profile, organization: "other-org" },
        alias,
      ),
    ];
    for (const variant of await Promise.all(variants))
      expect(variant).not.toBe(base);
  });

  it("does not invalidate a grant for credential rotation or policy tightening", async () => {
    const profile = PROVIDER_PROFILES.openai!;
    const alias = providerAlias(profile.id);
    const base = await fingerprintProviderAlias(profile, alias);
    await expect(
      fingerprintProviderAlias(
        { ...profile, apiKey: "rotated" },
        { ...alias, maxOutputTokens: 64 },
      ),
    ).resolves.toBe(base);
  });
});
