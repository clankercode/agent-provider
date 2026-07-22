import type {
  FlexibleSchema,
  InferSchema,
  LanguageModel,
  ModelMessage,
  ToolExecutionOptions,
} from "ai";
import type {
  BridgeCapabilities,
  AgentProviderBridge,
} from "@agent-provider/ai-sdk";
import type { ContextFrame, PageContext } from "@agent-provider/context";

export type ToolRisk = "read" | "write" | "destructive";

export type ToolConfirmationRule<Input> =
  | "always"
  | ((input: Input) => boolean | string | PromiseLike<boolean | string>);

export interface AgentProviderToolExecutionContext {
  toolCallId: string;
  runId: string;
  idempotencyKey: string;
  risk: ToolRisk;
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
}

export interface AgentProviderToolDefinition<
  Input = unknown,
  Output = unknown,
> {
  description: string;
  inputSchema: FlexibleSchema<Input>;
  outputSchema?: FlexibleSchema<Output>;
  execute: (
    input: Input,
    context: AgentProviderToolExecutionContext,
  ) => Output | PromiseLike<Output>;
  risk: ToolRisk;
  confirmation?: ToolConfirmationRule<Input>;
  /** Optional concise label used by the default approval UI. */
  approvalLabel?: string | ((input: Input) => string);
  /**
   * Mirror this tool into document.modelContext when WebMCP is available.
   * Read tools default to true. Write/destructive tools require explicit true.
   */
  webMcp?: boolean;
}

export type AgentProviderToolDefinitions = Record<
  string,
  AgentProviderToolDefinition<any, any>
>;

export type AgentProviderToolSchemaMap = Record<string, FlexibleSchema<any>>;

/**
 * A tool-definition map whose callback input types are inferred from each
 * sibling inputSchema. This powers contextual typing in instantChatbot() and
 * defineAgentProviderTools().
 */
export type AgentProviderToolDefinitionsFromSchemas<
  Schemas extends AgentProviderToolSchemaMap,
> = {
  [Name in keyof Schemas]: Omit<
    AgentProviderToolDefinition<InferSchema<Schemas[Name]>, any>,
    "inputSchema"
  > & {
    inputSchema: Schemas[Name];
  };
};

export interface AgentProviderMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  status: "complete" | "streaming" | "error";
  createdAt: number;
}

export interface ToolActivity {
  id: string;
  toolCallId: string;
  toolName: string;
  phase: "awaiting-approval" | "running" | "succeeded" | "denied" | "failed";
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface ApprovalRequest {
  id: string;
  toolCallId: string;
  toolName: string;
  label: string;
  risk: ToolRisk;
  input: unknown;
  requestedAt: number;
}

export type RuntimeConnectionState =
  "idle" | "connecting" | "ready" | "unavailable" | "error";

export type RuntimeRunState = "idle" | "submitting" | "streaming" | "error";

export type RuntimeOutcomeCode =
  | "completed"
  | "permission-denied"
  | "policy-denied"
  | "provider-failure"
  | "timeout"
  | "cancelled"
  | "bridge-lost"
  | "invalid-tool-input"
  | "outcome-unknown";

export type AgentProviderOutcome<T = void> =
  | { ok: true; code: "completed"; value: T }
  | {
      ok: false;
      code: Exclude<RuntimeOutcomeCode, "completed">;
      message: string;
      retryable: boolean;
    };

export interface RunHandle {
  id: string;
  cancel(): void;
  readonly result: Promise<AgentProviderOutcome>;
}

export interface AgentProviderRuntimeState {
  connection: RuntimeConnectionState;
  runState: RuntimeRunState;
  capabilities: BridgeCapabilities | undefined;
  messages: AgentProviderMessage[];
  toolActivity: ToolActivity[];
  approvals: ApprovalRequest[];
  error: string | undefined;
  activeRunId: string | undefined;
  contextRevision: number | undefined;
}

export type ContextRefreshPolicy = "manual" | "before-user-turn";

export interface AgentProviderRuntimeOptions {
  model?: LanguageModel;
  bridge?: AgentProviderBridge;
  modelAlias?: string;
  appName?: string;
  instructions?: string;
  tools?: AgentProviderToolDefinitions;
  suggestions?: string[];
  maxSteps?: number;
  maxApprovalWaitMs?: number;
  initialMessages?: Array<Pick<AgentProviderMessage, "role" | "text">>;
  autoConnect?: boolean;
  /** Optional bounded page-context source. The runtime never reads the DOM directly. */
  context?: PageContext;
  /** Capture once during construction and make that frame available to the model. */
  initialContext?: "none" | "snapshot";
  /** Refresh the immutable frame before each user turn, or only when requested. */
  contextRefresh?: ContextRefreshPolicy;
}

export interface RuntimeContextSnapshot {
  readonly frame: ContextFrame | undefined;
  readonly refreshPolicy: ContextRefreshPolicy;
}

export interface ToolWrapperContext {
  approvals: {
    request: (
      request: Omit<ApprovalRequest, "id" | "requestedAt">,
      signal?: AbortSignal,
    ) => Promise<boolean>;
  };
  onActivity: (activity: ToolActivity) => void;
  getRunId: () => string;
}

export type AnyToolExecutionOptions = ToolExecutionOptions<unknown>;
