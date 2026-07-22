import {
  ToolLoopAgent,
  isStepCount,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import {
  AgentProviderBridge,
  AgentProviderBridgeError,
  createAgentProviderProvider,
} from "@agent-provider/ai-sdk";
import type {
  ContextFrame,
  ContextFrameDiff,
  ContextRegion,
  ContextRegionMetadata,
  PageContext,
} from "@agent-provider/context";
import { ApprovalManager } from "./approval.js";
import { createAgentProviderId } from "./id.js";
import { createToolSet } from "./tools.js";
import type {
  AgentProviderOutcome,
  AgentProviderMessage,
  AgentProviderRuntimeOptions,
  AgentProviderRuntimeState,
  AgentProviderToolDefinitionsFromSchemas,
  AgentProviderToolSchemaMap,
  ToolActivity,
  RunHandle,
} from "./types.js";

type Listener = () => void;

function permissionGranted(permission: string | undefined): boolean {
  return (
    permission === "granted-session" || permission === "granted-persistent"
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof AgentProviderBridgeError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export class AgentProviderRuntime {
  readonly suggestions: readonly string[];
  readonly bridge: AgentProviderBridge | undefined;
  readonly context: PageContext | undefined;

  private readonly listeners = new Set<Listener>();
  private readonly model: LanguageModel;
  private readonly tools: ToolSet;
  private readonly approvalManager: ApprovalManager;
  private readonly agent: ToolLoopAgent<never, ToolSet>;
  private readonly toolDefinitions: NonNullable<
    AgentProviderRuntimeOptions["tools"]
  >;
  private modelMessages: ModelMessage[] = [];
  private activeAbortController: AbortController | undefined;
  private activeRunId: string | undefined;
  private contextFrame: ContextFrame | undefined;
  private readonly contextRefresh: "manual" | "before-user-turn";
  private destroyed = false;

  private state: AgentProviderRuntimeState;

  constructor(options: AgentProviderRuntimeOptions) {
    this.bridge = options.bridge;
    this.context = options.context;
    this.contextRefresh = options.contextRefresh ?? "manual";
    this.contextFrame =
      this.context !== undefined && options.initialContext === "snapshot"
        ? this.context.capture()
        : undefined;
    this.model =
      options.model ??
      createAgentProviderProvider(
        options.bridge === undefined ? {} : { bridge: options.bridge },
      )();
    this.suggestions = options.suggestions ?? [];
    this.toolDefinitions = options.tools ?? {};

    const initialMessages = (
      options.initialMessages ?? []
    ).map<AgentProviderMessage>((message) => ({
      id: createAgentProviderId("message"),
      role: message.role,
      text: message.text,
      status: "complete",
      createdAt: Date.now(),
    }));
    this.modelMessages = initialMessages.map((message) => ({
      role: message.role,
      content: message.text,
    })) as ModelMessage[];

    this.state = {
      connection: this.bridge === undefined ? "ready" : "idle",
      runState: "idle",
      capabilities: this.bridge?.snapshot,
      messages: initialMessages,
      toolActivity: [],
      approvals: [],
      error: undefined,
      activeRunId: undefined,
      contextRevision: this.contextFrame?.revision,
    };

    this.approvalManager = new ApprovalManager(
      options.maxApprovalWaitMs ?? 120_000,
      (approvals) => this.patchState({ approvals }),
    );
    this.tools = createToolSet(this.toolDefinitions, {
      approvals: this.approvalManager,
      onActivity: (activity) => this.recordActivity(activity),
      getRunId: () => this.activeRunId ?? "run-unavailable",
    });

    this.agent = new ToolLoopAgent({
      model: this.model,
      ...(options.instructions === undefined
        ? {}
        : { instructions: options.instructions }),
      tools: this.tools,
      stopWhen: isStepCount(options.maxSteps ?? 12),
    });

    if (options.autoConnect === true) {
      void this.connect();
    }
  }

  getSnapshot = (): AgentProviderRuntimeState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getContextFrame(): ContextFrame | undefined {
    return this.contextFrame;
  }

  refreshContext(): ContextFrame | undefined {
    this.assertUsable();
    this.contextFrame = this.context?.capture();
    this.patchState({ contextRevision: this.contextFrame?.revision });
    return this.contextFrame;
  }

  listContextRegions(): readonly ContextRegionMetadata[] {
    if (this.context === undefined) return [];
    const frame = this.contextFrame ?? this.refreshContext();
    return frame === undefined ? [] : this.context.listRegions(frame);
  }

  getContextRegion(name: string): ContextRegion | undefined {
    if (this.context === undefined) return undefined;
    const frame = this.contextFrame ?? this.refreshContext();
    return frame === undefined
      ? undefined
      : this.context.getRegion(name, frame);
  }

  diffContext(refresh = true): ContextFrameDiff | undefined {
    if (this.context === undefined || this.contextFrame === undefined) {
      return undefined;
    }
    const base = this.contextFrame;
    const next = refresh ? this.context.capture() : base;
    const diff = this.context.diff(base, next);
    if (refresh) {
      this.contextFrame = next;
      this.patchState({ contextRevision: next.revision });
    }
    return diff;
  }

  async connect(): Promise<void> {
    this.assertUsable();
    if (this.bridge === undefined) {
      this.patchState({ connection: "ready" });
      return;
    }

    this.patchState({ connection: "connecting", error: undefined });
    try {
      const capabilities = await this.bridge.connect();
      this.patchState({ connection: "ready", capabilities, error: undefined });
    } catch (error) {
      this.patchState({
        connection:
          error instanceof AgentProviderBridgeError &&
          error.code === "BRIDGE_UNAVAILABLE"
            ? "unavailable"
            : "error",
        error: toErrorMessage(error),
      });
      throw error;
    }
  }

  async requestPermission(reason?: string): Promise<void> {
    this.assertUsable();
    if (this.bridge === undefined) {
      return;
    }
    if (this.state.connection !== "ready") {
      await this.connect();
    }

    try {
      const capabilities = await this.bridge.requestPermission({
        ...(reason === undefined ? {} : { reason }),
      });
      this.patchState({ capabilities, error: undefined });
    } catch (error) {
      this.patchState({ error: toErrorMessage(error) });
      throw error;
    }
  }

  async refreshPermission(): Promise<void> {
    if (this.bridge === undefined) {
      return;
    }
    const capabilities = await this.bridge.refreshPermission();
    this.patchState({ capabilities });
  }

  send(text: string): Promise<AgentProviderOutcome> {
    return this.begin(text).result;
  }

  begin(text: string): RunHandle {
    this.assertUsable();
    if (this.activeRunId !== undefined) {
      throw new Error("An Agent Provider run is already in progress.");
    }
    const id = createAgentProviderId("run");
    this.activeRunId = id;
    this.patchState({ activeRunId: id });
    const result = this.sendInternal(text)
      .then<AgentProviderOutcome>(() => ({
        ok: true,
        code: "completed",
        value: undefined,
      }))
      .catch<AgentProviderOutcome>((error: unknown) =>
        this.outcomeForError(error),
      )
      .finally(() => {
        if (this.activeRunId === id) {
          this.activeRunId = undefined;
          this.patchState({ activeRunId: undefined });
        }
      });
    return {
      id,
      cancel: () => {
        if (this.activeRunId === id) this.cancel();
      },
      result,
    };
  }

  private async sendInternal(text: string): Promise<void> {
    this.assertUsable();
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    if (this.activeAbortController !== undefined) {
      throw new Error("A AgentProvider response is already in progress.");
    }

    await this.ensureReadyForModelCall();

    if (this.contextRefresh === "before-user-turn") {
      this.refreshContext();
    }

    const userMessage: AgentProviderMessage = {
      id: createAgentProviderId("message"),
      role: "user",
      text: trimmed,
      status: "complete",
      createdAt: Date.now(),
    };
    const assistantMessage: AgentProviderMessage = {
      id: createAgentProviderId("message"),
      role: "assistant",
      text: "",
      status: "streaming",
      createdAt: Date.now(),
    };

    const contextMessage: ModelMessage[] =
      this.contextFrame === undefined
        ? []
        : [
            {
              role: "system",
              content: `Current page context (revision ${this.contextFrame.revision}, captured ${new Date(this.contextFrame.capturedAt).toISOString()}):\n\n${this.contextFrame.content}`,
            },
          ];
    const callMessages: ModelMessage[] = [
      ...this.modelMessages,
      ...contextMessage,
      { role: "user", content: trimmed },
    ];
    const abortController = new AbortController();
    this.activeAbortController = abortController;
    this.patchState({
      runState: "submitting",
      error: undefined,
      messages: [...this.state.messages, userMessage, assistantMessage],
    });

    try {
      const result = await this.agent.stream({
        messages: callMessages,
        abortSignal: abortController.signal,
      });
      this.patchState({ runState: "streaming" });

      let textSoFar = "";
      for await (const delta of result.textStream) {
        textSoFar += delta;
        this.updateMessage(assistantMessage.id, {
          text: textSoFar,
          status: "streaming",
        });
      }

      const finalText = textSoFar || (await result.text);
      this.updateMessage(assistantMessage.id, {
        text: finalText || "Done.",
        status: "complete",
      });
      const responseMessages = await result.responseMessages;
      this.modelMessages = [
        ...callMessages,
        ...(responseMessages as ModelMessage[]),
      ];
      this.patchState({ runState: "idle" });
    } catch (error) {
      if (abortController.signal.aborted) {
        this.updateMessage(assistantMessage.id, {
          text: "Cancelled.",
          status: "error",
        });
        this.patchState({ runState: "idle", error: undefined });
      } else {
        const message = toErrorMessage(error);
        this.updateMessage(assistantMessage.id, {
          text: message,
          status: "error",
        });
        this.patchState({ runState: "error", error: message });
      }
      throw error;
    } finally {
      this.activeAbortController = undefined;
    }
  }

  cancel(): void {
    this.activeAbortController?.abort();
    this.approvalManager.cancelAll();
  }

  resolveApproval(id: string, approved: boolean): boolean {
    return this.approvalManager.resolve(id, approved);
  }

  clear(): void {
    this.cancel();
    this.modelMessages = [];
    this.patchState({
      runState: "idle",
      messages: [],
      toolActivity: [],
      approvals: [],
      error: undefined,
      activeRunId: undefined,
      contextRevision: this.contextFrame?.revision,
    });
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.cancel();
    this.bridge?.dispose();
    this.listeners.clear();
  }

  private async ensureReadyForModelCall(): Promise<void> {
    if (this.bridge === undefined) {
      return;
    }
    if (this.state.connection !== "ready") {
      await this.connect();
    }
    const capabilities = this.state.capabilities;
    if (!permissionGranted(capabilities?.permission)) {
      throw new AgentProviderBridgeError({
        code: "PERMISSION_REQUIRED",
        message: "This page has not been permitted to use AgentProvider.",
      });
    }
    if (capabilities?.providerConfigured !== true) {
      throw new AgentProviderBridgeError({
        code: "PROVIDER_NOT_CONFIGURED",
        message: "Configure an LLM provider in the AgentProvider extension.",
      });
    }
  }

  private updateMessage(
    id: string,
    patch: Pick<AgentProviderMessage, "text" | "status">,
  ): void {
    this.patchState({
      messages: this.state.messages.map((message) =>
        message.id === id ? { ...message, ...patch } : message,
      ),
    });
  }

  private recordActivity(activity: ToolActivity): void {
    const existing = this.state.toolActivity.findIndex(
      (candidate) => candidate.id === activity.id,
    );
    const next = [...this.state.toolActivity];
    if (existing === -1) {
      next.push(activity);
    } else {
      next[existing] = activity;
    }
    this.patchState({ toolActivity: next.slice(-50) });
  }

  private patchState(patch: Partial<AgentProviderRuntimeState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private assertUsable(): void {
    if (this.destroyed) {
      throw new Error("The AgentProvider runtime has been destroyed.");
    }
  }

  private outcomeForError(error: unknown): AgentProviderOutcome {
    const message = toErrorMessage(error);
    if (error instanceof AgentProviderBridgeError) {
      const code =
        error.code === "PERMISSION_REQUIRED" ||
        error.code === "PERMISSION_DENIED"
          ? "permission-denied"
          : error.code === "POLICY_VIOLATION" ||
              error.code === "RATE_LIMITED" ||
              error.code === "APPROVAL_DENIED" ||
              error.code === "APPROVAL_EXPIRED"
            ? "policy-denied"
            : error.code === "REQUEST_TIMEOUT"
              ? "timeout"
              : error.code === "REQUEST_CANCELLED"
                ? "cancelled"
                : error.code === "BRIDGE_UNAVAILABLE" ||
                    error.code === "VERSION_MISMATCH"
                  ? "bridge-lost"
                  : error.code === "INVALID_TOOL_INPUT"
                    ? "invalid-tool-input"
                    : error.code === "OUTCOME_UNKNOWN"
                      ? "outcome-unknown"
                      : "provider-failure";
      return { ok: false, code, message, retryable: error.retryable ?? false };
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, code: "cancelled", message, retryable: true };
    }
    return { ok: false, code: "provider-failure", message, retryable: false };
  }
}

export type InstantChatbotOptions<
  Schemas extends AgentProviderToolSchemaMap = AgentProviderToolSchemaMap,
> = Omit<AgentProviderRuntimeOptions, "tools"> & {
  modelAlias?: string;
  tools?: AgentProviderToolDefinitionsFromSchemas<Schemas>;
};

export function instantChatbot<
  const Schemas extends AgentProviderToolSchemaMap = Record<never, never>,
>(options: InstantChatbotOptions<Schemas> = {}): AgentProviderRuntime {
  const bridge =
    options.bridge ??
    new AgentProviderBridge(
      options.appName === undefined ? {} : { appName: options.appName },
    );
  const provider = createAgentProviderProvider({
    bridge,
    defaultAlias: options.modelAlias ?? "default",
  });

  return new AgentProviderRuntime({
    ...options,
    bridge,
    model: options.model ?? provider(options.modelAlias),
  });
}

export const createAgentRuntime = instantChatbot;
