import type { ProviderCredentialHeaders } from "./provider-endpoint.js";
import type { ProviderProfile } from "./provider-profiles.js";

export function providerCredentials(
  profile: ProviderProfile,
): ProviderCredentialHeaders {
  if (profile.family === "openai-compatible") {
    return {
      family: profile.family,
      apiKey: profile.apiKey,
      ...(profile.organization ? { organization: profile.organization } : {}),
      ...(profile.project ? { project: profile.project } : {}),
    };
  }
  return { family: profile.family, apiKey: profile.apiKey };
}
