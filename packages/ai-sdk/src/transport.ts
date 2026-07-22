import {
  isBootstrapMessage,
  isBridgeEnvelopeForDirection,
  type BootstrapHello,
  type BootstrapReady,
  type BootstrapReject,
  type ExtensionToPageMessage,
  type PageToExtensionMessage,
} from "@agent-provider/protocol";

export interface AgentProviderBridgeTransport {
  post(message: PageToExtensionMessage | BootstrapHello): void;
  subscribe(
    listener: (
      message: ExtensionToPageMessage | BootstrapReady | BootstrapReject,
    ) => void,
  ): () => void;
}

export class WindowAgentProviderTransport implements AgentProviderBridgeTransport {
  private readonly targetWindow: Window;
  private readonly targetOrigin: string;

  constructor(targetWindow: Window = window) {
    this.targetWindow = targetWindow;
    this.targetOrigin =
      targetWindow.location.origin === "null"
        ? "*"
        : targetWindow.location.origin;
  }

  post(message: PageToExtensionMessage | BootstrapHello): void {
    this.targetWindow.postMessage(message, this.targetOrigin);
  }

  subscribe(
    listener: (
      message: ExtensionToPageMessage | BootstrapReady | BootstrapReject,
    ) => void,
  ): () => void {
    const handler = (event: MessageEvent<unknown>) => {
      const isExtensionBootstrap =
        isBootstrapMessage(event.data) &&
        event.data.direction === "extension-to-page";
      if (
        event.source !== this.targetWindow ||
        (!isBridgeEnvelopeForDirection(event.data, "extension-to-page") &&
          !isExtensionBootstrap)
      ) {
        return;
      }
      listener(
        event.data as ExtensionToPageMessage | BootstrapReady | BootstrapReject,
      );
    };

    this.targetWindow.addEventListener("message", handler);
    return () => this.targetWindow.removeEventListener("message", handler);
  }
}
