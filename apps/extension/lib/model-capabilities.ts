/**
 * Model capability lookup via the models.dev catalog.
 *
 * Fetches https://models.dev/catalog.json once per day (manual refresh
 * available). Resolves per-model output token limits and reasoning defaults
 * so alias creation can pick a sensible maxOutputTokens instead of the 2048
 * floor, and default reasoning to "high" for reasoning-capable models.
 *
 * For unknown models the fallback is 65 536 output tokens.
 */

import { browser } from "wxt/browser";
import type { ProviderFamily } from "./provider-profiles.js";

const CATALOG_URL = "https://models.dev/catalog.json";
const CACHE_KEY = "agent-provider.model-catalog.v1";
const MAX_CATALOG_AGE_MS = 24 * 60 * 60 * 1_000; // 1 day
const MAX_CATALOG_BYTES = 6 * 1_048_576;

/** Mapping from our provider families to models.dev provider IDs. */
const FAMILY_TO_CATALOG_PROVIDER: Record<ProviderFamily, string[]> = {
  "openai-compatible": ["openai"],
  "anthropic-compatible": ["anthropic"],
  gemini: ["google"],
};

/** Default output tokens when we have no catalog data for the model. */
export const DEFAULT_UNKNOWN_MAX_OUTPUT_TOKENS = 65_536;

/** Default reasoning level for reasoning-capable models. */
export const DEFAULT_REASONING_LEVEL = "high" as const;

/** Hard ceiling so we never suggest more than the extension can clamp. */
const SAFE_MAX_OUTPUT_CEILING = 524_288;

export interface ModelCapabilities {
  readonly maxOutputTokens: number;
  readonly supportsReasoning: boolean;
  readonly reasoningLevels?: readonly string[];
}

interface ReasoningOption {
  readonly type: "effort" | "toggle" | "budget_tokens";
  readonly values?: readonly string[];
}

export interface CatalogModel {
  readonly id: string;
  readonly name: string;
  readonly limit: {
    readonly context: number;
    readonly output: number;
  };
  readonly reasoning: boolean;
  readonly reasoning_options?: readonly ReasoningOption[];
}

export interface CatalogProvider {
  readonly id: string;
  readonly name: string;
  readonly models: Record<string, CatalogModel>;
}

interface CachedCatalog {
  readonly fetchedAt: number;
  readonly providers: Record<string, CatalogProvider>;
}

let memoryCache: CachedCatalog | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseReasoningOption(raw: unknown): ReasoningOption | undefined {
  if (!isRecord(raw)) return undefined;
  const type = raw.type;
  if (type !== "effort" && type !== "toggle" && type !== "budget_tokens") {
    return undefined;
  }
  if (type === "effort") {
    if (!Array.isArray(raw.values)) return undefined;
    const values = raw.values.filter((v): v is string => typeof v === "string");
    return { type, values };
  }
  return { type };
}

function parseCatalogModel(raw: unknown): CatalogModel | undefined {
  if (!isRecord(raw)) return undefined;
  const limitRaw = raw.limit;
  if (!isRecord(limitRaw)) return undefined;
  const context = typeof limitRaw.context === "number" ? limitRaw.context : 0;
  const output =
    typeof limitRaw.output === "number" ? limitRaw.output : undefined;
  if (output === undefined) return undefined;
  const name = typeof raw.name === "string" ? raw.name : "";
  const reasoning = raw.reasoning === true;
  let reasoningOptions: readonly ReasoningOption[] | undefined;
  if (Array.isArray(raw.reasoning_options)) {
    const parsed = raw.reasoning_options
      .map(parseReasoningOption)
      .filter((o): o is ReasoningOption => o !== undefined);
    if (parsed.length > 0) reasoningOptions = parsed;
  }
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    name,
    limit: { context, output },
    reasoning,
    ...(reasoningOptions === undefined
      ? {}
      : { reasoning_options: reasoningOptions }),
  };
}

function parseCatalog(
  raw: unknown,
): Record<string, CatalogProvider> | undefined {
  if (!isRecord(raw)) return undefined;
  const providersRaw = raw.providers;
  if (!isRecord(providersRaw)) return undefined;
  const providers: Record<string, CatalogProvider> = {};
  for (const [providerId, providerRaw] of Object.entries(providersRaw)) {
    if (!isRecord(providerRaw)) continue;
    const modelsRaw = providerRaw.models;
    if (!isRecord(modelsRaw)) continue;
    const models: Record<string, CatalogModel> = {};
    for (const [modelId, modelRaw] of Object.entries(modelsRaw)) {
      const parsed = parseCatalogModel(modelRaw);
      if (parsed !== undefined) models[modelId] = parsed;
    }
    providers[providerId] = {
      id: providerId,
      name:
        typeof providerRaw.name === "string" ? providerRaw.name : providerId,
      models,
    };
  }
  return providers;
}

