import { describe, expect, it } from "vitest";
import {
  AGENT_PROVIDER_CHANNEL,
  AGENT_PROVIDER_PROTOCOL_VERSION,
} from "./types.js";
import { isBridgeEnvelope } from "./guards.js";

describe("bridge envelope guards", () => {
  it("rejects empty and oversized page-controlled identifiers", () => {
    const base = {
      channel: AGENT_PROVIDER_CHANNEL,
      version: AGENT_PROVIDER_PROTOCOL_VERSION,
      direction: "page-to-extension",
      type: "session.open",
    } as const;

    expect(isBridgeEnvelope({ ...base, clientId: "client-1" })).toBe(true);
    expect(isBridgeEnvelope({ ...base, clientId: "" })).toBe(false);
    expect(isBridgeEnvelope({ ...base, clientId: "x".repeat(161) })).toBe(
      false,
    );
    expect(
      isBridgeEnvelope({
        ...base,
        clientId: "client-1",
        requestId: "x".repeat(161),
      }),
    ).toBe(false);
  });
});
