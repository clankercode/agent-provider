export const AGENT_PROVIDER_CHANNEL = "agent-provider.bridge" as const;
export const AGENT_PROVIDER_BOOTSTRAP_VERSION = 0 as const;
export const AGENT_PROVIDER_PROTOCOL_VERSION = 1 as const;
export const AGENT_PROVIDER_PROTOCOL_MIN = 1 as const;
export const AGENT_PROVIDER_PROTOCOL_MAX = 1 as const;
export const AGENT_PROVIDER_PORT_NAME = "agent-provider.bridge.v1" as const;
export const AGENT_PROVIDER_INTERNAL_MARKER =
  "agent-provider.extension.internal.v1" as const;

export const AGENT_PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export type BridgeDirection = "page-to-extension" | "extension-to-page";

export type PermissionState =
  "granted-session" | "granted-persistent" | "prompt" | "denied";

export type PermissionDecision = "grant-session" | "grant-persistent" | "deny";

export type ExecutionMode = "standard" | "audit-first";
export type GrantScope = "tab" | "session" | "origin";
export type ToolRisk = "read" | "write" | "destructive";
export type OperationState =
  | "queued"
  | "dispatched"
  | "cancel-requested"
  | "cancelled"
  | "completed"
  | "failed"
  | "outcome-unknown";

export interface BootstrapHello {
  channel: typeof AGENT_PROVIDER_CHANNEL;
  bootstrap: typeof AGENT_PROVIDER_BOOTSTRAP_VERSION;
  type: "hello";
  direction: "page-to-extension";
  clientId: string;
  supported: { min: number; max: number };
}

export interface BootstrapReady {
  channel: typeof AGENT_PROVIDER_CHANNEL;
  bootstrap: typeof AGENT_PROVIDER_BOOTSTRAP_VERSION;
  type: "ready";
  direction: "extension-to-page";
  clientId: string;
  sessionId: string;
  selectedVersion: number;
  capabilities: BridgeCapabilities;
}

export interface BootstrapReject {
  channel: typeof AGENT_PROVIDER_CHANNEL;
  bootstrap: typeof AGENT_PROVIDER_BOOTSTRAP_VERSION;
  type: "reject";
  direction: "extension-to-page";
  clientId: string;
  code: "NO_VERSION_OVERLAP" | "INVALID_BOOTSTRAP";
}

export type BootstrapMessage =
  BootstrapHello | BootstrapReady | BootstrapReject;

export interface BridgeLimits {
  maxRequestBytes: number;
  maxOutputTokens: number;
  maxConcurrentRequests: number;
  maxTools: number;
  requestTimeoutMs: number;
}

export interface BridgeCapabilities {
  protocolVersion: number;
  extensionVersion: string;
  origin: string;
  permission: PermissionState;
  providerConfigured: boolean;
  aliases: string[];
  limits: BridgeLimits;
}

export interface BridgeEnvelope<
  TType extends string = string,
  TPayload = unknown,
> {
  channel: typeof AGENT_PROVIDER_CHANNEL;
  version: number;
  direction: BridgeDirection;
  clientId: string;
  sessionId?: string;
  requestId?: string;
  runId?: string;
  toolCallId?: string;
  type: TType;
  payload?: TPayload;
}

export interface SessionOpenPayload {
  sdkVersion: string;
  appName?: string;
}

export interface AccessRequestPayload {
  alias: string;
  reason?: string;
  requestedMode: ExecutionMode;
  private: boolean;
  scope: GrantScope;
}

export interface PermissionRequestPayload {
  reason?: string;
}

export interface ModelRequestPayload {
  alias: string;
  callOptions: WireValue;
}

export interface CancelRequestPayload {
  targetRequestId: string;
}

export type PageToExtensionMessage =
  | BridgeEnvelope<"session.open", SessionOpenPayload>
  | BridgeEnvelope<"permission.query">
  | BridgeEnvelope<"permission.request", PermissionRequestPayload>
  | BridgeEnvelope<"model.generate", ModelRequestPayload>
  | BridgeEnvelope<"model.stream", ModelRequestPayload>
  | BridgeEnvelope<"model.cancel", CancelRequestPayload>;

export type BridgeErrorCode =
  | "BRIDGE_UNAVAILABLE"
  | "VERSION_MISMATCH"
  | "PERMISSION_REQUIRED"
  | "PERMISSION_DENIED"
  | "PROVIDER_NOT_CONFIGURED"
  | "UNKNOWN_MODEL_ALIAS"
  | "POLICY_VIOLATION"
  | "RATE_LIMITED"
  | "REQUEST_TIMEOUT"
  | "REQUEST_CANCELLED"
  | "OUTCOME_UNKNOWN"
  | "PROVIDER_ERROR"
  | "INVALID_MESSAGE"
  | "INVALID_TOOL_INPUT"
  | "APPROVAL_DENIED"
  | "APPROVAL_EXPIRED"
  | "INTERNAL_ERROR";

export interface BridgeErrorPayload {
  code: BridgeErrorCode;
  message: string;
  retryable?: boolean;
  details?: WireValue;
}

export type ExtensionToPageMessage =
  | BridgeEnvelope<"session.ready", BridgeCapabilities>
  | BridgeEnvelope<"permission.result", BridgeCapabilities>
  | BridgeEnvelope<"model.result", WireValue>
  | BridgeEnvelope<"model.stream.part", WireValue>
  | BridgeEnvelope<"model.stream.end">
  | BridgeEnvelope<"bridge.error", BridgeErrorPayload>;

interface ApprovalBindingBase {
  approvalId: string;
  origin: string;
  tabId: number;
  clientId: string;
  sessionId: string;
  requestId: string;
  decision: "allow" | "deny";
  expiresAt: number;
}

export interface ProviderApprovalRecord extends ApprovalBindingBase {
  kind: "provider";
  mode: ExecutionMode;
  aliasFingerprint: string;
  dispatchPayloadHash: string;
}

export interface ToolApprovalRecord extends ApprovalBindingBase {
  kind: "tool";
  runId: string;
  toolCallId: string;
  toolName: string;
  risk: ToolRisk;
  declarationHash: string;
}

export type ApprovalRecord = ProviderApprovalRecord | ToolApprovalRecord;

export interface ToolExecutionReport {
  origin: string;
  clientId: string;
  sessionId: string;
  requestId: string;
  runId: string;
  toolCallId: string;
  state: OperationState;
  occurredAt: number;
}

export interface InternalPermissionPrompt {
  marker: typeof AGENT_PROVIDER_INTERNAL_MARKER;
  type: "permission.prompt";
  clientId: string;
  requestId: string;
  origin: string;
  reason?: string;
}

export interface InternalPermissionDecision {
  marker: typeof AGENT_PROVIDER_INTERNAL_MARKER;
  type: "permission.decision";
  clientId: string;
  requestId: string;
  decision: PermissionDecision;
}

export type InternalPortMessage =
  InternalPermissionPrompt | InternalPermissionDecision;

export type WirePrimitive = string | number | boolean | null;

export type WireTaggedValue =
  | { $agentProvider: "undefined" }
  | { $agentProvider: "bigint"; value: string }
  | { $agentProvider: "uint8"; base64: string }
  | { $agentProvider: "array-buffer"; base64: string }
  | { $agentProvider: "date"; value: string }
  | { $agentProvider: "object"; value: { [key: string]: WireValue } }
  | {
      $agentProvider: "error";
      name: string;
      message: string;
      stack?: string;
      cause?: WireValue;
    };

export type WireValue =
  WirePrimitive | WireTaggedValue | WireValue[] | { [key: string]: WireValue };
