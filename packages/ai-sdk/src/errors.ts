import {
  decodeWireValue,
  type BridgeErrorPayload,
} from "@agent-provider/protocol";

export class AgentProviderBridgeError extends Error {
  readonly code: BridgeErrorPayload["code"];
  readonly retryable: boolean;
  readonly details: unknown;

  constructor(payload: BridgeErrorPayload) {
    super(payload.message);
    this.name = "AgentProviderBridgeError";
    this.code = payload.code;
    this.retryable = payload.retryable ?? false;
    this.details =
      payload.details === undefined
        ? undefined
        : decodeWireValue(payload.details);
  }
}

export function createAbortError(
  message = "The AgentProvider request was cancelled.",
) {
  return new DOMException(message, "AbortError");
}