async function readCache(): Promise<CachedCatalog | undefined> {
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const raw = result[CACHE_KEY];
    if (!isRecord(raw)) return undefined;
    const fetchedAt = typeof raw.fetchedAt === "number" ? raw.fetchedAt : 0;
    const providers = parseCatalog(raw.providers);
    if (providers === undefined) return undefined;
    return { fetchedAt, providers };
  } catch {
    return undefined;
  }
}

async function writeCache(catalog: CachedCatalog): Promise<void> {
  try {
    await browser.storage.local.set({ [CACHE_KEY]: catalog });
  } catch {
    // Storage quota or serialization issues are non-fatal.
  }
}

export interface FetchCatalogOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}

async function fetchCatalog(
  options: FetchCatalogOptions = {},
): Promise<CachedCatalog | undefined> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(CATALOG_URL, {
      method: "GET",
      headers: { accept: "application/json" },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch {
    return undefined;
  }
  if (!response.ok) return undefined;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CATALOG_BYTES) {
    return undefined;
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (text.length === 0 || text.length > MAX_CATALOG_BYTES) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  const providers = parseCatalog(parsed);
  if (providers === undefined) return undefined;
  return { fetchedAt: Date.now(), providers };
}

/** Returns the cached catalog, fetching if stale or missing. */
export async function getCatalog(
  options: FetchCatalogOptions = {},
): Promise<CachedCatalog | undefined> {
  if (memoryCache === undefined) {
    memoryCache = await readCache();
  }
  const stale =
    memoryCache === undefined ||
    Date.now() - memoryCache.fetchedAt > MAX_CATALOG_AGE_MS;
  if (stale) {
    const fresh = await fetchCatalog(options);
    if (fresh !== undefined) {
      memoryCache = fresh;
      await writeCache(fresh);
    }
  }
  return memoryCache;
}

/** Force-refresh the catalog from the network. */
export async function refreshCatalog(
  options: FetchCatalogOptions = {},
): Promise<boolean> {
  const fresh = await fetchCatalog(options);
  if (fresh === undefined) return false;
  memoryCache = fresh;
  await writeCache(fresh);
  return true;
}

/**
 * Look up capabilities for a model under a given provider family.
 *
 * Searches the catalog provider(s) mapped to the family, matching on model
 * ID (exact first, then a loose contains match for IDs like "gpt-5-mini"
 * vs catalog "gpt-5.2-mini").
 */
export async function lookupModelCapabilities(
  family: ProviderFamily,
  modelId: string,
  options: FetchCatalogOptions = {},
): Promise<ModelCapabilities> {
  const catalog = await getCatalog(options);
  if (catalog === undefined) {
    return {
      maxOutputTokens: DEFAULT_UNKNOWN_MAX_OUTPUT_TOKENS,
      supportsReasoning: false,
    };
  }
  const providerIds = FAMILY_TO_CATALOG_PROVIDER[family];
  const normalized = modelId.toLowerCase().trim();
  for (const providerId of providerIds) {
    const provider = catalog.providers[providerId];
    if (provider === undefined) continue;
    const exact = provider.models[normalized] ?? provider.models[modelId];
    if (exact !== undefined) return toCapabilities(exact);
    let best: CatalogModel | undefined;
    let bestScore = Infinity;
    for (const [catalogId, model] of Object.entries(provider.models)) {
      const cat = catalogId.toLowerCase();
      if (cat === normalized) {
        best = model;
        break;
      }
      if (cat.includes(normalized) || normalized.includes(cat)) {
        const score = Math.abs(cat.length - normalized.length);
        if (score < bestScore) {
          bestScore = score;
          best = model;
        }
      }
    }
    if (best !== undefined) return toCapabilities(best);
  }
  return {
    maxOutputTokens: DEFAULT_UNKNOWN_MAX_OUTPUT_TOKENS,
    supportsReasoning: false,
  };
}

function toCapabilities(model: CatalogModel): ModelCapabilities {
  const rawOutput = model.limit.output;
  const maxOutputTokens = Math.max(
    64,
    Math.min(Math.floor(rawOutput), SAFE_MAX_OUTPUT_CEILING),
  );
  let reasoningLevels: readonly string[] | undefined;
  if (model.reasoning_options !== undefined) {
    for (const opt of model.reasoning_options) {
      if (opt.type === "effort" && opt.values !== undefined) {
        reasoningLevels = opt.values;
        break;
      }
    }
  }
  return {
    maxOutputTokens,
    supportsReasoning: model.reasoning,
    ...(reasoningLevels === undefined ? {} : { reasoningLevels }),
  };
}
