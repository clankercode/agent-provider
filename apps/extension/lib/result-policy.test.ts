import { describe, expect, it } from "vitest";
import type {
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import {
  sanitizeGenerateResult,
  sanitizeStreamPart,
  scrubProviderOutput,
} from "./result-policy.js";

const usage: LanguageModelV4GenerateResult["usage"] = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 1,
    text: 1,
    reasoning: 0,
  },
};

describe("provider result policy", () => {
  it("drops raw HTTP material and redacts nested secrets", () => {
    const input = {
      content: [
        {
          type: "text",
          text: "ok",
          providerMetadata: {
            openai: {
              responseId: "resp_123",
              authorization: "Bearer secret-token",
            },
          },
        },
      ],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
      request: { body: { secret: "request body" } },
      response: {
        id: "resp_123",
        modelId: "example-model",
        headers: { "set-cookie": "session=secret" },
        body: { secret: "response body" },
      },
      providerMetadata: {
        openai: {
          apiKey: "sk-1234567890",
          responseId: "resp_123",
        },
      },
    } as unknown as LanguageModelV4GenerateResult;

    const result = sanitizeGenerateResult(input);
    expect(result).not.toHaveProperty("request");
    expect(result.response).toEqual({
      id: "resp_123",
      modelId: "example-model",
    });
    expect(result.providerMetadata).toEqual({
      openai: { responseId: "resp_123" },
    });
    expect(result.content[0]).toEqual({
      type: "text",
      text: "ok",
      providerMetadata: { openai: { responseId: "resp_123" } },
    });
  });

  it("drops raw stream chunks and redacts streamed errors", () => {
    expect(
      sanitizeStreamPart({
        type: "raw",
        rawValue: { headers: { authorization: "Bearer secret" } },
      }),
    ).toBeUndefined();

    const part = sanitizeStreamPart({
      type: "error",
      error: new Error("provider rejected sk-1234567890"),
    } as LanguageModelV4StreamPart);
    expect(part).toEqual({
      type: "error",
      error: "provider rejected [redacted]",
    });
  });

  it("scrubs credential variants, cycles, and accessors without invoking them", () => {
    let getterCalled = false;
    const value: Record<string, unknown> = {
      access_token: "token-secret",
      nested: { text: "Bearer abc.def.ghi", apiKeyValue: "secret" },
    };
    value.self = value;
    Object.defineProperty(value, "dangerous", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "sk-1234567890";
      },
    });
    expect(scrubProviderOutput(value)).toEqual({
      nested: { text: "Bearer [redacted]" },
      self: "[circular metadata removed]",
    });
    expect(getterCalled).toBe(false);
  });
});
