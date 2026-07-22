import type {
  LanguageModelV4CallOptions,
  LanguageModelV4FunctionTool,
} from "@ai-sdk/provider";
import type {
  ModelAliasSettings,
  AgentProviderExtensionSettings,
} from "./settings.js";

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function sanitizeTools(
  value: unknown,
  settings: AgentProviderExtensionSettings,
): LanguageModelV4FunctionTool[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new PolicyError("Tool definitions must be an array.");
  }
  if (value.length > settings.limits.maxTools) {
    throw new PolicyError(
      `This page requested ${value.length} tools; the configured limit is ${settings.limits.maxTools}.`,
    );
  }

  const names = new Set<string>();
  return value.map((candidate, index) => {
    if (
      !isRecord(candidate) ||
      candidate.type !== "function" ||
      typeof candidate.name !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(candidate.name) ||
      !isRecord(candidate.inputSchema)
    ) {
      throw new PolicyError(`Tool definition ${index + 1} is invalid.`);
    }
    if (names.has(candidate.name)) {
      throw new PolicyError(
        `Tool ${candidate.name} is declared more than once.`,
      );
    }
    names.add(candidate.name);
    let schemaBytes: number;
    try {
      schemaBytes = new TextEncoder().encode(
        JSON.stringify(candidate.inputSchema),
      ).byteLength;
    } catch {
      throw new PolicyError(`Tool ${candidate.name} has an invalid schema.`);
    }
    if (schemaBytes > 64_000) {
      throw new PolicyError(`Tool ${candidate.name} has an oversized schema.`);
    }

    return {
      type: "function",
      name: candidate.name,
      ...(typeof candidate.description === "string"
        ? { description: candidate.description.slice(0, 4_000) }
        : {}),
      inputSchema: candidate.inputSchema,
      ...(Array.isArray(candidate.inputExamples)
        ? { inputExamples: candidate.inputExamples.slice(0, 8) as never }
        : {}),
      ...(typeof candidate.strict === "boolean"
        ? { strict: candidate.strict }
        : {}),
    };
  });
}

function sanitizeResponseFormat(
  value: unknown,
): LanguageModelV4CallOptions["responseFormat"] | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "text") return { type: "text" };
  if (value.type !== "json") {
    throw new PolicyError("The requested response format is invalid.");
  }
  return {
    type: "json",
    ...(isRecord(value.schema)
      ? { schema: stripPageControlledProviderFields(value.schema) as never }
      : {}),
    ...(typeof value.name === "string"
      ? { name: value.name.slice(0, 128) }
      : {}),
    ...(typeof value.description === "string"
      ? { description: value.description.slice(0, 4_000) }
      : {}),
  };
}

function sanitizeToolChoice(
  value: unknown,
): LanguageModelV4CallOptions["toolChoice"] | undefined {
  if (value === undefined) return undefined;
  if (value === "auto" || value === "none" || value === "required") {
    return { type: value };
  }
  if (
    isRecord(value) &&
    (value.type === "auto" ||
      value.type === "none" ||
      value.type === "required")
  ) {
    return { type: value.type };
  }
  if (
    isRecord(value) &&
    value.type === "tool" &&
    typeof value.toolName === "string" &&
    /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value.toolName)
  ) {
    return { type: "tool", toolName: value.toolName };
  }
  throw new PolicyError("The requested tool choice is invalid.");
}

function stripPageControlledProviderFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripPageControlledProviderFields);
  }
  if (
    value === null ||
    typeof value !== "object" ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    value instanceof Date
  ) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "providerOptions" || key === "headers") continue;
    sanitized[key] = stripPageControlledProviderFields(item);
  }
  return sanitized;
}

function resolvedMaxOutputTokens(
  requested: unknown,
  alias: ModelAliasSettings,
  settings: AgentProviderExtensionSettings,
): number {
  const pageRequested = finiteNumber(requested) ?? alias.maxOutputTokens;
  return Math.max(
    1,
    Math.min(
      Math.floor(pageRequested),
      alias.maxOutputTokens,
      settings.limits.maxOutputTokens,
    ),
  );
}

export function enforceCallPolicy(
  value: unknown,
  alias: ModelAliasSettings,
  settings: AgentProviderExtensionSettings,
): LanguageModelV4CallOptions {
  if (!isRecord(value) || !Array.isArray(value.prompt)) {
    throw new PolicyError("The model request has an invalid prompt.");
  }

  const tools = sanitizeTools(value.tools, settings);
  const temperature = finiteNumber(value.temperature);
  const topP = finiteNumber(value.topP);
  const topK = finiteNumber(value.topK);
  const presencePenalty = finiteNumber(value.presencePenalty);
  const frequencyPenalty = finiteNumber(value.frequencyPenalty);
  const seed = finiteNumber(value.seed);
  const responseFormat = sanitizeResponseFormat(value.responseFormat);
  const toolChoice = sanitizeToolChoice(value.toolChoice);

  return {
    prompt: stripPageControlledProviderFields(
      value.prompt,
    ) as LanguageModelV4CallOptions["prompt"],
    maxOutputTokens: resolvedMaxOutputTokens(
      value.maxOutputTokens,
      alias,
      settings,
    ),
    ...(temperature === undefined
      ? {}
      : { temperature: Math.min(2, Math.max(0, temperature)) }),
    ...(Array.isArray(value.stopSequences)
      ? {
          stopSequences: value.stopSequences
            .filter((item): item is string => typeof item === "string")
            .slice(0, 8)
            .map((item) => item.slice(0, 500)),
        }
      : {}),
    ...(topP === undefined ? {} : { topP: Math.min(1, Math.max(0, topP)) }),
    ...(topK === undefined
      ? {}
      : { topK: Math.min(1_000, Math.max(1, Math.floor(topK))) }),
    ...(presencePenalty === undefined
      ? {}
      : { presencePenalty: Math.min(2, Math.max(-2, presencePenalty)) }),
    ...(frequencyPenalty === undefined
      ? {}
      : { frequencyPenalty: Math.min(2, Math.max(-2, frequencyPenalty)) }),
    ...(responseFormat === undefined ? {} : { responseFormat }),
    ...(seed === undefined ? {} : { seed: Math.floor(seed) }),
    ...(tools === undefined ? {} : { tools }),
    ...(toolChoice === undefined ? {} : { toolChoice }),
    includeRawChunks: false,
    ...(alias.reasoning === undefined ? {} : { reasoning: alias.reasoning }),
  };
}
