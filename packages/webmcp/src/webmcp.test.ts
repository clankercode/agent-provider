import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mirrorToolsToWebMcp } from "./index.js";

describe("mirrorToolsToWebMcp", () => {
  it("mirrors reads by default and requires explicit opt-in for writes", async () => {
    const registered: string[] = [];
    const document = {
      modelContext: {
        registerTool: (tool: { name: string }) => {
          registered.push(tool.name);
        },
      },
    } as unknown as Document;

    const handle = await mirrorToolsToWebMcp(
      {
        read_record: {
          description: "Read.",
          inputSchema: z.object({}),
          risk: "read",
          execute: () => ({ ok: true }),
        },
        write_record: {
          description: "Write.",
          inputSchema: z.object({}),
          risk: "write",
          execute: () => ({ ok: true }),
        },
        opted_in_write: {
          description: "Write with explicit host-managed approval.",
          inputSchema: z.object({}),
          risk: "write",
          webMcp: true,
          execute: () => ({ ok: true }),
        },
      },
      { document },
    );

    expect(handle.supported).toBe(true);
    expect(registered).toEqual(["read_record", "opted_in_write"]);
    handle.dispose();
  });
});
