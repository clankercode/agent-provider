import { describe, expect, it, vi } from "vitest";
import { PROVIDER_PROFILES } from "./fixtures/providers.js";
import {
  listProviderModels,
  ProviderModelDiscoveryError,
} from "./provider-models.js";

describe("provider model discovery", () => {
  it("lists, deduplicates, and sorts OpenAI-compatible models", async () => {
    let captured: Request | undefined;
    const nativeFetch = vi.fn(async (request: Request) => {
      captured = request;
      return Response.json({
        data: [
          { id: "zeta-model" },
          { id: "alpha-model" },
          { id: "alpha-model" },
          { id: "" },
        ],
      });
    }) as unknown as typeof fetch;

    const models = await listProviderModels(
      {
        ...PROVIDER_PROFILES.openai!,
        organization: "org-fixture",
        project: "project-fixture",
      },
      { fetch: nativeFetch },
    );

    expect(models).toEqual([{ id: "alpha-model" }, { id: "zeta-model" }]);
    expect(captured?.url).toBe("https://openai.fixture.invalid/v1/models");
    expect(captured?.headers.get("authorization")).toBe(
      "Bearer fixture-secret-never-use-live",
    );
    expect(captured?.headers.get("openai-organization")).toBe("org-fixture");
    expect(captured?.headers.get("openai-project")).toBe("project-fixture");
    expect(captured?.credentials).toBe("omit");
    expect(captured?.redirect).toBe("manual");
  });

  it("paginates an Anthropic-compatible service-root catalog", async () => {
    const requests: Request[] = [];
    const nativeFetch = vi.fn(async (request: Request) => {
      requests.push(request);
      const afterId = new URL(request.url).searchParams.get("after_id");
      return Response.json(
        afterId === null
          ? {
              data: [{ id: "claude-first", display_name: "Claude First" }],
              has_more: true,
              last_id: "claude-first",
            }
          : {
              data: [{ id: "claude-second", display_name: "Claude Second" }],
              has_more: false,
              last_id: "claude-second",
            },
      );
    }) as unknown as typeof fetch;

    const models = await listProviderModels(
      {
        ...PROVIDER_PROFILES.anthropic!,
        endpoint: "https://anthropic.fixture.invalid/",
      },
      { fetch: nativeFetch },
    );

    expect(models).toEqual([
      { id: "claude-first", displayName: "Claude First" },
      { id: "claude-second", displayName: "Claude Second" },
    ]);
    expect(requests.map((request) => request.url)).toEqual([
      "https://anthropic.fixture.invalid/v1/models?limit=1000",
      "https://anthropic.fixture.invalid/v1/models?limit=1000&after_id=claude-first",
    ]);
    expect(requests[0]?.headers.get("x-api-key")).toBe(
      "fixture-secret-never-use-live",
    );
    expect(requests[0]?.headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("paginates Gemini and keeps only generateContent models", async () => {
    const requests: Request[] = [];
    const nativeFetch = vi.fn(async (request: Request) => {
      requests.push(request);
      const pageToken = new URL(request.url).searchParams.get("pageToken");
      return Response.json(
        pageToken === null
          ? {
              models: [
                {
                  name: "models/gemini-zeta",
                  displayName: "Gemini Zeta",
                  supportedGenerationMethods: ["generateContent"],
                },
                {
                  name: "models/embedding-only",
                  supportedGenerationMethods: ["embedContent"],
                },
              ],
              nextPageToken: "next-page",
            }
          : {
              models: [
                {
                  name: "models/gemini-alpha",
                  displayName: "Gemini Alpha",
                },
              ],
            },
      );
    }) as unknown as typeof fetch;

    const models = await listProviderModels(PROVIDER_PROFILES.gemini!, {
      fetch: nativeFetch,
    });

    expect(models).toEqual([
      { id: "gemini-alpha", displayName: "Gemini Alpha" },
      { id: "gemini-zeta", displayName: "Gemini Zeta" },
    ]);
    expect(requests.map((request) => request.url)).toEqual([
      "https://gemini.fixture.invalid/v1beta/models?pageSize=1000",
      "https://gemini.fixture.invalid/v1beta/models?pageSize=1000&pageToken=next-page",
    ]);
    expect(requests[0]?.headers.get("x-goog-api-key")).toBe(
      "fixture-secret-never-use-live",
    );
  });

  it("fails safely without exposing provider response bodies", async () => {
    const secretBody = "upstream secret diagnostic";
    await expect(
      listProviderModels(PROVIDER_PROFILES.openai!, {
        fetch: vi.fn(
          async () => new Response(secretBody, { status: 401 }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ProviderModelDiscoveryError",
        message: "The provider rejected the credential while listing models.",
        status: 401,
      }) as ProviderModelDiscoveryError,
    );

    try {
      await listProviderModels(PROVIDER_PROFILES.openai!, {
        fetch: vi.fn(
          async () => new Response(secretBody, { status: 401 }),
        ) as unknown as typeof fetch,
      });
    } catch (cause) {
      expect(String(cause)).not.toContain(secretBody);
    }
  });

  it("rejects malformed, oversized, and looping catalogs", async () => {
    await expect(
      listProviderModels(PROVIDER_PROFILES.openai!, {
        fetch: vi.fn(async () =>
          Response.json({ models: [] }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("invalid model catalog");

    await expect(
      listProviderModels(PROVIDER_PROFILES.openai!, {
        fetch: vi.fn(
          async () =>
            new Response("x".repeat(1_048_577), {
              headers: { "content-type": "application/json" },
            }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("too large");

    await expect(
      listProviderModels(PROVIDER_PROFILES.gemini!, {
        fetch: vi.fn(async () =>
          Response.json({ models: [], nextPageToken: "same-token" }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("repeated a pagination cursor");
  });

  it("does not dispatch a pre-aborted discovery request", async () => {
    const controller = new AbortController();
    controller.abort();
    const nativeFetch = vi.fn();

    await expect(
      listProviderModels(PROVIDER_PROFILES.openai!, {
        fetch: nativeFetch,
        signal: controller.signal,
      }),
    ).rejects.toEqual(expect.objectContaining({ name: "AbortError" }));
    expect(nativeFetch).not.toHaveBeenCalled();
  });
});
