import type {
  PermissionDecision,
  PermissionState,
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
      type: "approval.get";
      approvalId: string;
    }
  | {
      marker: typeof AGENT_PROVIDER_UI_MARKER;
      type: "approval.decide";
      approvalId: string;
      decision: "approved" | "denied";
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

export interface AuditView {
  session: AuditEvent[];
  persistent: AuditEvent[];
  persistentError: boolean;
}

export interface PopupResponse {
  ok: boolean;
  status?: PopupStatus;
  approval?: ProviderApprovalPrompt;
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
      (record.decision === "approved" || record.decision === "denied")
    );
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
  return (
    record.type === "permission.set" &&
    (record.decision === "grant-session" ||
      record.decision === "grant-persistent" ||
      record.decision === "deny" ||
      record.decision === "revoke")
  );
}
