import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createToolSet } from "./tools.js";

describe("createToolSet", () => {
  it("uses a string confirmation result as the approval label", async () => {
    let observedLabel: string | undefined;
    const tools = createToolSet(
      {
        update_record: {
          description: "Update a record.",
          inputSchema: z.object({ id: z.string() }),
          risk: "write",
          confirmation: ({ id }) => `Update record ${id}?`,
          execute: ({ id }) => ({ updated: id }),
        },
      },
      {
        approvals: {
          request: (request) => {
            observedLabel = request.label;
            return Promise.resolve(true);
          },
        },
        onActivity: () => {},
        getRunId: () => "run-1",
      },
    );

    const execute = tools.update_record?.execute as
      | ((
          input: { id: string },
          options: { toolCallId: string; messages: [] },
        ) => unknown | PromiseLike<unknown>)
      | undefined;
    expect(execute).toBeTypeOf("function");
    const result = await execute!(
      { id: "A-17" },
      {
        toolCallId: "call-1",
        messages: [],
      },
    );

    expect(observedLabel).toBe("Update record A-17?");
    expect(result).toEqual({ updated: "A-17" });
  });

  it("does not let a mutation confirmation rule disable approval", async () => {
    let approvals = 0;
    let observedIdempotencyKey = "";
    const tools = createToolSet(
      {
        remove_record: {
          description: "Remove a record.",
          inputSchema: z.object({ id: z.string() }),
          risk: "destructive",
          confirmation: () => false,
          execute: (_input, context) => {
            observedIdempotencyKey = context.idempotencyKey;
            return { removed: true };
          },
        },
      },
      {
        approvals: {
          request: () => {
            approvals += 1;
            return Promise.resolve(true);
          },
        },
        onActivity: () => {},
        getRunId: () => "run-safe",
      },
    );

    const execute = tools.remove_record?.execute as unknown as (
      input: { id: string },
      options: { toolCallId: string; messages: [] },
    ) => Promise<unknown>;
    await execute({ id: "record-1" }, { toolCallId: "call-9", messages: [] });
    expect(approvals).toBe(1);
    expect(observedIdempotencyKey).toBe("run-safe:call-9");
  });

  it("binds extension approval to declaration and input before every callback", async () => {
    let executed = false;
    const reports: string[] = [];
    const tools = createToolSet(
      {
        read_record: {
          description: "Read a record.",
          inputSchema: z.object({ id: z.string() }),
          risk: "read",
          execute: () => {
            executed = true;
            return { ok: true };
          },
        },
      },
      {
        approvals: { request: () => Promise.resolve(true) },
        extensionAuthority: {
          requestApproval: (request) => {
            expect(request.declarationHash).toMatch(/^[a-f0-9]{64}$/);
            expect(request.inputHash).toMatch(/^[a-f0-9]{64}$/);
            expect(request.input).toEqual({ id: "A-17" });
            return Promise.resolve({ approved: false, reason: "denied" });
          },
          report: (report) => reports.push(report.state),
        },
        onActivity: () => {},
        getRunId: () => "run-audit",
      },
    );

    const execute = tools.read_record?.execute as unknown as (
      input: { id: string },
      options: { toolCallId: string; messages: [] },
    ) => Promise<unknown>;
    await expect(
      execute({ id: "A-17" }, { toolCallId: "call-audit", messages: [] }),
    ).resolves.toMatchObject({ denied: true });
    expect(executed).toBe(false);
    expect(reports).toEqual(["queued", "cancelled"]);
  });
});
