import { asSchema } from "ai";
import type { AgentProviderToolDefinitions } from "@agent-provider/runtime";

type WebMcpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  execute: (input: unknown) => unknown | PromiseLike<unknown>;
};

type WebMcpModelContext = {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ) => PromiseLike<void> | void;
};

export interface WebMcpMirrorOptions {
  document?: Document;
  exposedTo?: string[];
}

export interface WebMcpMirrorHandle {
  supported: boolean;
  registered: string[];
  dispose(): void;
}

/**
 * Progressively mirrors AgentProvider's page tools into the proposed WebMCP API.
 * AgentProvider remains usable when WebMCP is unavailable.
 */
export async function mirrorToolsToWebMcp(
  definitions: AgentProviderToolDefinitions,
  options: WebMcpMirrorOptions = {},
): Promise<WebMcpMirrorHandle> {
  const targetDocument = options.document ?? globalThis.document;
  const modelContext = (
    targetDocument as Document & { modelContext?: WebMcpModelContext }
  ).modelContext;
  const controller = new AbortController();
  const registered: string[] = [];

  if (modelContext === undefined) {
    return { supported: false, registered, dispose: () => controller.abort() };
  }

  try {
    for (const [name, definition] of Object.entries(definitions)) {
      const risk = definition.risk ?? "read";
      const enabled =
        definition.webMcp === true ||
        (definition.webMcp !== false && risk === "read");
      if (!enabled) continue;

      const schema = asSchema(definition.inputSchema);
      await modelContext.registerTool(
        {
          name,
          description: definition.description,
          inputSchema: schema.jsonSchema,
          execute: (input) =>
            definition.execute(input, {
              toolCallId: `webmcp:${name}`,
              runId: "webmcp",
              idempotencyKey: `webmcp:${name}:${crypto.randomUUID()}`,
              risk,
              messages: [],
              abortSignal: controller.signal,
            }),
        },
        {
          signal: controller.signal,
          ...(options.exposedTo === undefined
            ? {}
            : { exposedTo: options.exposedTo }),
        },
      );
      registered.push(name);
    }
  } catch (error) {
    controller.abort();
    throw error;
  }

  return {
    supported: true,
    registered,
    dispose: () => controller.abort(),
  };
}
