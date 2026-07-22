import { browser } from "wxt/browser";
import type { BridgeLimits } from "@agent-provider/protocol";
import { canonicalJson, type CanonicalJsonValue } from "./canonical-json.js";
import { canonicalizeProviderEndpoint } from "./provider-endpoint.js";
import type { ProviderFamily, ProviderProfile } from "./provider-profiles.js";

export type ReasoningLevel =
  "provider-default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ModelAliasSettings {
  model: string;
  profileId?: string;
  maxOutputTokens: number;
  reasoning?: ReasoningLevel;
  authorityOptions?: Record<string, CanonicalJsonValue>;
}

export interface AgentProviderExtensionSettings {
  version: 1;
  provider: {
    kind: "openai";
    endpoint: string;
    apiKey: string;
    organization: string;
    project: string;
  };
  profiles: Record<string, ProviderProfile>;
  aliases: Record<string, ModelAliasSettings>;
  limits: BridgeLimits;
}

const SETTINGS_KEY = "agent-provider.settings.v1";

export const DEFAULT_SETTINGS: AgentProviderExtensionSettings = {
  version: 1,
  provider: {
    kind: "openai",
    endpoint: "https://api.openai.com/v1/",
    apiKey: "",
    organization: "",
    project: "",
  },
  profiles: {},
  aliases: {
    default: {
      model: "gpt-5-mini",
      maxOutputTokens: 2_048,
      reasoning: "low",
    },
  },
  limits: {
    maxRequestBytes: 512_000,
    maxOutputTokens: 8_192,
    maxConcurrentRequests: 2,
    maxTools: 32,
    requestTimeoutMs: 120_000,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberInRange(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value)))
    : fallback;
}

const REASONING_LEVELS = new Set<ReasoningLevel>([
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

const PROVIDER_FAMILIES = new Set<ProviderFamily>([
  "openai-compatible",
  "anthropic-compatible",
  "gemini",
]);

function boundedString(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function authorityOptions(
  value: unknown,
): Record<string, CanonicalJsonValue> | undefined {
  if (!isRecord(value)) return undefined;
  try {
    canonicalJson(value);
    return structuredClone(value) as Record<string, CanonicalJsonValue>;
  } catch {
    return undefined;
  }
}

function normalizeProfiles(value: unknown): Record<string, ProviderProfile> {
  if (!isRecord(value)) return {};
  const profiles: Record<string, ProviderProfile> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(id) || !isRecord(raw)) continue;
    if (!PROVIDER_FAMILIES.has(raw.family as ProviderFamily)) continue;
    const apiKey = boundedString(raw.apiKey, 4_096);
    if (apiKey.length === 0 || typeof raw.endpoint !== "string") continue;
    try {
      const endpoint = canonicalizeProviderEndpoint(raw.endpoint).url;
      const options = authorityOptions(raw.authorityOptions);
      profiles[id] = {
        id,
        family: raw.family as ProviderFamily,
        endpoint,
        apiKey,
        ...(boundedString(raw.organization, 200)
          ? { organization: boundedString(raw.organization, 200) }
          : {}),
        ...(boundedString(raw.project, 200)
          ? { project: boundedString(raw.project, 200) }
          : {}),
        ...(options === undefined ? {} : { authorityOptions: options }),
      };
    } catch {
      // Malformed profiles are unavailable rather than silently rewritten.
    }
  }
  return profiles;
}

export function normalizeSettings(
  value: unknown,
): AgentProviderExtensionSettings {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_SETTINGS);
  }

  const provider = isRecord(value.provider) ? value.provider : {};
  const rawAliases = isRecord(value.aliases) ? value.aliases : {};
  const profiles = normalizeProfiles(value.profiles);
  const aliases: Record<string, ModelAliasSettings> = {};

  for (const [alias, raw] of Object.entries(rawAliases)) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(alias) || !isRecord(raw)) {
      continue;
    }
    const model = typeof raw.model === "string" ? raw.model.trim() : "";
    if (model.length === 0 || model.length > 120) {
      continue;
    }
    const reasoning = REASONING_LEVELS.has(raw.reasoning as ReasoningLevel)
      ? (raw.reasoning as ReasoningLevel)
      : undefined;
    const requestedProfileId =
      typeof raw.profileId === "string" ? raw.profileId : undefined;
    if (
      requestedProfileId !== undefined &&
      profiles[requestedProfileId] === undefined
    ) {
      continue;
    }
    const profileId = requestedProfileId;
    const options = authorityOptions(raw.authorityOptions);
    aliases[alias] = {
      model,
      ...(profileId === undefined ? {} : { profileId }),
      maxOutputTokens: numberInRange(raw.maxOutputTokens, 2_048, 64, 128_000),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(options === undefined ? {} : { authorityOptions: options }),
    };
  }

  if (Object.keys(aliases).length === 0) {
    aliases.default = structuredClone(DEFAULT_SETTINGS.aliases.default!);
  }

  const rawLimits = isRecord(value.limits) ? value.limits : {};
  let legacyEndpoint = DEFAULT_SETTINGS.provider.endpoint;
  if (typeof provider.endpoint === "string") {
    try {
      legacyEndpoint = canonicalizeProviderEndpoint(provider.endpoint).url;
    } catch {
      // Preserve the known-safe official default for invalid legacy settings.
    }
  }
  return {
    version: 1,
    provider: {
      kind: "openai",
      endpoint: legacyEndpoint,
      apiKey:
        typeof provider.apiKey === "string"
          ? provider.apiKey.trim().slice(0, 512)
          : "",
      organization:
        typeof provider.organization === "string"
          ? provider.organization.trim().slice(0, 200)
          : "",
      project:
        typeof provider.project === "string"
          ? provider.project.trim().slice(0, 200)
          : "",
    },
    profiles,
    aliases,
    limits: {
      maxRequestBytes: numberInRange(
        rawLimits.maxRequestBytes,
        DEFAULT_SETTINGS.limits.maxRequestBytes,
        16_000,
        5_000_000,
      ),
      maxOutputTokens: numberInRange(
        rawLimits.maxOutputTokens,
        DEFAULT_SETTINGS.limits.maxOutputTokens,
        64,
        128_000,
      ),
      maxConcurrentRequests: numberInRange(
        rawLimits.maxConcurrentRequests,
        DEFAULT_SETTINGS.limits.maxConcurrentRequests,
        1,
        8,
      ),
      maxTools: numberInRange(
        rawLimits.maxTools,
        DEFAULT_SETTINGS.limits.maxTools,
        0,
        128,
      ),
      requestTimeoutMs: numberInRange(
        rawLimits.requestTimeoutMs,
        DEFAULT_SETTINGS.limits.requestTimeoutMs,
        5_000,
        600_000,
      ),
    },
  };
}

export async function lockStorageToExtensionContexts(): Promise<void> {
  const storageArea = browser.storage.local as typeof browser.storage.local & {
    setAccessLevel?: (options: {
      accessLevel: "TRUSTED_CONTEXTS";
    }) => Promise<void>;
  };
  await storageArea.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
}

export async function loadSettings(): Promise<AgentProviderExtensionSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(result[SETTINGS_KEY]);
}

export async function saveSettings(
  settings: AgentProviderExtensionSettings,
): Promise<AgentProviderExtensionSettings> {
  const normalized = normalizeSettings(settings);
  await browser.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}
