import { describe, expect, it, vi } from "vitest";
import {
  ProviderEndpointError,
  assertProviderDestination,
  canonicalizeProviderEndpoint,
  createCredentialedProviderFetch,
  joinProviderEndpoint,
} from "./provider-endpoint.js";

describe("provider endpoint authority", () => {
  it("uses WHATWG normalization and an exact trailing-slash base", () => {
    expect(
      canonicalizeProviderEndpoint("https://ExAmPle.COM:443/a/../v1//"),
    ).toEqual({
      origin: "https://example.com",
      basePath: "/v1/",
      url: "https://example.com/v1/",
    });
    expect(canonicalizeProviderEndpoint("http://[::1]:80/v1").url).toBe(
      "http://[::1]/v1/",
    );
  });

  it.each([
    "http://provider.example/v1",
    "http://localhost.example/v1",
    "https://user:pass@provider.example/v1",
    "https://provider.example/v1?key=x",
    "https://provider.example/v1#fragment",
    "https://provider.example/v1/%2f/admin",
    "https://provider.example/v1/%5C/admin",
    "https://provider.example/v1\\admin",
    " https://provider.example/v1",
  ])("rejects adversarial endpoint %s", (endpoint) => {
    expect(() => canonicalizeProviderEndpoint(endpoint)).toThrow(
      ProviderEndpointError,
    );
  });

  it("joins adapter routes without permitting base-path escape", () => {
    const endpoint = canonicalizeProviderEndpoint(
      "https://provider.example/api/v1/",
    );
    expect(joinProviderEndpoint(endpoint, "chat/completions").href).toBe(
      "https://provider.example/api/v1/chat/completions",
    );
    expect(() => joinProviderEndpoint(endpoint, "../admin")).toThrow(
      ProviderEndpointError,
    );
    expect(() => joinProviderEndpoint(endpoint, "/chat/completions")).toThrow(
      ProviderEndpointError,
    );
    expect(() =>
      assertProviderDestination(
        endpoint,
        "https://provider.example.evil/api/v1/x",
      ),
    ).toThrow(ProviderEndpointError);
  });

  it("attaches credentials only after exact destination checks", async () => {
    const endpoint = canonicalizeProviderEndpoint(
      "https://provider.example/v1/",
    );
    let captured: Request | undefined;
    const nativeFetch = vi.fn(async (request: Request) => {
      captured = request;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const securedFetch = createCredentialedProviderFetch({
      endpoint,
      credential: {
        family: "openai-compatible",
        apiKey: "real-fixture-secret",
        organization: "org-fixture",
      },
      fetch: nativeFetch,
    });

    await securedFetch("https://provider.example/v1/responses", {
      headers: { authorization: "Bearer attacker-controlled" },
    });
    expect(captured?.redirect).toBe("manual");
    expect(captured?.credentials).toBe("omit");
    expect(captured?.headers.get("authorization")).toBe(
      "Bearer real-fixture-secret",
    );
    expect(captured?.headers.get("openai-organization")).toBe("org-fixture");

    await expect(
      securedFetch("https://attacker.example/v1/responses"),
    ).rejects.toThrow(ProviderEndpointError);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed on every redirect response", async () => {
    const endpoint = canonicalizeProviderEndpoint(
      "https://provider.example/v1/",
    );
    const securedFetch = createCredentialedProviderFetch({
      endpoint,
      credential: { family: "gemini", apiKey: "fixture" },
      fetch: vi.fn(
        async () =>
          new Response(null, {
            status: 307,
            headers: { location: "https://attacker.example/" },
          }),
      ) as unknown as typeof fetch,
    });
    await expect(
      securedFetch("https://provider.example/v1/models"),
    ).rejects.toThrow("redirects are not permitted");
  });
});
