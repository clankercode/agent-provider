import type { CanonicalJsonValue } from "./canonical-json.js";
import { canonicalJson, fingerprintCanonicalJson } from "./canonical-json.js";
import {
  canonicalizeProviderEndpoint,
  type CanonicalProviderEndpoint,
} from "./provider-endpoint.js";

export type ProviderFamily =
  "openai-compatible" | "anthropic-compatible" | "gemini";

export const DEFAULT_PROVIDER_ENDPOINTS: Readonly<
  Record<ProviderFamily, string>
> = Object.freeze({
  "openai-compatible": "https://api.openai.com/v1/",
  "anthropic-compatible": "https://api.anthropic.com/",
  gemini: "https://generativelanguage.googleapis.com/v1beta/",
});

export interface ProviderProfile {
  id: string;
  family: ProviderFamily;
  endpoint: string;
  /** Extension-owned secret. Never included in fingerprints or diagnostics. */
  apiKey: string;
  organization?: string;
  project?: string;
  authorityOptions?: Record<string, CanonicalJsonValue>;
}

export interface ProviderAlias {
  id: string;
  profileId: string;
  modelId: string;
  maxOutputTokens: number;
  reasoning?: string;
  authorityOptions?: Record<string, CanonicalJsonValue>;
}

export interface ResolvedProviderProfile extends ProviderProfile {
  canonicalEndpoint: CanonicalProviderEndpoint;
}

const IDENTIFIER = /^[a-z][a-z0-9_-]{0,63}$/i;

export function resolveProviderProfile(
  profile: ProviderProfile,
): ResolvedProviderProfile {
  if (!IDENTIFIER.test(profile.id)) {
    throw new TypeError("Provider profile identifier is invalid.");
  }
  if (
    profile.apiKey.length === 0 ||
    profile.apiKey.length > 4_096 ||
    /[\r\n]/u.test(profile.apiKey)
  ) {
    throw new TypeError("Provider profile credential is invalid.");
  }
  if (
    (profile.organization !== undefined &&
      (profile.organization.length > 200 ||
        /[\r\n]/u.test(profile.organization))) ||
    (profile.project !== undefined &&
      (profile.project.length > 200 || /[\r\n]/u.test(profile.project)))
  ) {
    throw new TypeError("Provider profile header settings are invalid.");
  }
  canonicalJson(profile.authorityOptions ?? {});
  return Object.freeze({
    ...profile,
    canonicalEndpoint: canonicalizeProviderEndpoint(profile.endpoint),
  });
}

/**
 * Fingerprints every mapping field capable of expanding provider authority.
 * Credentials and tightening-only policy are deliberately excluded.
 */
export async function fingerprintProviderAlias(
  profile: ProviderProfile,
  alias: ProviderAlias,
): Promise<string> {
  if (!IDENTIFIER.test(alias.id) || alias.profileId !== profile.id) {
    throw new TypeError("Provider alias mapping is invalid.");
  }
  if (
    alias.modelId.length === 0 ||
    alias.modelId.length > 200 ||
    !Number.isInteger(alias.maxOutputTokens) ||
    alias.maxOutputTokens <= 0
  ) {
    throw new TypeError("Provider alias model authority is invalid.");
  }
  const endpoint = canonicalizeProviderEndpoint(profile.endpoint);
  return fingerprintCanonicalJson({
    authorityOptions: alias.authorityOptions ?? {},
    endpoint: {
      basePath: endpoint.basePath,
      origin: endpoint.origin,
    },
    family: profile.family,
    modelId: alias.modelId,
    organization: profile.organization ?? null,
    project: profile.project ?? null,
    profileAuthorityOptions: profile.authorityOptions ?? {},
    profileId: profile.id,
    reasoning: alias.reasoning ?? null,
  });
}
