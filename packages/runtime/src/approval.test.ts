import { describe, expect, it, vi } from "vitest";
import { ApprovalManager } from "./approval.js";

describe("ApprovalManager", () => {
  it("publishes and resolves approvals", async () => {
    const snapshots: string[][] = [];
    const manager = new ApprovalManager(1_000, (requests) => {
      snapshots.push(requests.map((request) => request.id));
    });

    const result = manager.request({
      toolCallId: "call-1",
      toolName: "refund_order",
      label: "Refund order?",
      risk: "destructive",
      input: { orderId: "A-1" },
    });

    const [request] = manager.snapshot();
    expect(request?.toolName).toBe("refund_order");
    expect(manager.resolve(request!.id, true)).toBe(true);
    await expect(result).resolves.toBe(true);
    expect(manager.snapshot()).toEqual([]);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
  });

  it("times out safely as denied", async () => {
    vi.useFakeTimers();
    const manager = new ApprovalManager(10, () => {});
    const result = manager.request({
      toolCallId: "call-2",
      toolName: "write",
      label: "Write?",
      risk: "write",
      input: {},
    });
    await vi.advanceTimersByTimeAsync(11);
    await expect(result).resolves.toBe(false);
    vi.useRealTimers();
  });
});
