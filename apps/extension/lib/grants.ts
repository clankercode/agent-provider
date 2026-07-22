import type { BaseExecutionMode } from "./policy-resolution.js";

export type GrantScope =
  | { kind: "persistent" }
  | { kind: "session"; tabId: number; clientId: string; sessionId: string };

export interface AuthorityGrant {
  readonly id: string;
  readonly origin: string;
  readonly aliasFingerprints: Readonly<Record<string, string>>;
  /** Least-strict mode consented to: audit-first never permits standard. */
  readonly baseMode: BaseExecutionMode;
  readonly scope: GrantScope;
  readonly grantedAt: number;
  readonly expiresAt: number;
}

export interface GrantRequest {
  origin: string;
  alias: string;
  aliasFingerprint: string;
  baseMode: BaseExecutionMode;
  tabId: number;
  clientId: string;
  sessionId: string;
  now?: number;
}

export type GrantDenialReason =
  "expired" | "origin" | "alias" | "fingerprint" | "mode" | "scope";

function exactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      (url.protocol === "https:" || url.protocol === "http:")
    );
  } catch {
    return false;
  }
}

export function createAuthorityGrant(
  input: Omit<AuthorityGrant, "id"> & { id?: string },
): AuthorityGrant {
  if (!exactOrigin(input.origin))
    throw new TypeError("Grant origin is invalid.");
  if (
    !Number.isFinite(input.grantedAt) ||
    !Number.isFinite(input.expiresAt) ||
    input.expiresAt <= input.grantedAt
  ) {
    throw new TypeError("Grant timestamps are invalid.");
  }
  const aliases = Object.entries(input.aliasFingerprints);
  if (
    aliases.length === 0 ||
    aliases.some(
      ([alias, fingerprint]) =>
        !/^[a-z][a-z0-9_-]{0,31}$/i.test(alias) ||
        !/^[a-f0-9]{64}$/i.test(fingerprint),
    )
  ) {
    throw new TypeError("Grant aliases or fingerprints are invalid.");
  }
  if (
    input.scope.kind === "session" &&
    (!Number.isInteger(input.scope.tabId) ||
      input.scope.tabId < 0 ||
      input.scope.clientId.length === 0 ||
      input.scope.sessionId.length === 0)
  ) {
    throw new TypeError("Session grant scope is invalid.");
  }
  return Object.freeze({
    ...input,
    id: input.id ?? crypto.randomUUID(),
    aliasFingerprints: Object.freeze({ ...input.aliasFingerprints }),
    scope: Object.freeze({ ...input.scope }),
  });
}

export function authorizeGrant(
  grant: AuthorityGrant,
  request: GrantRequest,
): { ok: true } | { ok: false; reason: GrantDenialReason } {
  if ((request.now ?? Date.now()) >= grant.expiresAt) {
    return { ok: false, reason: "expired" };
  }
  if (request.origin !== grant.origin) return { ok: false, reason: "origin" };
  const fingerprint = grant.aliasFingerprints[request.alias];
  if (fingerprint === undefined) return { ok: false, reason: "alias" };
  if (fingerprint !== request.aliasFingerprint) {
    return { ok: false, reason: "fingerprint" };
  }
  if (grant.baseMode === "audit-first" && request.baseMode === "standard") {
    return { ok: false, reason: "mode" };
  }
  if (
    grant.scope.kind === "session" &&
    (request.tabId !== grant.scope.tabId ||
      request.clientId !== grant.scope.clientId ||
      request.sessionId !== grant.scope.sessionId)
  ) {
    return { ok: false, reason: "scope" };
  }
  return { ok: true };
}
