import {
  createBootstrapHello,
  createBootstrapReady,
  type BootstrapReady,
  type BootstrapReject,
  type ExtensionToPageMessage,
} from "@agent-provider/protocol";
import { describe, expect, it, vi } from "vitest";
import { WindowAgentProviderTransport } from "./transport.js";

function createReflectingWindow(): Window {
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  const target = {
    location: { origin: "https://app.example" },
    postMessage(data: unknown) {
      const event = {
        data,
        source: target,
      } as unknown as MessageEvent<unknown>;
      for (const listener of listeners) listener(event);
    },
    addEventListener(type: string, listener: EventListener) {
      if (type === "message") {
        listeners.add(listener as (event: MessageEvent<unknown>) => void);
      }
    },
    removeEventListener(type: string, listener: EventListener) {
      if (type === "message") {
        listeners.delete(listener as (event: MessageEvent<unknown>) => void);
      }
    },
  };
  return target as unknown as Window;
}

describe("WindowAgentProviderTransport", () => {
  it("does not deliver the page's reflected bootstrap hello to subscribers", () => {
    const target = createReflectingWindow();
    const transport = new WindowAgentProviderTransport(target);
    const listener =
      vi.fn<
        (
          message: ExtensionToPageMessage | BootstrapReady | BootstrapReject,
        ) => void
      >();
    const unsubscribe = transport.subscribe(listener);
    const hello = createBootstrapHello({ clientId: "client-test" });

    transport.post(hello);
    expect(listener).not.toHaveBeenCalled();

    const ready = createBootstrapReady({
      hello,
      sessionId: "session-test",
      selectedVersion: 1,
      capabilities: {
        protocolVersion: 1,
        extensionVersion: "test",
        origin: "https://app.example",
        permission: "prompt",
        providerConfigured: false,
        aliases: ["default"],
        limits: {
          maxRequestBytes: 1_000,
          maxOutputTokens: 100,
          maxConcurrentRequests: 1,
          maxTools: 4,
          requestTimeoutMs: 1_000,
        },
      },
    });
    target.postMessage(ready, target.location.origin);
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
  });
});
