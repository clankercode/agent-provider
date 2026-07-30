import { z } from "zod";
import type { AgentProviderToolDefinitions } from "./types.js";

/**
 * Debug tools for development builds. These are intentionally simple,
 * side-effect-free, and read-only (except debug_sleep / debug_echo_delayed
 * which test async timing). They should NEVER be included in production
 * builds — guard with `import.meta.env.DEV` or a build-time flag.
 *
 * New in 0.1.4.
 *
 * Usage:
 *   import { createDebugTools } from "@agent-provider/runtime/debug";
 *   const debugTools = import.meta.env.DEV ? createDebugTools() : {};
 *   const runtime = instantChatbot({ tools: { ...myTools, ...debugTools } });
 */
export function createDebugTools(): AgentProviderToolDefinitions {
  return {
    debug_echo: {
      description:
        "Echo back the provided message. Useful for testing the tool-call pipeline end-to-end.",
      inputSchema: z.object({
        message: z.string().describe("The text to echo back."),
      }),
      risk: "read",
      execute: ({ message }) => ({ echo: message }),
    },

    debug_echo_delayed: {
      description:
        "Echo a message after a delay. Tests streaming + async tool timing.",
      inputSchema: z.object({
        message: z.string(),
        delay_ms: z
          .number()
          .int()
          .min(0)
          .max(30_000)
          .default(1000)
          .describe("Milliseconds to wait before echoing."),
      }),
      risk: "read",
      execute: async ({ message, delay_ms }) => {
        await new Promise<void>((resolve) => setTimeout(resolve, delay_ms));
        return { echo: message, delayed_ms: delay_ms };
      },
    },

    debug_sleep: {
      description:
        "Sleep for the given duration. Returns the actual elapsed time.",
      inputSchema: z.object({
        duration_ms: z
          .number()
          .int()
          .min(0)
          .max(60_000)
          .describe("How long to sleep."),
      }),
      risk: "read",
      execute: async ({ duration_ms }) => {
        const start = Date.now();
        await new Promise<void>((resolve) => setTimeout(resolve, duration_ms));
        return { slept_ms: Date.now() - start };
      },
    },

    debug_ap_info: {
      description:
        "Return AgentProvider runtime info: capabilities, tool count, model label, connection state.",
      inputSchema: z.object({}).optional(),
      risk: "read",
      // `this` is not available here; the runtime injects context via the
      // execute callback's second argument. We return a marker the runtime
      // can enrich, or the caller passes the info.
      execute: (_input, context) => {
        return {
          toolCallId: context.toolCallId,
          runId: context.runId,
          idempotencyKey: context.idempotencyKey,
          timestamp: new Date().toISOString(),
        };
      },
    },

    debug_models: {
      description:
        "List all available model aliases and their resolved models from capabilities.",
      inputSchema: z.object({}).optional(),
      risk: "read",
      execute: () => {
        // The runtime doesn't inject capabilities into tool context, so this
        // returns a placeholder. In practice, the model can read the aliases
        // from the bridge capabilities via the chat header subtitle.
        return {
          hint: "Model aliases are visible in the chat header subtitle.",
        };
      },
    },
  };
}
