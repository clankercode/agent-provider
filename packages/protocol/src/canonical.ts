import type { WireValue } from "./types.js";
import { encodeWireValue } from "./wire.js";
import { sha256Hex } from "./sha256-pure.js";

function canonicalValue(value: WireValue): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical values must be finite");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  const record = value as Record<string, WireValue>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key]!)}`)
    .join(",")}}`;
}

/** Canonical JSON used for approval and alias fingerprints. */
export function canonicalize(value: unknown): string {
  return canonicalValue(encodeWireValue(value));
}

/**
 * Pure SHA-256 fallback for non-secure contexts where `crypto.subtle` is
 * unavailable (e.g. LAN HTTP origins, sandboxed iframes). Returns the same
 * 64 lowercase hex chars as Web Crypto so extension validators that check
 * `/^[a-f0-9]{64}$/` accept it.
 */
export async function sha256Canonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(value));
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined || typeof subtle.digest !== "function") {
    return sha256Hex(new TextDecoder().decode(bytes));
  }
  try {
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return sha256Hex(new TextDecoder().decode(bytes));
  }
}
