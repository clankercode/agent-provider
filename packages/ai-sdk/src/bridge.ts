import type {
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import {
  createBootstrapHello,
  createBridgeEnvelope,
  decodeWireValue,
  encodeWireValue,
  type BridgeCapabilities,
  type BridgeErrorPayload,
  type BootstrapReady,
  type BootstrapReject,
  type ExtensionToPageMessage,
  type ModelRequestPayload,
  type PageToExtensionMessage,
  type PermissionRequestPayload,
  type ToolApprovalRequestPayload,
  type ToolApprovalResultPayload,
  type ToolExecutionReportPayload,
  type WireValue,
} from "@agent-provider/protocol";
import { createAbortError, AgentProviderBridgeError } from "./errors.js";
import { sanitizeLanguageModelCallOptions } from "./sanitize.js";
import {
  WindowAgentProviderTransport,
  type AgentProviderBridgeTransport,
} from "./transport.js";

const SDK_VERSION = "0.1.0";

interface PendingSingle {
  kind: "single";
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
}

interface PendingStream {
  kind: "stream";
  controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
}

type PendingRequest = PendingSingle | PendingStream;

interface PendingBootstrap {
  resolve: (value: BridgeCapabilities) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface AgentProviderBridgeOptions {
  transport?: AgentProviderBridgeTransport;
  clientId?: string;
  appName?: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

function createId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export class AgentProviderBridge {
  readonly clientId: string;

  private readonly transport: AgentProviderBridgeTransport;
  private readonly appName: string | undefined;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly unsubscribe: () => void;
  private readonly pending = new Map<string, PendingRequest>();
  private capabilities: BridgeCapabilities | undefined;
  private sessionId: string | undefined;
  private pendingBootstrap: PendingBootstrap | undefined;
  private connectPromise: Promise<BridgeCapabilities> | undefined;
  private disposed = false;

  constructor(options: AgentProviderBridgeOptions = {}) {
    this.clientId = options.clientId ?? createId("client");
    this.transport = options.transport ?? new WindowAgentProviderTransport();
    this.appName = options.appName;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 3_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 90_000;
    this.unsubscribe = this.transport.subscribe((message) =>
      this.handleMessage(message),
    );
  }

  get snapshot(): BridgeCapabilities | undefined {
    return this.capabilities;
  }

  async connect(): Promise<BridgeCapabilities> {
    this.assertUsable();
    if (this.capabilities !== undefined) {
      return this.capabilities;
    }
    if (this.connectPromise !== undefined) {
      return this.connectPromise;
    }

    this.connectPromise = this.bootstrap()
      .then(() =>
        this.sendSingle<BridgeCapabilities>(
          "session.open",
          {
            sdkVersion: SDK_VERSION,
            ...(this.appName === undefined ? {} : { appName: this.appName }),
          },
          undefined,
          this.connectTimeoutMs,
        ),
      )
      .finally(() => {
        this.connectPromise = undefined;
      });

    return this.connectPromise;
  }

  private bootstrap(): Promise<BridgeCapabilities> {
    if (this.capabilities !== undefined && this.sessionId !== undefined) {
      return Promise.resolve(this.capabilities);
    }

    return new Promise<BridgeCapabilities>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingBootstrap = undefined;
        reject(
          new AgentProviderBridgeError({
            code: "BRIDGE_UNAVAILABLE",
            message:
              "The Agent Provider extension bridge did not answer. Install or enable it for this origin.",
            retryable: true,
          }),
        );
      }, this.connectTimeoutMs);
      this.pendingBootstrap = { resolve, reject, timer };
      this.transport.post(createBootstrapHello({ clientId: this.clientId }));
    });
  }

  async refreshPermission(): Promise<BridgeCapabilities> {
    await this.connect();
    return this.sendSingle<BridgeCapabilities>("permission.query");
  }

  async requestPermission(
    payload: PermissionRequestPayload = {},
  ): Promise<BridgeCapabilities> {
    await this.connect();
    return this.sendSingle<BridgeCapabilities>("permission.request", payload);
  }

  async generate(
    alias: string,
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4GenerateResult> {
    await this.connect();
    const payload: ModelRequestPayload = {
      alias,
      callOptions: encodeWireValue(sanitizeLanguageModelCallOptions(options)),
    };

    return this.sendSingle<LanguageModelV4GenerateResult>(
      "model.generate",
      payload,
      options.abortSignal,
    );
  }

  async stream(
    alias: string,
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4StreamResult> {
    await this.connect();
    this.assertUsable();

    if (options.abortSignal?.aborted === true) {
      throw createAbortError();
    }

    const requestId = createId("request");
    const payload: ModelRequestPayload = {
      alias,
      callOptions: encodeWireValue(sanitizeLanguageModelCallOptions(options)),
    };

    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      start: (controller) => {
        const timer = setTimeout(() => {
          this.cancelRequest(
            requestId,
            "AgentProvider model stream timed out.",
          );
        }, this.requestTimeoutMs);

        const pending: PendingStream = { kind: "stream", controller, timer };
        if (options.abortSignal !== undefined) {
          const onAbort = () => this.cancelRequest(requestId);
          options.abortSignal.addEventListener("abort", onAbort, {
            once: true,
          });
          pending.removeAbortListener = () =>
            options.abortSignal?.removeEventListener("abort", onAbort);
        }
        this.pending.set(requestId, pending);

        this.post(
          createBridgeEnvelope({
            direction: "page-to-extension",
            clientId: this.clientId,
            sessionId: this.requireSessionId(),
            requestId,
            type: "model.stream",
            payload,
          }) as PageToExtensionMessage,
        );
      },
      cancel: () => this.cancelRequest(requestId),
    });

    return { stream };
  }

  async requestToolApproval(
    payload: ToolApprovalRequestPayload,
    abortSignal?: AbortSignal,
  ): Promise<ToolApprovalResultPayload> {
    await this.connect();
    return this.sendSingle<ToolApprovalResultPayload>(
      "tool.approval.request",
      payload,
      abortSignal,
    );
  }

  reportToolExecution(payload: ToolExecutionReportPayload): void {
    if (this.disposed || this.sessionId === undefined) return;
    this.post(
      createBridgeEnvelope({
        direction: "page-to-extension",
        clientId: this.clientId,
        sessionId: this.sessionId,
        type: "tool.execution.report",
        runId: payload.runId,
        toolCallId: payload.toolCallId,
        payload,
      }) as PageToExtensionMessage,
    );
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribe();
    const error = new Error("The AgentProvider bridge was disposed.");
    if (this.pendingBootstrap !== undefined) {
      clearTimeout(this.pendingBootstrap.timer);
      this.pendingBootstrap.reject(error);
      this.pendingBootstrap = undefined;
    }
    for (const [requestId, pending] of this.pending) {
      this.clearPending(requestId, pending);
      if (pending.kind === "single") {
        pending.reject(error);
      } else {
        pending.controller.error(error);
      }
    }
  }

  private sendSingle<T>(
    type:
      | "session.open"
      | "permission.query"
      | "permission.request"
      | "model.generate"
      | "tool.approval.request",
    payload?: unknown,
    abortSignal?: AbortSignal,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    this.assertUsable();
    if (abortSignal?.aborted === true) {
      return Promise.reject(createAbortError());
    }

    const requestId = createId("request");

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(requestId);
        if (pending === undefined || pending.kind !== "single") {
          return;
        }
        this.clearPending(requestId, pending);
        if (type === "session.open") {
          reject(
            new AgentProviderBridgeError({
              code: "BRIDGE_UNAVAILABLE",
              message:
                "The AgentProvider extension bridge did not answer. Install/enable the extension for this origin.",
              retryable: true,
            }),
          );
        } else {
          this.postCancel(requestId);
          reject(
            new AgentProviderBridgeError({
              code: "REQUEST_TIMEOUT",
              message: "The AgentProvider request timed out.",
              retryable: true,
            }),
          );
        }
      }, timeoutMs);

      const pending: PendingSingle = {
        kind: "single",
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      };

      if (abortSignal !== undefined) {
        const onAbort = () => {
          const current = this.pending.get(requestId);
          if (current === undefined || current.kind !== "single") {
            return;
          }
          this.clearPending(requestId, current);
          this.postCancel(requestId);
          reject(createAbortError());
        };
        abortSignal.addEventListener("abort", onAbort, { once: true });
        pending.removeAbortListener = () =>
          abortSignal.removeEventListener("abort", onAbort);
      }

      this.pending.set(requestId, pending);
      this.post(
        createBridgeEnvelope({
          direction: "page-to-extension",
          clientId: this.clientId,
          sessionId: this.requireSessionId(),
          requestId,
          type,
          ...(payload === undefined ? {} : { payload }),
        }) as PageToExtensionMessage,
      );
    });
  }

  private handleMessage(
    message: ExtensionToPageMessage | BootstrapReady | BootstrapReject,
  ): void {
    if (message.clientId !== this.clientId) {
      return;
    }

    if ("bootstrap" in message) {
      const pending = this.pendingBootstrap;
      if (pending === undefined) return;
      clearTimeout(pending.timer);
      this.pendingBootstrap = undefined;
      if (message.type === "reject") {
        pending.reject(
          new AgentProviderBridgeError({
            code: "VERSION_MISMATCH",
            message:
              "The page and extension have no compatible protocol version.",
          }),
        );
      } else {
        this.sessionId = message.sessionId;
        this.capabilities = message.capabilities;
        pending.resolve(message.capabilities);
      }
      return;
    }

    if (this.sessionId !== undefined && message.sessionId !== this.sessionId) {
      return;
    }

    if (
      (message.type === "session.ready" ||
        message.type === "permission.result") &&
      message.payload !== undefined
    ) {
      this.capabilities = message.payload as BridgeCapabilities;
    }

    const requestId = message.requestId;
    if (requestId === undefined) {
      if (message.type === "bridge.error") {
        const error = new AgentProviderBridgeError(
          message.payload as BridgeErrorPayload,
        );
        for (const [pendingId, pending] of this.pending) {
          this.clearPending(pendingId, pending);
          if (pending.kind === "single") pending.reject(error);
          else pending.controller.error(error);
        }
        this.capabilities = undefined;
      }
      return;
    }
    const pending = this.pending.get(requestId);
    if (pending === undefined) {
      return;
    }

    if (message.type === "bridge.error") {
      const error = new AgentProviderBridgeError(
        message.payload as BridgeErrorPayload,
      );
      this.clearPending(requestId, pending);
      if (pending.kind === "single") {
        pending.reject(error);
      } else {
        pending.controller.error(error);
      }
      return;
    }

    if (pending.kind === "single") {
      if (
        message.type === "session.ready" ||
        message.type === "permission.result"
      ) {
        this.clearPending(requestId, pending);
        pending.resolve(message.payload);
      } else if (message.type === "model.result") {
        this.clearPending(requestId, pending);
        pending.resolve(decodeWireValue(message.payload as WireValue));
      } else if (message.type === "tool.approval.result") {
        this.clearPending(requestId, pending);
        pending.resolve(message.payload);
      }
      return;
    }

    if (message.type === "model.stream.part") {
      pending.controller.enqueue(
        decodeWireValue(
          message.payload as WireValue,
        ) as LanguageModelV4StreamPart,
      );
    } else if (message.type === "model.stream.end") {
      this.clearPending(requestId, pending);
      pending.controller.close();
    }
  }

  private cancelRequest(requestId: string, message?: string): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) {
      return;
    }
    this.clearPending(requestId, pending);
    this.postCancel(requestId);
    const error = createAbortError(message);
    if (pending.kind === "single") {
      pending.reject(error);
    } else {
      pending.controller.error(error);
    }
  }

  private postCancel(targetRequestId: string): void {
    if (this.disposed) {
      return;
    }
    this.post(
      createBridgeEnvelope({
        direction: "page-to-extension",
        clientId: this.clientId,
        sessionId: this.requireSessionId(),
        type: "model.cancel",
        payload: { targetRequestId },
      }) as PageToExtensionMessage,
    );
  }

  private post(message: PageToExtensionMessage): void {
    try {
      this.transport.post(message);
    } catch (error) {
      const requestId = message.requestId;
      if (requestId === undefined) {
        throw error;
      }
      const pending = this.pending.get(requestId);
      if (pending === undefined) {
        throw error;
      }
      this.clearPending(requestId, pending);
      if (pending.kind === "single") {
        pending.reject(error);
      } else {
        pending.controller.error(error);
      }
    }
  }

  private clearPending(requestId: string, pending: PendingRequest): void {
    clearTimeout(pending.timer);
    pending.removeAbortListener?.();
    this.pending.delete(requestId);
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("The AgentProvider bridge has been disposed.");
    }
  }

  private requireSessionId(): string {
    if (this.sessionId === undefined) {
      throw new AgentProviderBridgeError({
        code: "BRIDGE_UNAVAILABLE",
        message: "The Agent Provider bridge session is not established.",
      });
    }
    return this.sessionId;
  }
}
