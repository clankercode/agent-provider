export class ProviderEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderEndpointError";
  }
}

export interface CanonicalProviderEndpoint {
  /** Canonical serialized origin, including a non-default port. */
  readonly origin: string;
  /** Canonical normalized base path with exactly one trailing slash. */
  readonly basePath: string;
  /** Canonical endpoint URL with exactly one trailing slash. */
  readonly url: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;

export function canonicalizeProviderEndpoint(
  input: string,
): CanonicalProviderEndpoint {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input !== input.trim()
  ) {
    throw new ProviderEndpointError(
      "Provider endpoint must be a non-empty URL.",
    );
  }
  // WHATWG treats backslashes as path separators for special URLs. Rejecting
  // them before parsing prevents a spelling change from widening authority.
  if (input.includes("\\")) {
    throw new ProviderEndpointError(
      "Provider endpoint cannot contain backslashes.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new ProviderEndpointError("Provider endpoint is not a valid URL.");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new ProviderEndpointError(
      "Provider endpoint cannot contain credentials.",
    );
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new ProviderEndpointError(
      "Provider endpoint cannot contain a query or fragment.",
    );
  }
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname))
  ) {
    throw new ProviderEndpointError(
      "Provider endpoint must use HTTPS, except for exact loopback hosts.",
    );
  }
  if (ENCODED_PATH_SEPARATOR.test(parsed.pathname)) {
    throw new ProviderEndpointError(
      "Provider endpoint cannot contain encoded path separators.",
    );
  }

  const withoutTrailingSlash = parsed.pathname.replace(/\/+$/u, "");
  parsed.pathname = `${withoutTrailingSlash}/`;
  const endpoint = {
    origin: parsed.origin,
    basePath: parsed.pathname,
    url: parsed.toString(),
  } satisfies CanonicalProviderEndpoint;
  return Object.freeze(endpoint);
}

/** Joins only adapter-owned relative routes and proves they stay under base. */
export function joinProviderEndpoint(
  endpoint: CanonicalProviderEndpoint,
  adapterRoute: string,
): URL {
  if (
    adapterRoute.length === 0 ||
    adapterRoute.startsWith("/") ||
    adapterRoute.includes("\\") ||
    adapterRoute.includes("?") ||
    adapterRoute.includes("#") ||
    ENCODED_PATH_SEPARATOR.test(adapterRoute)
  ) {
    throw new ProviderEndpointError(
      "Provider route must be a safe relative path without a leading slash.",
    );
  }
  const joined = new URL(adapterRoute, endpoint.url);
  assertProviderDestination(endpoint, joined);
  return joined;
}

/** Rechecks the exact credential destination at the final fetch boundary. */
export function assertProviderDestination(
  endpoint: CanonicalProviderEndpoint,
  destination: string | URL,
): URL {
  let parsed: URL;
  try {
    parsed =
      destination instanceof URL ? new URL(destination) : new URL(destination);
  } catch {
    throw new ProviderEndpointError("Provider request destination is invalid.");
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    parsed.origin !== endpoint.origin ||
    !parsed.pathname.startsWith(endpoint.basePath) ||
    ENCODED_PATH_SEPARATOR.test(parsed.pathname)
  ) {
    throw new ProviderEndpointError(
      "Provider request destination does not match the configured endpoint.",
    );
  }
  return parsed;
}

export type ProviderCredentialHeaders =
  | {
      family: "openai-compatible";
      apiKey: string;
      organization?: string;
      project?: string;
    }
  | { family: "anthropic-compatible"; apiKey: string }
  | { family: "gemini"; apiKey: string };

export interface CredentialedFetchOptions {
  endpoint: CanonicalProviderEndpoint;
  credential: ProviderCredentialHeaders;
  fetch?: typeof globalThis.fetch;
}

const CREDENTIAL_HEADERS = [
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-goog-api-key",
  "openai-organization",
  "openai-project",
] as const;

/**
 * Returns a fetch that removes SDK-supplied placeholder credentials, validates
 * the exact destination, attaches the real credential, and rejects redirects.
 */
export function createCredentialedProviderFetch({
  endpoint,
  credential,
  fetch: nativeFetch = globalThis.fetch,
}: CredentialedFetchOptions): typeof globalThis.fetch {
  return async (input, init) => {
    const incoming = new Request(input, init);
    assertProviderDestination(endpoint, incoming.url);

    const headers = new Headers(incoming.headers);
    for (const header of CREDENTIAL_HEADERS) headers.delete(header);
    if (credential.family === "openai-compatible") {
      headers.set("authorization", `Bearer ${credential.apiKey}`);
      if (credential.organization) {
        headers.set("openai-organization", credential.organization);
      }
      if (credential.project) headers.set("openai-project", credential.project);
    } else if (credential.family === "anthropic-compatible") {
      headers.set("x-api-key", credential.apiKey);
    } else {
      headers.set("x-goog-api-key", credential.apiKey);
    }

    const request = new Request(incoming, {
      credentials: "omit",
      headers,
      redirect: "manual",
      referrerPolicy: "no-referrer",
    });
    const response = await nativeFetch(request);
    if (
      (response.status >= 300 && response.status < 400) ||
      response.type === "opaqueredirect"
    ) {
      throw new ProviderEndpointError("Provider redirects are not permitted.");
    }
    return response;
  };
}
