import { describe, expect, it } from "vitest";
import { enforceCallPolicy, PolicyError } from "./policy.js";
import { DEFAULT_SETTINGS } from "./settings.js";

describe("extension call policy", () => {
  it("strips provider controls and caps output tokens", () => {
    const alias = DEFAULT_SETTINGS.aliases.default!;
    const result = enforceCallPolicy(
      {
        prompt: [
          {
            role: "user",
            providerOptions: { openai: { store: true } },
            content: [
              {
                type: "text",
                text: "hello",
                providerOptions: { openai: { cache: true } },
              },
            ],
          },
        ],
        maxOutputTokens: 999_999,
        headers: { Authorization: "attacker" },
        providerOptions: { openai: { store: true } },
        tools: [
          {
            type: "function",
            name: "lookup",
            description: "Look up data",
            inputSchema: { type: "object", properties: {} },
            providerOptions: { openai: { anything: true } },
          },
        ],
      },
      alias,
      DEFAULT_SETTINGS,
    );

    expect(result.maxOutputTokens).toBe(alias.maxOutputTokens);
    expect("headers" in result).toBe(false);
    expect("providerOptions" in result).toBe(false);
    const promptMessage = result.prompt[0] as Record<string, unknown>;
    expect("providerOptions" in promptMessage).toBe(false);
    const content = promptMessage.content as Array<Record<string, unknown>>;
    expect("providerOptions" in content[0]!).toBe(false);
    expect(result.tools?.[0]?.type).toBe("function");
    expect("providerOptions" in (result.tools?.[0] ?? {})).toBe(false);
  });

  it("rejects provider-executed tools", () => {
    expect(() =>
      enforceCallPolicy(
        {
          prompt: [],
          tools: [
            {
              type: "provider",
              id: "openai.web_search",
              name: "web_search",
              args: {},
            },
          ],
        },
        DEFAULT_SETTINGS.aliases.default!,
        DEFAULT_SETTINGS,
      ),
    ).toThrow(PolicyError);
  });

  it("normalizes only public response format and tool-choice fields", () => {
    const result = enforceCallPolicy(
      {
        prompt: [],
        responseFormat: {
          type: "json",
          name: "answer",
          schema: {
            type: "object",
            providerOptions: { openai: { strict: false } },
          },
        },
        toolChoice: { type: "auto", providerOptions: { forced: true } },
      },
      DEFAULT_SETTINGS.aliases.default!,
      DEFAULT_SETTINGS,
    );
    expect(result.responseFormat).toEqual({
      type: "json",
      name: "answer",
      schema: { type: "object" },
    });
    expect(result.toolChoice).toEqual({ type: "auto" });
  });

  it("rejects malformed tool choices and duplicate tool names", () => {
    expect(() =>
      enforceCallPolicy(
        { prompt: [], toolChoice: { type: "provider", id: "unsafe" } },
        DEFAULT_SETTINGS.aliases.default!,
        DEFAULT_SETTINGS,
      ),
    ).toThrow(PolicyError);
    const duplicate = {
      type: "function",
      name: "lookup",
      inputSchema: { type: "object" },
    };
    expect(() =>
      enforceCallPolicy(
        { prompt: [], tools: [duplicate, duplicate] },
        DEFAULT_SETTINGS.aliases.default!,
        DEFAULT_SETTINGS,
      ),
    ).toThrow("declared more than once");
  });
});
