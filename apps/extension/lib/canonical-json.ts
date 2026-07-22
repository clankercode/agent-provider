export type JsonPrimitive = null | boolean | number | string;
export type CanonicalJsonValue =
  JsonPrimitive | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

export class CanonicalJsonError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

function serialize(value: unknown, seen: Set<object>, depth: number): string {
  if (depth > 64) {
    throw new CanonicalJsonError("Canonical JSON exceeds the depth limit.");
  }
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError("Canonical JSON numbers must be finite.");
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new CanonicalJsonError(
      "Canonical JSON accepts only JSON-compatible values.",
    );
  }

  if (seen.has(value)) {
    throw new CanonicalJsonError("Canonical JSON cannot contain cycles.");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => serialize(item, seen, depth + 1)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError("Canonical JSON objects must be plain.");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
      throw new CanonicalJsonError(
        "Canonical JSON cannot contain symbol keys.",
      );
    }
    const keys = Object.keys(descriptors).sort();
    const fields: string[] = [];
    for (const key of keys) {
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor)) {
        throw new CanonicalJsonError(
          "Canonical JSON cannot contain accessors.",
        );
      }
      if (!descriptor.enumerable) continue;
      fields.push(
        `${JSON.stringify(key)}:${serialize(descriptor.value, seen, depth + 1)}`,
      );
    }
    return `{${fields.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

/** Stable safe JSON used for authority fingerprints and approval bindings. */
export function canonicalJson(value: CanonicalJsonValue | unknown): string {
  return serialize(value, new Set(), 0);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function fingerprintCanonicalJson(
  value: CanonicalJsonValue | unknown,
): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
