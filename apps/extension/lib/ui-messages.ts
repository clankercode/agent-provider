import type {
  PermissionDecision,
  PermissionState,
} from "@agent-provider/protocol";

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
    };

export interface PopupStatus {
  origin: string;
  permission: PermissionState;
  providerConfigured: boolean;
  aliases: string[];
}

export interface PopupResponse {
  ok: boolean;
  status?: PopupStatus;
  error?: string;
}

export function isPopupRequest(value: unknown): value is PopupRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.marker !== AGENT_PROVIDER_UI_MARKER ||
    typeof record.tabId !== "number" ||
    typeof record.origin !== "string"
  ) {
    return false;
  }
  if (record.type === "status") return true;
  return (
    record.type === "permission.set" &&
    (record.decision === "grant-session" ||
      record.decision === "grant-persistent" ||
      record.decision === "deny" ||
      record.decision === "revoke")
  );
}
