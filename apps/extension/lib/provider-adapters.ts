import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import { createCredentialedProviderFetch } from "./provider-endpoint.js";
import { providerCredentials } from "./provider-credentials.js";
import {
  resolveProviderProfile,
  type ProviderAlias,
  type ProviderFamily,
  type ProviderProfile,
} from "./provider-profiles.js";

const SDK_PLACEHOLDER_KEY = "agent-provider-managed-credential";

export class ProviderAdapterError extends Error {
  readonly family: ProviderFamily;
  readonly retryable: boolean;

  constructor(family: ProviderFamily, retryable = false) {
    super("The configured model provider request failed.");
    this.name = "ProviderAdapterError";
    this.family = family;
    this.retryable = retryable;
  }
}

export interface ProviderAdapter {
  readonly family: ProviderFamily;
  generate(
    alias: ProviderAlias,
    options: LanguageModelV4CallOptions,
    abortSignal: AbortSignal,
  ): Promise<LanguageModelV4GenerateResult>;
  stream(
    alias: ProviderAlias,
    options: LanguageModelV4CallOptions,
    abortSignal: AbortSignal,
  ): Promise<LanguageModelV4StreamResult>;
}

function providerSdkBaseUrl(
  profile: ProviderProfile,
  endpoint: string,
): string {
  if (profile.family !== "anthropic-compatible") return endpoint;
  const parsed = new URL(endpoint);
  if (!parsed.pathname.endsWith("/v1/")) {
    parsed.pathname = `${parsed.pathname}v1/`;
  }
  return parsed.toString();
}

function createSdkModel(
  profile: ProviderProfile,
  alias: ProviderAlias,
  nativeFetch?: typeof globalThis.fetch,
): LanguageModelV4 {
  const resolved = resolveProviderProfile(profile);
  if (
    alias.profileId !== profile.id ||
    alias.modelId.length === 0 ||
    alias.modelId.length > 200 ||
    /[\r\n]/u.test(alias.modelId)
  ) {
    throw new TypeError("Provider alias references a different profile.");
  }
  const providerFetch = createCredentialedProviderFetch({
    endpoint: resolved.canonicalEndpoint,
    credential: providerCredentials(profile),
    ...(nativeFetch === undefined ? {} : { fetch: nativeFetch }),
  });

  if (profile.family === "openai-compatible") {
    return createOpenAI({
      apiKey: SDK_PLACEHOLDER_KEY,
      baseURL: resolved.canonicalEndpoint.url,
      fetch: providerFetch,
    })(alias.modelId);
  }
  if (profile.family === "anthropic-compatible") {
    return createAnthropic({
      apiKey: SDK_PLACEHOLDER_KEY,
      // Anthropic-compatible profile endpoints name the service root. The AI
      // SDK expects the API base and appends /messages itself.
      baseURL: providerSdkBaseUrl(profile, resolved.canonicalEndpoint.url),
      fetch: providerFetch,
    })(alias.modelId);
  }
  return createGoogleGenerativeAI({
    apiKey: SDK_PLACEHOLDER_KEY,
    baseURL: resolved.canonicalEndpoint.url,
    fetch: providerFetch,
  })(alias.modelId);
}

export function createProviderAdapter(
  profile: ProviderProfile,
  options: { fetch?: typeof globalThis.fetch } = {},
): ProviderAdapter {
  const invoke = async <T>(
    operation: () => Promise<T>,
    abortSignal: AbortSignal,
  ): Promise<T> => {
    if (abortSignal.aborted) {
      throw new DOMException("The provider request was aborted.", "AbortError");
    }
    try {
      return await operation();
    } catch (error) {
      if (abortSignal.aborted) {
        throw new DOMException(
          "The provider request was aborted.",
          "AbortError",
        );
      }
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      if (error instanceof ProviderAdapterError) throw error;
      throw new ProviderAdapterError(profile.family);
    }
  };

  return Object.freeze({
    family: profile.family,
    generate: (
      alias: ProviderAlias,
      callOptions: LanguageModelV4CallOptions,
      abortSignal: AbortSignal,
    ): Promise<LanguageModelV4GenerateResult> =>
      invoke(
        () =>
          Promise.resolve(
            createSdkModel(profile, alias, options.fetch).doGenerate({
              ...callOptions,
              abortSignal,
            }),
          ),
        abortSignal,
      ),
    stream: (
      alias: ProviderAlias,
      callOptions: LanguageModelV4CallOptions,
      abortSignal: AbortSignal,
    ): Promise<LanguageModelV4StreamResult> =>
      invoke(
        () =>
          Promise.resolve(
            createSdkModel(profile, alias, options.fetch).doStream({
              ...callOptions,
              abortSignal,
            }),
          ),
        abortSignal,
      ),
  });
}
