export type BaseExecutionMode = "standard" | "audit-first";

export interface AuthorityPolicy {
  maxRequestBytes: number;
  maxOutputTokens: number;
  maxConcurrentRequests: number;
  maxTools: number;
  requestTimeoutMs: number;
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerDay: number;
  costMicrosPerDay?: number;
  allowedAliases?: readonly string[];
  minimumMode: BaseExecutionMode;
  requireAudit: boolean;
  allowPersistentAudit: boolean;
  allowUnknownPricing: boolean;
}

export type AuthorityPolicyLayer = Partial<AuthorityPolicy>;

export const DEFAULT_AUTHORITY_POLICY: Readonly<AuthorityPolicy> =
  Object.freeze({
    maxRequestBytes: 512_000,
    maxOutputTokens: 8_192,
    maxConcurrentRequests: 2,
    maxTools: 32,
    requestTimeoutMs: 120_000,
    requestsPerMinute: 10,
    requestsPerDay: 200,
    tokensPerDay: 1_000_000,
    minimumMode: "standard",
    requireAudit: false,
    allowPersistentAudit: true,
    allowUnknownPricing: false,
  });

function restrictiveNumber(
  current: number,
  next: number | undefined,
  field: string,
): number {
  if (next === undefined) return current;
  if (!Number.isFinite(next) || next < 0) {
    throw new TypeError(`Policy field ${field} must be a non-negative number.`);
  }
  return Math.min(current, next);
}

function restrictiveOptionalNumber(
  current: number | undefined,
  next: number | undefined,
  field: string,
): number | undefined {
  if (next === undefined) return current;
  if (!Number.isFinite(next) || next < 0) {
    throw new TypeError(`Policy field ${field} must be a non-negative number.`);
  }
  return current === undefined ? next : Math.min(current, next);
}

function intersectAliases(
  current: readonly string[] | undefined,
  next: readonly string[] | undefined,
): readonly string[] | undefined {
  if (next === undefined) return current;
  const normalized = [...new Set(next)].sort();
  if (normalized.some((alias) => !/^[a-z][a-z0-9_-]{0,31}$/i.test(alias))) {
    throw new TypeError("Policy aliases contain an invalid identifier.");
  }
  return current === undefined
    ? normalized
    : current.filter((alias) => normalized.includes(alias));
}

/** Applies ordered policy layers while making every field monotonic-stricter. */
export function mergeTighteningPolicies(
  defaults: AuthorityPolicy,
  ...layers: readonly AuthorityPolicyLayer[]
): AuthorityPolicy {
  let effective: AuthorityPolicy = {
    ...defaults,
    ...(defaults.allowedAliases === undefined
      ? {}
      : { allowedAliases: [...defaults.allowedAliases].sort() }),
  };
  for (const layer of layers) {
    const costMicrosPerDay = restrictiveOptionalNumber(
      effective.costMicrosPerDay,
      layer.costMicrosPerDay,
      "costMicrosPerDay",
    );
    const allowedAliases = intersectAliases(
      effective.allowedAliases,
      layer.allowedAliases,
    );
    effective = {
      maxRequestBytes: restrictiveNumber(
        effective.maxRequestBytes,
        layer.maxRequestBytes,
        "maxRequestBytes",
      ),
      maxOutputTokens: restrictiveNumber(
        effective.maxOutputTokens,
        layer.maxOutputTokens,
        "maxOutputTokens",
      ),
      maxConcurrentRequests: restrictiveNumber(
        effective.maxConcurrentRequests,
        layer.maxConcurrentRequests,
        "maxConcurrentRequests",
      ),
      maxTools: restrictiveNumber(
        effective.maxTools,
        layer.maxTools,
        "maxTools",
      ),
      requestTimeoutMs: restrictiveNumber(
        effective.requestTimeoutMs,
        layer.requestTimeoutMs,
        "requestTimeoutMs",
      ),
      requestsPerMinute: restrictiveNumber(
        effective.requestsPerMinute,
        layer.requestsPerMinute,
        "requestsPerMinute",
      ),
      requestsPerDay: restrictiveNumber(
        effective.requestsPerDay,
        layer.requestsPerDay,
        "requestsPerDay",
      ),
      tokensPerDay: restrictiveNumber(
        effective.tokensPerDay,
        layer.tokensPerDay,
        "tokensPerDay",
      ),
      ...(costMicrosPerDay === undefined ? {} : { costMicrosPerDay }),
      ...(allowedAliases === undefined ? {} : { allowedAliases }),
      minimumMode:
        effective.minimumMode === "audit-first" ||
        layer.minimumMode === "audit-first"
          ? "audit-first"
          : "standard",
      requireAudit: effective.requireAudit || layer.requireAudit === true,
      allowPersistentAudit:
        effective.allowPersistentAudit && layer.allowPersistentAudit !== false,
      allowUnknownPricing:
        effective.allowUnknownPricing && layer.allowUnknownPricing !== false,
    };
  }
  return effective;
}
