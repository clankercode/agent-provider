import type {
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import {
  createBridgeEnvelope,
  createBootstrapReady,
  encodeWireValue,
  type BridgeCapabilities,
  type ExtensionToPageMessage,
  type BootstrapHello,
  type BootstrapReady,
  type BootstrapReject,
  type PageToExtensionMessage,
} from "@agent-provider/protocol";
import { describe, expect, it } from "vitest";
import { AgentProviderBridge } from "./bridge.js";
import type { AgentProviderBridgeTransport } from "./transport.js";

class FakeTransport implements AgentProviderBridgeTransport {
  private listener:
    | ((
        message: ExtensionToPageMessage | BootstrapReady | BootstrapReject,
      ) => void)
    | undefined;

  post(message: PageToExtensionMessage | BootstrapHello): void {
    queueMicrotask(() => this.respond(message));
  }

  subscribe(
    listener: (
      message: ExtensionToPageMessage | BootstrapReady | BootstrapReject,
    ) => void,
  ): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  private respond(message: PageToExtensionMessage | BootstrapHello): void {
    if ("bootstrap" in message) {
      this.emit(
        createBootstrapReady({
          hello: message,
          sessionId: "session-test",
          selectedVersion: 1,
          capabilities: testCapabilities(),
        }),
      );
      return;
    }
    const requestId = message.requestId;
    if (requestId === undefined) {
      return;
    }

    if (message.type === "session.open") {
      const capabilities = testCapabilities();
      this.emit(
        createBridgeEnvelope({
          direction: "extension-to-page",
          clientId: message.clientId,
          sessionId: message.sessionId!,
          requestId,
          type: "session.ready",
          payload: capabilities,
        }) as ExtensionToPageMessage,
      );
      return;
    }

    if (message.type === "model.generate") {
      const result = {
        content: [{ type: "text", text: "hello" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      } as LanguageModelV4GenerateResult;
      this.emit(
        createBridgeEnvelope({
          direction: "extension-to-page",
          clientId: message.clientId,
          sessionId: message.sessionId!,
          requestId,
          type: "model.result",
          payload: encodeWireValue(result),
        }) as ExtensionToPageMessage,
      );
      return;
    }

    if (message.type === "model.stream") {
      const parts: LanguageModelV4StreamPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "hi" },
        { type: "text-end", id: "text-1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        },
      ];
      for (const part of parts) {
        this.emit(
          createBridgeEnvelope({
            direction: "extension-to-page",
            clientId: message.clientId,
            sessionId: message.sessionId!,
            requestId,
            type: "model.stream.part",
            payload: encodeWireValue(part),
          }) as ExtensionToPageMessage,
        );
      }
      this.emit(
        createBridgeEnvelope({
          direction: "extension-to-page",
          clientId: message.clientId,
          sessionId: message.sessionId!,
          requestId,
          type: "model.stream.end",
        }) as ExtensionToPageMessage,
      );
    }
  }

  private emit(
    message: ExtensionToPageMessage | BootstrapReady | BootstrapReject,
  ): void {
    this.listener?.(message);
  }
}

function testCapabilities(): BridgeCapabilities {
  return {
    protocolVersion: 1,
    extensionVersion: "test",
    origin: "https://internal.example",
    permission: "granted-session",
    providerConfigured: true,
    aliases: ["default"],
    limits: {
      maxRequestBytes: 100_000,
      maxOutputTokens: 2_000,
      maxConcurrentRequests: 2,
      maxTools: 16,
      requestTimeoutMs: 30_000,
    },
  };
}

describe("AgentProviderBridge", () => {
  it("connects and transports generate and stream calls", async () => {
    const bridge = new AgentProviderBridge({
      transport: new FakeTransport(),
      connectTimeoutMs: 100,
      requestTimeoutMs: 100,
    });

    const capabilities = await bridge.connect();
    expect(capabilities.providerConfigured).toBe(true);

    const generated = await bridge.generate("default", {
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
    expect(generated.content).toEqual([{ type: "text", text: "hello" }]);

    const streamed = await bridge.stream("default", {
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
    const received: LanguageModelV4StreamPart[] = [];
    for await (const part of streamed.stream) {
      received.push(part);
    }
    expect(received.some((part) => part.type === "text-delta")).toBe(true);

    bridge.dispose();
  });
});

class DisconnectingTransport implements AgentProviderBridgeTransport {
  private listener:
    | ((
        message: ExtensionToPageMessage | BootstrapReady | BootstrapReject,
      ) => void)
    | undefined;

  post(message: PageToExtensionMessage | BootstrapHello): void {
    queueMicrotask(() => {
      if ("bootstrap" in message) {
        this.listener?.(
          createBootstrapReady({
            hello: message,
            sessionId: "session-disconnect",
            selectedVersion: 1,
            capabilities: testCapabilities(),
          }),
        );
        return;
      }
      this.listener?.(
        createBridgeEnvelope({
          direction: "extension-to-page",
          clientId: message.clientId,
          sessionId: message.sessionId!,
          type: "bridge.error",
          payload: {
            code: "BRIDGE_UNAVAILABLE",
            message: "disconnected",
            retryable: true,
          },
        }) as ExtensionToPageMessage,
      );
    });
  }

  subscribe(
    listener: (
      message: ExtensionToPageMessage | BootstrapReady | BootstrapReject,
    ) => void,
  ): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }
}

describe("AgentProviderBridge disconnect handling", () => {
  it("rejects pending requests on a session-wide bridge error", async () => {
    const bridge = new AgentProviderBridge({
      transport: new DisconnectingTransport(),
      connectTimeoutMs: 5_000,
    });

    await expect(bridge.connect()).rejects.toMatchObject({
      code: "BRIDGE_UNAVAILABLE",
      message: "disconnected",
    });
    bridge.dispose();
  });
});
