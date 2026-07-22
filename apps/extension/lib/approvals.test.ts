import { describe, expect, it } from "vitest";
import {
  InMemoryApprovalStore,
  createApprovalRecord,
  type ProviderApprovalBinding,
  type ToolApprovalBinding,
} from "./approvals.js";

const binding: ProviderApprovalBinding = {
  origin: "https://app.example",
  tabId: 1,
  clientId: "client",
  sessionId: "session",
  requestId: "request",
  mode: "audit-first",
  aliasFingerprint: "a".repeat(64),
  dispatchPayloadHash: "b".repeat(64),
};

describe("single-use authority approvals", () => {
  it("atomically compares and consumes an exact approved record once", async () => {
    const store = new InMemoryApprovalStore();
    const record = await createApprovalRecord({
      id: "approval",
      kind: "provider",
      binding,
      decision: "approved",
      createdAt: 100,
      expiresAt: 300,
    });
    await store.put(record);
    const [first, second] = await Promise.all([
      store.consume("approval", "provider", binding, 200),
      store.consume("approval", "provider", binding, 200),
    ]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
  });

  it("does not consume on forged mismatch, but consumes denial and expiry", async () => {
    const store = new InMemoryApprovalStore();
    await store.put(
      await createApprovalRecord({
        id: "approval",
        kind: "provider",
        binding,
        decision: "approved",
        createdAt: 100,
        expiresAt: 300,
      }),
    );
    await expect(
      store.consume(
        "approval",
        "provider",
        { ...binding, requestId: "forged" },
        200,
      ),
    ).resolves.toEqual({ ok: false, reason: "mismatch" });
    await expect(
      store.consume("approval", "provider", binding, 300),
    ).resolves.toEqual({ ok: false, reason: "expired" });
    await expect(
      store.consume("approval", "provider", binding, 200),
    ).resolves.toEqual({ ok: false, reason: "missing" });
  });

  it("keeps tool approvals distinct and binds declaration, input, run, and call", async () => {
    const store = new InMemoryApprovalStore();
    const toolBinding: ToolApprovalBinding = {
      origin: "https://app.example",
      tabId: 1,
      clientId: "client",
      sessionId: "session",
      requestId: "request",
      runId: "run",
      toolCallId: "call",
      toolName: "update_order",
      risk: "write",
      declarationInputHash: "c".repeat(64),
    };
    await store.put(
      await createApprovalRecord({
        id: "tool-approval",
        kind: "tool",
        binding: toolBinding,
        decision: "approved",
        createdAt: 100,
        expiresAt: 300,
      }),
    );
    await expect(
      store.consume("tool-approval", "provider", toolBinding, 200),
    ).resolves.toEqual({ ok: false, reason: "mismatch" });
    await expect(
      store.consume(
        "tool-approval",
        "tool",
        { ...toolBinding, toolCallId: "other" },
        200,
      ),
    ).resolves.toEqual({ ok: false, reason: "mismatch" });
    await expect(
      store.consume("tool-approval", "tool", toolBinding, 200),
    ).resolves.toMatchObject({ ok: true });
  });
});
