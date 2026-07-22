import type {
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import { createProviderAdapter } from "./provider-adapters.js";
import type { ProviderAlias, ProviderProfile } from "./provider-profiles.js";
import type {
  ModelAliasSettings,
  AgentProviderExtensionSettings,
} from "./settings.js";

function resolveProvider(
  settings: AgentProviderExtensionSettings,
  alias: ModelAliasSettings,
): { profile: ProviderProfile; alias: ProviderAlias } {
  const profile =
    alias.profileId === undefined
      ? {
          id: "legacy-openai",
          family: "openai-compatible" as const,
          endpoint: settings.provider.endpoint,
          apiKey: settings.provider.apiKey,
          ...(settings.provider.organization.length === 0
            ? {}
            : { organization: settings.provider.organization }),
          ...(settings.provider.project.length === 0
            ? {}
            : { project: settings.provider.project }),
        }
      : settings.profiles[alias.profileId];
  if (profile === undefined) {
    throw new Error("The configured provider profile is unavailable.");
  }
  return {
    profile,
    alias: {
      id: "runtime",
      profileId: profile.id,
      modelId: alias.model,
      maxOutputTokens: alias.maxOutputTokens,
      ...(alias.reasoning === undefined ? {} : { reasoning: alias.reasoning }),
      ...(alias.authorityOptions === undefined
        ? {}
        : { authorityOptions: alias.authorityOptions }),
    },
  };
}

export async function runGenerate(
  settings: AgentProviderExtensionSettings,
  alias: ModelAliasSettings,
  options: LanguageModelV4CallOptions,
  abortSignal: AbortSignal,
): Promise<LanguageModelV4GenerateResult> {
  const resolved = resolveProvider(settings, alias);
  return createProviderAdapter(resolved.profile).generate(
    resolved.alias,
    options,
    abortSignal,
  );
}

export async function runStream(
  settings: AgentProviderExtensionSettings,
  alias: ModelAliasSettings,
  options: LanguageModelV4CallOptions,
  abortSignal: AbortSignal,
): Promise<LanguageModelV4StreamResult> {
  const resolved = resolveProvider(settings, alias);
  return createProviderAdapter(resolved.profile).stream(
    resolved.alias,
    options,
    abortSignal,
  );
}
