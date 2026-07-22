import type {
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

const SENSITIVE_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "apikey",
  "xapikey",
  "xgoogapikey",
  "cookie",
  "setcookie",
  "headers",
  "request",
  "rawrequest",
  "rawresponse",
  "requestbody",
  "responsebody",
  "rawchunk",
  "rawvalue",
  "credential",
  "credentials",
  "secret",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "bearertoken",
]);

function sensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    SENSITIVE_KEYS.has(normalized) ||
    /^(?:api|access|refresh|id|bearer)?token(?:value|header)?$/u.test(
      normalized,
    ) ||
    /^(?:authorization|apikey|credential|secret)(?:value|header)?$/u.test(
      normalized,
    )
  );
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[redacted]")
    .replace(/(api[_ -]?key\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/([?&](?:key|token|access_token)=)[^&#\s]+/gi, "$1[redacted]");
}

function sanitizeValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (depth > 32) return "[metadata depth limit]";
  if (typeof value === "string") return redactSensitiveText(value);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (
    value instanceof Date ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer
  ) {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message),
    };
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular metadata removed]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => sanitizeValue(item, depth + 1, seen));
    seen.delete(value);
    return result;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (
      sensitiveKey(key) ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      continue;
    }
    sanitized[key] = sanitizeValue(descriptor.value, depth + 1, seen);
  }
  seen.delete(value);
  return sanitized;
}

export function scrubProviderOutput(value: unknown): unknown {
  return sanitizeValue(value);
}

/**
 * Removes raw HTTP request/response material before provider results cross into
 * page code, while preserving the standard AI SDK result shape and continuity
 * metadata needed by multi-step model calls.
 */
export function sanitizeGenerateResult(
  result: LanguageModelV4GenerateResult,
): LanguageModelV4GenerateResult {
  const response = result.response;
  return {
    content: sanitizeValue(
      result.content,
    ) as LanguageModelV4GenerateResult["content"],
    finishReason: result.finishReason,
    usage: sanitizeValue(
      result.usage,
    ) as LanguageModelV4GenerateResult["usage"],
    warnings: sanitizeValue(
      result.warnings,
    ) as LanguageModelV4GenerateResult["warnings"],
    ...(result.providerMetadata === undefined
      ? {}
      : {
          providerMetadata: sanitizeValue(
            result.providerMetadata,
          ) as NonNullable<LanguageModelV4GenerateResult["providerMetadata"]>,
        }),
    ...(response === undefined
      ? {}
      : {
          response: {
            ...(response.id === undefined
              ? {}
              : { id: redactSensitiveText(response.id) }),
            ...(response.timestamp === undefined
              ? {}
              : { timestamp: response.timestamp }),
            ...(response.modelId === undefined
              ? {}
              : { modelId: redactSensitiveText(response.modelId) }),
          },
        }),
  };
}

/** Returns undefined for raw provider chunks, which AgentProvider never exposes. */
export function sanitizeStreamPart(
  part: LanguageModelV4StreamPart,
): LanguageModelV4StreamPart | undefined {
  if (part.type === "raw") return undefined;
  if (part.type === "error") {
    const message =
      part.error instanceof Error ? part.error.message : String(part.error);
    return { type: "error", error: redactSensitiveText(message) };
  }
  if (part.type === "response-metadata") {
    return {
      type: "response-metadata",
      ...(part.id === undefined ? {} : { id: redactSensitiveText(part.id) }),
      ...(part.timestamp === undefined ? {} : { timestamp: part.timestamp }),
      ...(part.modelId === undefined
        ? {}
        : { modelId: redactSensitiveText(part.modelId) }),
    };
  }
  return sanitizeValue(part) as LanguageModelV4StreamPart;
}
