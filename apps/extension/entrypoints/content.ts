import { browser } from "wxt/browser";
import {
  AGENT_PROVIDER_PORT_NAME,
  createBridgeEnvelope,
  isBootstrapMessage,
  isBridgeEnvelopeForDirection,
  type BootstrapMessage,
  type ExtensionToPageMessage,
} from "@agent-provider/protocol";
import { AGENT_PROVIDER_PAGE_MATCHES } from "../agent-provider.config.js";

function pageTargetOrigin(): string {
  return window.location.origin === "null" ? "*" : window.location.origin;
}

export default defineContentScript({
  matches: [...AGENT_PROVIDER_PAGE_MATCHES],
  runAt: "document_start",
  main() {
    const port = browser.runtime.connect({ name: AGENT_PROVIDER_PORT_NAME });
    const sessions = new Map<string, string>();

    const pageListener = (event: MessageEvent<unknown>) => {
      if (event.source !== window) return;
      const value = event.data;
      const pageMessage =
        (isBootstrapMessage(value) &&
          value.type === "hello" &&
          value.direction === "page-to-extension") ||
        isBridgeEnvelopeForDirection(value, "page-to-extension");
      if (!pageMessage) return;

      try {
        port.postMessage(value);
      } catch {
        // The page-side bridge times out safely while the worker restarts.
      }
    };

    window.addEventListener("message", pageListener);

    port.onMessage.addListener((value: unknown) => {
      if (isBootstrapMessage(value)) {
        if (value.direction !== "extension-to-page") return;
        if (value.type === "ready")
          sessions.set(value.clientId, value.sessionId);
        window.postMessage(value as BootstrapMessage, pageTargetOrigin());
        return;
      }

      if (!isBridgeEnvelopeForDirection(value, "extension-to-page")) return;
      window.postMessage(value as ExtensionToPageMessage, pageTargetOrigin());
    });

    port.onDisconnect.addListener(() => {
      window.removeEventListener("message", pageListener);
      for (const [clientId, sessionId] of sessions) {
        const message = createBridgeEnvelope({
          direction: "extension-to-page",
          clientId,
          sessionId,
          type: "bridge.error",
          payload: {
            code: "BRIDGE_UNAVAILABLE",
            message: "The Agent Provider extension connection closed.",
            retryable: true,
          },
        }) as ExtensionToPageMessage;
        window.postMessage(message, pageTargetOrigin());
      }
    });
  },
});
