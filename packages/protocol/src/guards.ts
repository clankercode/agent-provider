import {
  AGENT_PROVIDER_CHANNEL,
  AGENT_PROVIDER_BOOTSTRAP_VERSION,
  AGENT_PROVIDER_ID_PATTERN,
  AGENT_PROVIDER_INTERNAL_MARKER,
  AGENT_PROVIDER_PROTOCOL_VERSION,
  type BootstrapHello,
  type BootstrapMessage,
  type BootstrapReady,
  type BridgeDirection,
  type BridgeEnvelope,
  type InternalPortMessage,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && AGENT_PROVIDER_ID_PATTERN.test(value);
}

function isProtocolVersion(value: unknown): value is number {
  return (
    Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65_535
  );
}

export function isBootstrapMessage(value: unknown): value is BootstrapMessage {
  if (
    !isRecord(value) ||
    value.channel !== AGENT_PROVIDER_CHANNEL ||
    value.bootstrap !== AGENT_PROVIDER_BOOTSTRAP_VERSION ||
    !isIdentifier(value.clientId)
  ) {
    return false;
  }

  if (value.type === "hello" && value.direction === "page-to-extension") {
    if (!isRecord(value.supported)) return false;
    const { min, max } = value.supported;
    return isProtocolVersion(min) && isProtocolVersion(max) && min <= max;
  }

  if (value.type === "ready" && value.direction === "extension-to-page") {
    return (
      isIdentifier(value.sessionId) &&
      isProtocolVersion(value.selectedVersion) &&
      isRecord(value.capabilities)
    );
  }

  return (
    value.type === "reject" &&
    value.direction === "extension-to-page" &&
    (value.code === "NO_VERSION_OVERLAP" || value.code === "INVALID_BOOTSTRAP")
  );
}

export function negotiateProtocolVersion(
  hello: BootstrapHello,
  supported: { min: number; max: number } = {
    min: AGENT_PROVIDER_PROTOCOL_VERSION,
    max: AGENT_PROVIDER_PROTOCOL_VERSION,
  },
): number | undefined {
  const min = Math.max(hello.supported.min, supported.min);
  const max = Math.min(hello.supported.max, supported.max);
  return min <= max ? max : undefined;
}

export function createBootstrapHello(input: {
  clientId: string;
  min?: number;
  max?: number;
}): BootstrapHello {
  return {
    channel: AGENT_PROVIDER_CHANNEL,
    bootstrap: AGENT_PROVIDER_BOOTSTRAP_VERSION,
    type: "hello",
    direction: "page-to-extension",
    clientId: input.clientId,
    supported: {
      min: input.min ?? AGENT_PROVIDER_PROTOCOL_VERSION,
      max: input.max ?? AGENT_PROVIDER_PROTOCOL_VERSION,
    },
  };
}

export function createBootstrapReady(input: {
  hello: BootstrapHello;
  sessionId: string;
  selectedVersion: number;
  capabilities: BootstrapReady["capabilities"];
}): BootstrapReady {
  return {
    channel: AGENT_PROVIDER_CHANNEL,
    bootstrap: AGENT_PROVIDER_BOOTSTRAP_VERSION,
    type: "ready",
    direction: "extension-to-page",
    clientId: input.hello.clientId,
    sessionId: input.sessionId,
    selectedVersion: input.selectedVersion,
    capabilities: input.capabilities,
  };
}

export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.channel === AGENT_PROVIDER_CHANNEL &&
    isProtocolVersion(value.version) &&
    (value.direction === "page-to-extension" ||
      value.direction === "extension-to-page") &&
    isIdentifier(value.clientId) &&
    typeof value.type === "string" &&
    value.type.length > 0 &&
    value.type.length <= 80 &&
    (value.sessionId === undefined || isIdentifier(value.sessionId)) &&
    (value.requestId === undefined || isIdentifier(value.requestId)) &&
    (value.runId === undefined || isIdentifier(value.runId)) &&
    (value.toolCallId === undefined || isIdentifier(value.toolCallId))
  );
}

export function isBridgeEnvelopeForDirection(
  value: unknown,
  direction: BridgeDirection,
): value is BridgeEnvelope {
  return isBridgeEnvelope(value) && value.direction === direction;
}

export function isInternalPortMessage(
  value: unknown,
): value is InternalPortMessage {
  if (!isRecord(value) || value.marker !== AGENT_PROVIDER_INTERNAL_MARKER) {
    return false;
  }

  if (
    value.type === "permission.prompt" &&
    typeof value.clientId === "string" &&
    typeof value.requestId === "string" &&
    typeof value.origin === "string"
  ) {
    return true;
  }

  return (
    value.type === "permission.decision" &&
    typeof value.clientId === "string" &&
    typeof value.requestId === "string" &&
    (value.decision === "grant-session" ||
      value.decision === "grant-persistent" ||
      value.decision === "deny")
  );
}

export function createBridgeEnvelope<
  TType extends string,
  TPayload = undefined,
>(input: {
  direction: BridgeDirection;
  clientId: string;
  sessionId?: string;
  type: TType;
  requestId?: string;
  runId?: string;
  toolCallId?: string;
  payload?: TPayload;
}): BridgeEnvelope<TType, TPayload> {
  return {
    channel: AGENT_PROVIDER_CHANNEL,
    version: AGENT_PROVIDER_PROTOCOL_VERSION,
    direction: input.direction,
    clientId: input.clientId,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    type: input.type,
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  };
}
