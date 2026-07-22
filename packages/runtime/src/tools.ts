import { tool, type ToolSet } from "ai";
import { encodeWireValue, estimateWireBytes } from "@agent-provider/protocol";
import { createAgentProviderId } from "./id.js";
import type {
  ApprovalRequest,
  AgentProviderToolDefinition,
  AgentProviderToolDefinitions,
  AgentProviderToolDefinitionsFromSchemas,
  AgentProviderToolSchemaMap,
  ToolActivity,
  ToolRisk,
  ToolWrapperContext,
} from "./types.js";

export function defineAgentProviderTools<
  const Schemas extends AgentProviderToolSchemaMap,
>(
  definitions: AgentProviderToolDefinitionsFromSchemas<Schemas>,
): AgentProviderToolDefinitionsFromSchemas<Schemas> {
  return definitions;
}

async function getApprovalLabel(
  name: string,
  definition: AgentProviderToolDefinition,
  input: unknown,
): Promise<string> {
  if (typeof definition.approvalLabel === "function") {
    return definition.approvalLabel(input);
  }
  return definition.approvalLabel ?? `Allow ${name} to run?`;
}

async function confirmationLabel(
  name: string,
  definition: AgentProviderToolDefinition,
  input: unknown,
): Promise<string | undefined> {
  const fallback = await getApprovalLabel(name, definition, input);
  const rule = definition.confirmation;
  if (rule === "always") return fallback;
  if (typeof rule === "function") {
    const result = await rule(input);
    if (result === false && definition.risk === "read") return undefined;
    return typeof result === "string" ? result : fallback;
  }
  return definition.risk === "read" ? undefined : fallback;
}

function emit(
  context: ToolWrapperContext,
  base: Omit<ToolActivity, "id" | "startedAt"> & {
    id?: string;
    startedAt?: number;
  },
): ToolActivity {
  const activity: ToolActivity = {
    id: base.id ?? createAgentProviderId("activity"),
    startedAt: base.startedAt ?? Date.now(),
    toolCallId: base.toolCallId,
    toolName: base.toolName,
    phase: base.phase,
    ...(base.input === undefined ? {} : { input: base.input }),
    ...(base.output === undefined ? {} : { output: base.output }),
    ...(base.error === undefined ? {} : { error: base.error }),
    ...(base.finishedAt === undefined ? {} : { finishedAt: base.finishedAt }),
  };
  context.onActivity(activity);
  return activity;
}

export function createToolSet(
  definitions: AgentProviderToolDefinitions,
  context: ToolWrapperContext,
): ToolSet {
  const entries = Object.entries(definitions).map(([name, definition]) => {
    const wrapped = tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
      ...(definition.outputSchema === undefined
        ? {}
        : { outputSchema: definition.outputSchema }),
      execute: async (input: unknown, options) => {
        const risk: ToolRisk = definition.risk;
        const startedAt = Date.now();
        const activityId = createAgentProviderId("activity");

        const approvalLabel = await confirmationLabel(name, definition, input);
        if (approvalLabel !== undefined) {
          emit(context, {
            id: activityId,
            startedAt,
            toolCallId: options.toolCallId,
            toolName: name,
            phase: "awaiting-approval",
            input,
          });

          const request: Omit<ApprovalRequest, "id" | "requestedAt"> = {
            toolCallId: options.toolCallId,
            toolName: name,
            label: approvalLabel,
            risk,
            input,
          };
          const approved = await context.approvals.request(
            request,
            options.abortSignal,
          );
          if (!approved) {
            emit(context, {
              id: activityId,
              startedAt,
              toolCallId: options.toolCallId,
              toolName: name,
              phase: "denied",
              input,
              output: { ok: false, denied: true },
              finishedAt: Date.now(),
            });
            return {
              ok: false,
              denied: true,
              message: `The user denied the ${name} tool call.`,
            };
          }
        }

        emit(context, {
          id: activityId,
          startedAt,
          toolCallId: options.toolCallId,
          toolName: name,
          phase: "running",
          input,
        });

        try {
          const runId = context.getRunId();
          const output = await definition.execute(input, {
            toolCallId: options.toolCallId,
            runId,
            idempotencyKey: `${runId}:${options.toolCallId}`,
            risk,
            messages: options.messages,
            ...(options.abortSignal === undefined
              ? {}
              : { abortSignal: options.abortSignal }),
          });
          const encoded = encodeWireValue(output);
          if (estimateWireBytes(encoded) > 262_144) {
            throw new Error("Tool output exceeds the 256 KiB runtime limit.");
          }
          emit(context, {
            id: activityId,
            startedAt,
            toolCallId: options.toolCallId,
            toolName: name,
            phase: "succeeded",
            input,
            output,
            finishedAt: Date.now(),
          });
          return output;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          emit(context, {
            id: activityId,
            startedAt,
            toolCallId: options.toolCallId,
            toolName: name,
            phase: "failed",
            input,
            error: message,
            finishedAt: Date.now(),
          });
          throw error;
        }
      },
    });

    return [name, wrapped] as const;
  });

  return Object.fromEntries(entries) as ToolSet;
}
