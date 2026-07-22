import { describe, expect, it } from "vitest";
import {
  AuditRecorder,
  InMemoryPersistentAuditStore,
  applyAuditRetention,
  createAuditEvent,
  tightenAuditRetention,
} from "./audit.js";

describe("metadata-only audit", () => {
  it("whitelists metadata and excludes content/provider transport", () => {
    const event = createAuditEvent({
      id: "event-1",
      timestamp: 100,
      type: "model-request",
      origin: "https://app.example",
      alias: "default",
      prompt: "must not persist",
      toolArguments: { secret: true },
      providerResponse: { headers: { authorization: "secret" } },
    });
    expect(event).toEqual({
      id: "event-1",
      timestamp: 100,
      type: "model-request",
      origin: "https://app.example",
      alias: "default",
    });
  });

  it("never touches persistent storage in private mode", async () => {
    const persistent = new InMemoryPersistentAuditStore();
    const recorder = new AuditRecorder(persistent);
    await recorder.record(
      {
        id: "private",
        timestamp: 100,
        type: "model-request",
        origin: "https://app.example",
      },
      { privateMode: true, persistentEnabled: true, now: 100 },
    );
    expect(recorder.sessionEvents()).toHaveLength(1);
    expect(await persistent.load()).toHaveLength(0);
  });

  it("prunes oldest events at age, count, and byte limits", () => {
    const events = [1, 2, 3].map((timestamp) =>
      createAuditEvent({
        id: `event-${timestamp}`,
        timestamp,
        type: "bridge-failure",
      }),
    );
    expect(
      applyAuditRetention(events, { maxAgeMs: 2, maxEvents: 1 }, 4).map(
        (event) => event.id,
      ),
    ).toEqual(["event-3"]);
    expect(applyAuditRetention(events, { maxBytes: 0 }, 4)).toEqual([]);
    expect(tightenAuditRetention({ maxEvents: 99_999 }).maxEvents).toBe(10_000);
  });

  it("deletes one origin independently from all persistent audit", async () => {
    const persistent = new InMemoryPersistentAuditStore();
    const recorder = new AuditRecorder(persistent);
    for (const origin of ["https://a.example", "https://b.example"]) {
      await recorder.record(
        { timestamp: 100, type: "audit-control", origin },
        { privateMode: false, persistentEnabled: true, now: 100 },
      );
    }
    await expect(
      recorder.deletePersistentOrigin("https://a.example"),
    ).resolves.toBe(1);
    expect(await recorder.persistentEvents()).toHaveLength(1);
    await expect(recorder.deleteAllPersistent()).resolves.toBe(1);
  });
});
