import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { instantChatbot } from "./runtime.js";
import { defineAgentProviderTools } from "./tools.js";

describe("tool definition inference", () => {
  it("infers callback inputs from each input schema", () => {
    const tools = defineAgentProviderTools({
      find_record: {
        description: "Find a record.",
        risk: "read",
        inputSchema: z.object({ id: z.string(), limit: z.number().int() }),
        confirmation: ({ id, limit }) => `${id}:${limit}`,
        execute: ({ id, limit }) => {
          expectTypeOf(id).toEqualTypeOf<string>();
          expectTypeOf(limit).toEqualTypeOf<number>();
          return { id, limit };
        },
      },
    });

    expectTypeOf(tools.find_record.inputSchema).toMatchTypeOf<
      z.ZodType<{ id: string; limit: number }>
    >();
  });

  it("contextually types inline instantChatbot tools", () => {
    if (false) {
      const runtime = instantChatbot({
        model: {} as never,
        tools: {
          set_status: {
            description: "Set a status.",
            risk: "write",
            inputSchema: z.object({ status: z.enum(["ready", "paused"]) }),
            approvalLabel: ({ status }) => {
              expectTypeOf(status).toEqualTypeOf<"ready" | "paused">();
              return `Set ${status}?`;
            },
            execute: ({ status }) => {
              expectTypeOf(status).toEqualTypeOf<"ready" | "paused">();
              return { status };
            },
          },
        },
      });

      runtime.destroy();
    }
  });
});
