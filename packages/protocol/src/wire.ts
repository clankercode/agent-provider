import type { WireTaggedValue, WireValue } from "./types.js";

const TAG = "$agentProvider";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function encodeWireValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): WireValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "AgentProvider wire values cannot contain NaN or Infinity.",
      );
    }
    return value;
  }

  if (typeof value === "undefined") {
    return { $agentProvider: "undefined" };
  }

  if (typeof value === "bigint") {
    return { $agentProvider: "bigint", value: value.toString(10) };
  }

  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(
      `AgentProvider cannot serialize ${typeof value} values.`,
    );
  }

  if (typeof value !== "object") {
    throw new TypeError("Unsupported AgentProvider wire value.");
  }

  if (seen.has(value)) {
    throw new TypeError("AgentProvider cannot serialize cyclic objects.");
  }
  seen.add(value);

  try {
    if (value instanceof Uint8Array) {
      return { $agentProvider: "uint8", base64: bytesToBase64(value) };
    }

    if (value instanceof ArrayBuffer) {
      return {
        $agentProvider: "array-buffer",
        base64: bytesToBase64(new Uint8Array(value)),
      };
    }

    if (value instanceof Date) {
      return { $agentProvider: "date", value: value.toISOString() };
    }

    if (value instanceof Error) {
      const encoded: WireTaggedValue = {
        $agentProvider: "error",
        name: value.name,
        message: value.message,
        ...(value.stack === undefined ? {} : { stack: value.stack }),
        ...("cause" in value && value.cause !== undefined
          ? { cause: encodeWireValue(value.cause, seen) }
          : {}),
      };
      return encoded;
    }

    if (Array.isArray(value)) {
      return value.map((item) => encodeWireValue(item, seen));
    }

    if (!isPlainObject(value)) {
      throw new TypeError(
        `AgentProvider only serializes plain objects; received ${value.constructor?.name ?? "unknown object"}.`,
      );
    }

    const encoded: Record<string, WireValue> = {};
    for (const [key, item] of Object.entries(value)) {
      encoded[key] = encodeWireValue(item, seen);
    }
    return Object.hasOwn(encoded, TAG)
      ? { $agentProvider: "object", value: encoded }
      : encoded;
  } finally {
    seen.delete(value);
  }
}

function createDecodedError(
  name: string,
  message: string,
  cause: unknown,
): Error {
  const options = cause === undefined ? undefined : { cause };
  switch (name) {
    case "TypeError":
      return new TypeError(message, options);
    case "RangeError":
      return new RangeError(message, options);
    case "ReferenceError":
      return new ReferenceError(message, options);
    case "SyntaxError":
      return new SyntaxError(message, options);
    case "URIError":
      return new URIError(message, options);
    case "EvalError":
      return new EvalError(message, options);
    default: {
      const error = new Error(message, options);
      error.name = name;
      return error;
    }
  }
}

function isTaggedValue(
  value: Record<string, WireValue>,
): value is WireTaggedValue {
  return typeof value[TAG] === "string";
}

export function decodeWireValue(value: WireValue): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(decodeWireValue);
  }

  if (isTaggedValue(value)) {
    switch (value.$agentProvider) {
      case "undefined":
        return undefined;
      case "bigint":
        return BigInt(value.value);
      case "uint8":
        return base64ToBytes(value.base64);
      case "array-buffer": {
        const bytes = base64ToBytes(value.base64);
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        );
      }
      case "date":
        return new Date(value.value);
      case "object": {
        const decoded: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value.value)) {
          decoded[key] = decodeWireValue(item);
        }
        return decoded;
      }
      case "error": {
        const error = createDecodedError(
          value.name,
          value.message,
          value.cause === undefined ? undefined : decodeWireValue(value.cause),
        );
        if (value.stack !== undefined) {
          error.stack = value.stack;
        }
        return error;
      }
    }
  }

  const decoded: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    decoded[key] = decodeWireValue(item);
  }
  return decoded;
}

export function estimateWireBytes(value: WireValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
