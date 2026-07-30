import type {
  PermissionDecision,
  PermissionState,
  ToolRisk,
  WireValue,
} from "@agent-provider/protocol";
import type { AuditEvent } from "./audit.js";
import type { BaseExecutionMode } from "./policy-resolution.js";

export const AGENT_PROVIDER_UI_MARKER =
  "agent-provider.extension.ui.v1" as const;

export type PopupRequest =
  | {
      marker: typeof AGENT_PROVIDER_UI_MARKER;
      type: "status";
      tabId: number;
      origin: string;
    }
  | {
      marker: typeof AGENT_PROVIDER_UI_MARKER;
      type: "permission.set";
      tabId: number;
      origin: string;
      decision: PermissionDecision | "revoke";
    }
  | {
      marker: typeof AGENT_PROVIDER_UI_MARKER;
      type: "session.set";
      tabId: number;
      origin: string;
      mode: BaseExecutionMode;
      privateMode: boolean;
    }
  | {
      marker: typeof AGENT_PROVIDER_UI_MARKER;
      type: "audit.set";
      tabId: number;
      origin: string;
      persistentEnabled: boolean;
    }
  | {
      marker: typeof AGENT_PROVIDER_UI_MARKER;
      type: "origin.set";
      tabId: number;
      origin: string;
      enabled: boolean;
    }
  | {
      marker: typeof AGENT_PROVIDER_UI_MARKER;
      type: "approval.get";
      approvalId: string;
    }
  | {
      marker: typeof AGENT_PROVIDER_UI_MARKER;
      type: "approval.decide";
      approvalId: string;
      decision: "approved" | "denied";
      grantedLimit?: number;
    }
  | {
      marker: typeof AGENT_PROVIDER_UI_MARKER;
      type: "pending.list";
    }
  | {
      marker: typeof AGENT_PROVIDER_UI_MARKER;
      type: "pending.open";
      /** For permission requests: tabId+origin. For approvals: approvalId. */
      kind: "permission" | "approval";
      tabId?: number;
      origin?: string;
      approvalId?: string;
    }
  | {
      marker: typeof AGENT_PROVIDER_UI_MARKER;
      type: "audit.query";
      origin?: string;
    }
  | {
      marker: typeof AGENT_PROVIDER_UI_MARKER;
      type: "audit.delete";
      origin?: string;
    };

export interface PopupStatus {
  origin: string;
  bridgeEnabled: boolean;
  permission: PermissionState;
  providerConfigured: boolean;
  aliases: string[];
  execution: {
    mode: BaseExecutionMode;
    privateMode: boolean;
  };
  audit: {
    persistentEnabled: boolean;
    persistentError: boolean;
    sessionEvents: number;
    persistentEvents: number;
  };
}

export interface ProviderApprovalPrompt {
  id: string;
  kind: "provider";
  origin: string;
  alias: string;
  mode: "audit-first";
  requestBytes: number;
  expiresAt: number;
}

export interface ToolApprovalPrompt {
  id: string;
  kind: "tool";
  origin: string;
  toolName: string;
  risk: ToolRisk;
  input: WireValue;
  expiresAt: number;
}

export interface ToolLimitApprovalPrompt {
  id: string;
  kind: "tool-limit";
  origin: string;
  requestedTools: number;
  currentLimit: number;
  expiresAt: number;
}

export type ApprovalPrompt =
  ProviderApprovalPrompt | ToolApprovalPrompt | ToolLimitApprovalPrompt;

/** In-flight page access or step approval, for settings UI + automation. */
export interface PendingRequestView {
  kind: "permission" | "provider" | "tool" | "tool-limit";
  /** Stable id: `permission:${tabId}:${origin}` or approval id. */
  id: string;
  tabId?: number;
  origin: string;
  reason?: string;
  summary: string;
  createdAt: number;
  expiresAt: number;
  /** Deep-link to the dedicated approval window. */
  openUrl: string;
  /** Present for provider/tool/tool-limit step approvals. */
  approvalId?: string;
  alias?: string;
  toolName?: string;
  risk?: ToolRisk;
  requestedTools?: number;
  currentLimit?: number;
}

export interface AuditView {
  session: AuditEvent[];
  persistent: AuditEvent[];
  persistentError: boolean;
}

export interface PopupResponse {
  ok: boolean;
  status?: PopupStatus;
  approval?: ApprovalPrompt;
  pending?: PendingRequestView[];
  audit?: AuditView;
  deleted?: number;
  error?: string;
}

export function isPopupRequest(value: unknown): value is PopupRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.marker !== AGENT_PROVIDER_UI_MARKER) {
    return false;
  }
  if (record.type === "approval.get") {
    return typeof record.approvalId === "string";
  }
  if (record.type === "approval.decide") {
    return (
      typeof record.approvalId === "string" &&
      (record.decision === "approved" || record.decision === "denied") &&
      (record.grantedLimit === undefined ||
        (typeof record.grantedLimit === "number" &&
          Number.isFinite(record.grantedLimit) &&
          record.grantedLimit >= 0))
    );
  }
  if (record.type === "pending.list") {
    return true;
  }
  if (record.type === "pending.open") {
    if (record.kind === "approval") {
      return typeof record.approvalId === "string";
    }
    if (record.kind === "permission") {
      return (
        typeof record.tabId === "number" && typeof record.origin === "string"
      );
    }
    return false;
  }
  if (record.type === "audit.query" || record.type === "audit.delete") {
    return record.origin === undefined || typeof record.origin === "string";
  }
  if (typeof record.tabId !== "number" || typeof record.origin !== "string") {
    return false;
  }
  if (record.type === "status") return true;
  if (record.type === "session.set") {
    return (
      (record.mode === "standard" || record.mode === "audit-first") &&
      typeof record.privateMode === "boolean"
    );
  }
  if (record.type === "audit.set") {
    return typeof record.persistentEnabled === "boolean";
  }
  if (record.type === "origin.set") {
    return typeof record.enabled === "boolean";
  }
  return (
    record.type === "permission.set" &&
    (record.decision === "grant-session" ||
      record.decision === "grant-persistent" ||
      record.decision === "deny" ||
      record.decision === "revoke")
  );
}
