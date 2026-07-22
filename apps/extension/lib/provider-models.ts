import { providerCredentials } from "./provider-credentials.js";
import {
  createCredentialedProviderFetch,
  joinProviderEndpoint,
} from "./provider-endpoint.js";
import {
  resolveProviderProfile,
  type ProviderFamily,
  type ProviderProfile,
} from "./provider-profiles.js";

const MAX_CATALOG_BYTES = 1_048_576;
const MAX_CATALOG_MODELS = 1_000;
const MAX_CATALOG_PAGES = 20;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export interface ProviderModel {
  readonly id: string;
  readonly displayName?: string;
}

export class ProviderModelDiscoveryError extends Error {
  readonly family: ProviderFamily;
  readonly status?: number;

  constructor(family: ProviderFamily, message: string, status?: number) {
    super(message);
    this.name = "ProviderModelDiscoveryError";
    this.family = family;
    if (status !== undefined) this.status = status;
  }
}

export interface ListProviderModelsOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function catalogString(value: unknown, maximum = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 &&
    normalized.length <= maximum &&
    !CONTROL_CHARACTER.test(normalized)
    ? normalized
    : undefined;
}

function addModel(
  models: Map<string, ProviderModel>,
  rawId: unknown,
  rawDisplayName?: unknown,
  stripGeminiPrefix = false,
): void {
  const candidate = catalogString(rawId);
  if (candidate === undefined) return;
  const id =
    stripGeminiPrefix && candidate.startsWith("models/")
      ? candidate.slice("models/".length)
      : candidate;
  if (
    id.length === 0 ||
    id.length > 200 ||
    CONTROL_CHARACTER.test(id) ||
    models.has(id) ||
    models.size >= MAX_CATALOG_MODELS
  ) {
    return;
  }
  const displayName = catalogString(rawDisplayName);
  models.set(id, {
    id,
    ...(displayName === undefined ? {} : { displayName }),
  });
}

function responseError(
  family: ProviderFamily,
  status: number,
): ProviderModelDiscoveryError {
  if (status === 401 || status === 403) {
    return new ProviderModelDiscoveryError(
      family,
      "The provider rejected the credential while listing models.",
      status,
    );
  }
  if (status === 404 || status === 405) {
    return new ProviderModelDiscoveryError(
      family,
      "This provider does not expose a compatible model catalog.",
      status,
    );
  }
  if (status === 429) {
    return new ProviderModelDiscoveryError(
      family,
      "The provider rate-limited model discovery. Try again shortly.",
      status,
    );
  }
  return new ProviderModelDiscoveryError(
    family,
    `The provider could not list models (HTTP ${status}).`,
    status,
  );
}

async function boundedJson(
  response: Response,
  family: ProviderFamily,
): Promise<Record<string, unknown>> {
  if (!response.ok) throw responseError(family, response.status);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CATALOG_BYTES) {
    throw new ProviderModelDiscoveryError(
      family,
      "The provider model catalog is too large.",
    );
  }

  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new ProviderModelDiscoveryError(
      family,
      "The provider returned an invalid model catalog.",
    );
  }
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    byteLength += part.value.byteLength;
    if (byteLength > MAX_CATALOG_BYTES) {
      await reader.cancel();
      throw new ProviderModelDiscoveryError(
        family,
        "The provider model catalog is too large.",
      );
    }
    text += decoder.decode(part.value, { stream: true });
  }
  text += decoder.decode();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new ProviderModelDiscoveryError(
      family,
      "The provider returned an invalid model catalog.",
    );
  }
  if (!isRecord(parsed)) {
    throw new ProviderModelDiscoveryError(
      family,
      "The provider returned an invalid model catalog.",
    );
  }
  return parsed;
}

function discoveryUrl(profile: ProviderProfile): URL {
  const endpoint = resolveProviderProfile(profile).canonicalEndpoint;
  if (
    profile.family === "anthropic-compatible" &&
    !endpoint.basePath.endsWith("/v1/")
  ) {
    return joinProviderEndpoint(endpoint, "v1/models");
  }
  return joinProviderEndpoint(endpoint, "models");
}

function sortedModels(models: Map<string, ProviderModel>): ProviderModel[] {
  return [...models.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

export async function listProviderModels(
  profile: ProviderProfile,
  options: ListProviderModelsOptions = {},
): Promise<ProviderModel[]> {
  if (options.signal?.aborted === true) {
    throw new DOMException("Model discovery was aborted.", "AbortError");
  }
  const resolved = resolveProviderProfile(profile);
  const securedFetch = createCredentialedProviderFetch({
    endpoint: resolved.canonicalEndpoint,
    credential: providerCredentials(profile),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const baseUrl = discoveryUrl(profile);
  const headers = new Headers({ accept: "application/json" });
  if (profile.family === "anthropic-compatible") {
    headers.set("anthropic-version", "2023-06-01");
  }

  const models = new Map<string, ProviderModel>();
  const cursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
    const url = new URL(baseUrl);
    if (profile.family === "anthropic-compatible") {
      url.searchParams.set("limit", "1000");
      if (cursor !== undefined) url.searchParams.set("after_id", cursor);
    } else if (profile.family === "gemini") {
      url.searchParams.set("pageSize", "1000");
      if (cursor !== undefined) url.searchParams.set("pageToken", cursor);
    }

    const response = await securedFetch(url, {
      method: "GET",
      headers,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const payload = await boundedJson(response, profile.family);

    let nextCursor: string | undefined;
    if (profile.family === "openai-compatible") {
      if (!Array.isArray(payload.data)) {
        throw new ProviderModelDiscoveryError(
          profile.family,
          "The provider returned an invalid model catalog.",
        );
      }
      for (const raw of payload.data) {
        if (isRecord(raw)) addModel(models, raw.id);
      }
    } else if (profile.family === "anthropic-compatible") {
      if (!Array.isArray(payload.data)) {
        throw new ProviderModelDiscoveryError(
          profile.family,
          "The provider returned an invalid model catalog.",
        );
      }
      for (const raw of payload.data) {
        if (isRecord(raw)) addModel(models, raw.id, raw.display_name);
      }
      if (payload.has_more === true) {
        nextCursor = catalogString(payload.last_id);
        if (nextCursor === undefined) {
          throw new ProviderModelDiscoveryError(
            profile.family,
            "The provider returned an invalid model catalog cursor.",
          );
        }
      }
    } else {
      if (!Array.isArray(payload.models)) {
        throw new ProviderModelDiscoveryError(
          profile.family,
          "The provider returned an invalid model catalog.",
        );
      }
      for (const raw of payload.models) {
        if (!isRecord(raw)) continue;
        const methods = raw.supportedGenerationMethods;
        if (
          Array.isArray(methods) &&
          !methods.some((method) => method === "generateContent")
        ) {
          continue;
        }
        addModel(models, raw.name, raw.displayName, true);
      }
      nextCursor = catalogString(payload.nextPageToken, 500);
    }

    if (
      nextCursor === undefined ||
      models.size >= MAX_CATALOG_MODELS ||
      profile.family === "openai-compatible"
    ) {
      return sortedModels(models);
    }
    if (cursors.has(nextCursor)) {
      throw new ProviderModelDiscoveryError(
        profile.family,
        "The provider repeated a pagination cursor while listing models.",
      );
    }
    cursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new ProviderModelDiscoveryError(
    profile.family,
    "The provider model catalog exceeded the pagination limit.",
  );
}
