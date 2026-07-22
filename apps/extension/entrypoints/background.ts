import { browser } from "wxt/browser";
import {
  AGENT_PROVIDER_PORT_NAME,
  createBootstrapReady,
  createBridgeEnvelope,
  decodeWireValue,
  encodeWireValue,
  estimateWireBytes,
  isBridgeEnvelopeForDirection,
  isBootstrapMessage,
  negotiateProtocolVersion,
  type BootstrapReady,
  type BootstrapReject,
  type BridgeCapabilities,
  type BridgeErrorPayload,
  type ExtensionToPageMessage,
  type ModelRequestPayload,
  type PermissionDecision,
  type PermissionState,
  type WireValue,
} from "@agent-provider/protocol";
import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import { isAllowedApplicationOrigin } from "../agent-provider.config.js";
import {
  AuditRecorder,
  IndexedDbPersistentAuditStore,
  type AuditEvent,
} from "../lib/audit.js";
import {
  createApprovalRecord,
  IndexedDbApprovalStore,
  type ProviderApprovalBinding,
} from "../lib/approvals.js";
import { fingerprintCanonicalJson } from "../lib/canonical-json.js";
import { PersistentQuotaManager } from "../lib/persistent-quotas.js";
import {
  getPermissionState,
  grantPersistentPermission,
  revokePersistentPermission,
} from "../lib/permissions.js";
import { enforceCallPolicy, PolicyError } from "../lib/policy.js";
import { runGenerate, runStream } from "../lib/provider-runner.js";
import {
  fingerprintProviderAlias,
  type ProviderAlias,
  type ProviderProfile,
} from "../lib/provider-profiles.js";
import { QuotaExceededError, type QuotaReservation } from "../lib/quotas.js";
import {
  redactSensitiveText,
  sanitizeGenerateResult,
  sanitizeStreamPart,
} from "../lib/result-policy.js";
import {
  loadSettings,
  lockStorageToExtensionContexts,
  type AgentProviderExtensionSettings,
} from "../lib/settings.js";
import {
  isPopupRequest,
  type ProviderApprovalPrompt,
  type PopupResponse,
  type PopupStatus,
} from "../lib/ui-messages.js";

class RequestFailure extends Error {
  constructor(
    readonly code: BridgeErrorPayload["code"],
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "RequestFailure";
  }
}

const sessionGrants = new Set<string>();
const sessionAliasFingerprints = new Map<string, Record<string, string>>();
const deniedUntil = new Map<string, number>();
const sessionExecution = new Map<
  string,
  { mode: "standard" | "audit-first"; privateMode: boolean }
>();
const AUTHORITY_FINGERPRINTS_KEY = "agent-provider.authority-fingerprints.v1";
const quotaManager = new PersistentQuotaManager();
const auditRecorder = new AuditRecorder(new IndexedDbPersistentAuditStore());
const approvalStore = new IndexedDbApprovalStore();
let persistentAuditError = false;
let quotaRecovery: Promise<void> | undefined;

interface PendingPermission {
  complete(decision: PermissionDecision): Promise<void>;
  dispose(): void;
}

const pendingPermissions = new Map<string, PendingPermission>();

interface PendingProviderApproval {
  prompt: ProviderApprovalPrompt;
  binding: ProviderApprovalBinding;
  complete(decision: "approved" | "denied"): Promise<void>;
}

const pendingProviderApprovals = new Map<string, PendingProviderApproval>();

function sessionKey(tabId: number, origin: string): string {
  return `${tabId}:${origin}`;
}

function executionFor(
  tabId: number,
  origin: string,
  settings: AgentProviderExtensionSettings,
): { mode: "standard" | "audit-first"; privateMode: boolean } {
  const key = sessionKey(tabId, origin);
  const current = sessionExecution.get(key);
  if (current !== undefined) return current;
  const initial = {
    mode: settings.execution.defaultMode,
    privateMode: settings.execution.privateByDefault,
  };
  sessionExecution.set(key, initial);
  return initial;
}

async function recordAudit(
  settings: AgentProviderExtensionSettings,
  execution: { privateMode: boolean },
  event: Omit<AuditEvent, "id" | "timestamp">,
): Promise<void> {
  const result = await auditRecorder.record(
    { ...event, timestamp: Date.now() },
    {
      privateMode: execution.privateMode,
      persistentEnabled: settings.audit.persistentEnabled,
      requirePersistentAudit: settings.audit.requirePersistent,
      retention: settings.audit.retention,
    },
  );
  if (settings.audit.persistentEnabled && !execution.privateMode) {
    persistentAuditError = result.persistentError;
  }
}

function usageTokens(
  usage: LanguageModelV4Usage | undefined,
  fallback: number,
): number {
  if (usage === undefined) return fallback;
  const input = usage.inputTokens.total;
  const output = usage.outputTokens.total;
  if (input === undefined && output === undefined) return fallback;
  return Math.max(0, input ?? 0) + Math.max(0, output ?? 0);
}

function ensureQuotaRecovery(): Promise<void> {
  quotaRecovery ??= (async () => {
    const settings = await loadSettings();
    const recovered = await quotaManager.recoverUnknownOutcomes(
      settings.quotas,
    );
    for (const reservation of recovered) {
      await recordAudit(
        settings,
        { privateMode: false },
        {
          type: "model-request",
          origin: reservation.scope,
          requestId: reservation.id,
          mode: settings.execution.defaultMode,
          status: "outcome-unknown",
          outputTokens: reservation.estimatedTokens,
          errorCode: "WORKER_RESTART",
        },
      );
    }
  })();
  return quotaRecovery;
}

async function requestProviderApproval(input: {
  binding: ProviderApprovalBinding;
  alias: string;
  requestBytes: number;
}): Promise<void> {
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + 120_000;
  const prompt: ProviderApprovalPrompt = {
    id,
    kind: "provider",
    origin: input.binding.origin,
    alias: input.alias,
    mode: "audit-first",
    requestBytes: input.requestBytes,
    expiresAt,
  };
  const recordId = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingProviderApprovals.delete(id);
      reject(
        new RequestFailure(
          "APPROVAL_EXPIRED",
          "The provider approval request expired.",
          true,
        ),
      );
    }, 120_000);
    pendingProviderApprovals.set(id, {
      prompt,
      binding: input.binding,
      complete: async (decision) => {
        clearTimeout(timer);
        pendingProviderApprovals.delete(id);
        const record = await createApprovalRecord({
          id,
          kind: "provider",
          binding: input.binding,
          decision,
          createdAt: Date.now(),
          expiresAt,
        });
        await approvalStore.put(record);
        resolve(record.id);
      },
    });
    void browser.windows
      .create({
        url: browser.runtime.getURL(`/approval.html?approvalId=${id}`),
        type: "popup",
        width: 760,
        height: 590,
        focused: true,
      })
      .catch(() => {
        clearTimeout(timer);
        pendingProviderApprovals.delete(id);
        reject(
          new RequestFailure(
            "BRIDGE_UNAVAILABLE",
            "The extension could not open its provider approval window.",
            true,
          ),
        );
      });
  });
  const consumed = await approvalStore.consume(
    recordId,
    "provider",
    input.binding,
  );
  if (!consumed.ok) {
    const expired = consumed.reason === "expired";
    throw new RequestFailure(
      expired ? "APPROVAL_EXPIRED" : "APPROVAL_DENIED",
      expired
        ? "The provider approval request expired."
        : "The provider request was denied in the extension.",
      expired,
    );
  }
}

async function aliasFingerprints(
  settings: AgentProviderExtensionSettings,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Object.entries(settings.aliases).map(async ([id, alias]) => {
      const profile: ProviderProfile =
        alias.profileId === undefined
          ? {
              id: "legacy-openai",
              family: "openai-compatible",
              endpoint: settings.provider.endpoint,
              apiKey: settings.provider.apiKey,
              ...(settings.provider.organization.length === 0
                ? {}
                : { organization: settings.provider.organization }),
              ...(settings.provider.project.length === 0
                ? {}
                : { project: settings.provider.project }),
            }
          : settings.profiles[alias.profileId]!;
      const providerAlias: ProviderAlias = {
        id,
        profileId: profile.id,
        modelId: alias.model,
        maxOutputTokens: alias.maxOutputTokens,
        ...(alias.reasoning === undefined
          ? {}
          : { reasoning: alias.reasoning }),
        ...(alias.authorityOptions === undefined
          ? {}
          : { authorityOptions: alias.authorityOptions }),
      };
      return [
        id,
        await fingerprintProviderAlias(profile, providerAlias),
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function persistentFingerprints(): Promise<
  Record<string, Record<string, string>>
> {
  const stored = await browser.storage.local.get(AUTHORITY_FINGERPRINTS_KEY);
  const value = stored[AUTHORITY_FINGERPRINTS_KEY];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Record<string, string>>)
    : {};
}

async function setPersistentFingerprints(
  origin: string,
  fingerprints: Record<string, string> | undefined,
): Promise<void> {
  const current = await persistentFingerprints();
  if (fingerprints === undefined) delete current[origin];
  else current[origin] = fingerprints;
  await browser.storage.local.set({ [AUTHORITY_FINGERPRINTS_KEY]: current });
}

async function aliasAuthorityMatches(
  tabId: number,
  origin: string,
  alias: string,
  settings: AgentProviderExtensionSettings,
): Promise<boolean> {
  const current = (await aliasFingerprints(settings))[alias];
  if (current === undefined) return false;
  const key = sessionKey(tabId, origin);
  const sessionFingerprint = sessionAliasFingerprints.get(key)?.[alias];
  if (sessionFingerprint !== undefined) return sessionFingerprint === current;
  const persistent = await persistentFingerprints();
  return persistent[origin]?.[alias] === current;
}

function parseHttpOrigin(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

async function permissionFor(
  tabId: number,
  origin: string,
): Promise<PermissionState> {
  const key = sessionKey(tabId, origin);
  if ((deniedUntil.get(key) ?? 0) > Date.now()) {
    return "denied";
  }
  if (sessionGrants.has(key) && sessionAliasFingerprints.has(key)) {
    return "granted-session";
  }
  const persistent = await getPermissionState(origin, false);
  if (persistent !== "granted-persistent") return persistent;
  const fingerprints = await persistentFingerprints();
  return fingerprints[origin] === undefined ? "prompt" : persistent;
}

async function capabilitiesFor(
  tabId: number,
  origin: string,
  settings?: AgentProviderExtensionSettings,
): Promise<BridgeCapabilities> {
  const current = settings ?? (await loadSettings());
  return {
    protocolVersion: 1,
    extensionVersion: browser.runtime.getManifest().version,
    origin,
    permission: await permissionFor(tabId, origin),
    providerConfigured:
      current.provider.apiKey.length > 0 ||
      Object.values(current.profiles).some(
        (profile) => profile.apiKey.length > 0,
      ),
    aliases: Object.keys(current.aliases).sort(),
    limits: current.limits,
  };
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message).slice(0, 1_500);
}

function toBridgeError(
  error: unknown,
  options: { timedOut?: boolean } = {},
): BridgeErrorPayload {
  if (options.timedOut === true) {
    return {
      code: "REQUEST_TIMEOUT",
      message: "The provider request exceeded the extension timeout.",
      retryable: true,
    };
  }
  if (error instanceof RequestFailure) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  if (error instanceof PolicyError) {
    return { code: "POLICY_VIOLATION", message: error.message };
  }
  if (error instanceof QuotaExceededError) {
    return {
      code: "RATE_LIMITED",
      message: `The configured ${error.dimension} quota is exhausted.`,
      retryable: true,
    };
  }
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return { code: "REQUEST_CANCELLED", message: "The request was cancelled." };
  }
  return {
    code: "PROVIDER_ERROR",
    message: safeErrorMessage(error),
    retryable: true,
  };
}

async function verifyTrustedTab(
  tabId: number,
  claimedOrigin: string,
): Promise<boolean> {
  try {
    const tab = await browser.tabs.get(tabId);
    return parseHttpOrigin(tab.url) === claimedOrigin;
  } catch {
    return false;
  }
}

export default defineBackground(() => {
  void lockStorageToExtensionContexts().catch(() => {
    // Older extension platforms may not expose storage access levels.
  });
  void ensureQuotaRecovery().catch(() => {
    // Requests await the same recovery and surface a safe bridge error.
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== AGENT_PROVIDER_PORT_NAME) return;

    const tabId = port.sender?.tab?.id;
    const origin = parseHttpOrigin(port.sender?.url ?? port.sender?.tab?.url);
    if (tabId === undefined || origin === undefined) {
      port.disconnect();
      return;
    }
    if (!isAllowedApplicationOrigin(origin)) {
      port.disconnect();
      return;
    }

    let activeCount = 0;
    const sessions = new Map<string, string>();
    const controllers = new Map<string, AbortController>();
    const ownedPendingKeys = new Set<string>();

    const post = (
      message: ExtensionToPageMessage | BootstrapReady | BootstrapReject,
    ) => {
      try {
        port.postMessage(message);
      } catch {
        // The tab may have navigated or closed.
      }
    };

    const postCapabilities = async (
      type: "session.ready" | "permission.result",
      clientId: string,
      requestId: string,
      overridePermission?: PermissionState,
    ) => {
      const sessionId = sessions.get(clientId);
      if (sessionId === undefined) return;
      const capabilities = await capabilitiesFor(tabId, origin);
      post(
        createBridgeEnvelope({
          direction: "extension-to-page",
          clientId,
          sessionId,
          requestId,
          type,
          payload:
            overridePermission === undefined
              ? capabilities
              : { ...capabilities, permission: overridePermission },
        }) as ExtensionToPageMessage,
      );
    };

    const postError = (
      clientId: string,
      requestId: string,
      error: BridgeErrorPayload,
    ) => {
      const sessionId = sessions.get(clientId);
      if (sessionId === undefined) return;
      post(
        createBridgeEnvelope({
          direction: "extension-to-page",
          clientId,
          sessionId,
          requestId,
          type: "bridge.error",
          payload: error,
        }) as ExtensionToPageMessage,
      );
    };

    const executeModelRequest = async (
      message: ReturnType<typeof createBridgeEnvelope>,
      mode: "generate" | "stream",
    ) => {
      const requestId = message.requestId;
      if (requestId === undefined) return;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let requestSettings: AgentProviderExtensionSettings | undefined;
      let requestExecution:
        { mode: "standard" | "audit-first"; privateMode: boolean } | undefined;
      let reservation: QuotaReservation | undefined;
      let dispatched = false;
      let reservedTokens = 0;
      let auditAlias: string | undefined;
      const startedAt = Date.now();
      const requestKey = `${message.clientId}:${requestId}`;

      try {
        await ensureQuotaRecovery();
        const permission = await permissionFor(tabId, origin);
        if (
          permission !== "granted-session" &&
          permission !== "granted-persistent"
        ) {
          throw new RequestFailure(
            "PERMISSION_REQUIRED",
            "This origin is not permitted to use AgentProvider.",
          );
        }

        const settings = await loadSettings();
        requestSettings = settings;
        const execution = executionFor(tabId, origin, settings);
        requestExecution = execution;
        if (activeCount >= settings.limits.maxConcurrentRequests) {
          throw new RequestFailure(
            "RATE_LIMITED",
            "This page has reached the configured concurrent request limit.",
            true,
          );
        }

        const payload = message.payload as ModelRequestPayload | undefined;
        if (
          payload === undefined ||
          typeof payload.alias !== "string" ||
          payload.callOptions === undefined
        ) {
          throw new RequestFailure(
            "INVALID_MESSAGE",
            "The model request payload is invalid.",
          );
        }
        const alias = settings.aliases[payload.alias];
        auditAlias = payload.alias;
        if (alias === undefined) {
          throw new RequestFailure(
            "UNKNOWN_MODEL_ALIAS",
            `The model alias “${payload.alias}” is not configured.`,
          );
        }
        if (
          !(await aliasAuthorityMatches(tabId, origin, payload.alias, settings))
        ) {
          throw new RequestFailure(
            "PERMISSION_REQUIRED",
            "The configured provider authority changed after this origin was granted access. Review the origin grant again.",
          );
        }
        const configuredKey =
          alias.profileId === undefined
            ? settings.provider.apiKey
            : settings.profiles[alias.profileId]?.apiKey;
        if (configuredKey === undefined || configuredKey.length === 0) {
          throw new RequestFailure(
            "PROVIDER_NOT_CONFIGURED",
            `No credential is configured for model alias “${payload.alias}”.`,
          );
        }
        const requestBytes = estimateWireBytes(payload.callOptions);
        if (requestBytes > settings.limits.maxRequestBytes) {
          throw new RequestFailure(
            "POLICY_VIOLATION",
            "The model request is larger than the configured byte limit.",
          );
        }

        const rawOptions = decodeWireValue(payload.callOptions);
        const safeOptions = enforceCallPolicy(rawOptions, alias, settings);
        reservedTokens =
          typeof safeOptions.maxOutputTokens === "number"
            ? safeOptions.maxOutputTokens
            : alias.maxOutputTokens;
        await recordAudit(settings, execution, {
          type: "model-request",
          origin,
          requestId,
          alias: payload.alias,
          mode: execution.mode,
          status: "queued",
          requestBytes,
        });
        reservation = await quotaManager.reserve(settings.quotas, {
          id: `${tabId}:${message.sessionId}:${requestKey}`,
          scope: origin,
          estimatedTokens: reservedTokens,
          pricingKnown: false,
        });
        if (execution.mode === "audit-first") {
          const aliasFingerprint = (await aliasFingerprints(settings))[
            payload.alias
          ];
          if (aliasFingerprint === undefined) {
            throw new RequestFailure(
              "UNKNOWN_MODEL_ALIAS",
              "The model alias disappeared before approval.",
            );
          }
          const binding: ProviderApprovalBinding = {
            origin,
            tabId,
            clientId: message.clientId,
            sessionId: message.sessionId!,
            requestId,
            mode: execution.mode,
            aliasFingerprint,
            dispatchPayloadHash: await fingerprintCanonicalJson({
              alias: payload.alias,
              callOptions: payload.callOptions,
            }),
          };
          await requestProviderApproval({
            binding,
            alias: payload.alias,
            requestBytes,
          });
        }
        const controller = new AbortController();
        controllers.set(requestKey, controller);
        activeCount += 1;
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, settings.limits.requestTimeoutMs);
        await recordAudit(settings, execution, {
          type: "model-request",
          origin,
          requestId,
          alias: payload.alias,
          mode: execution.mode,
          status: "dispatched",
          requestBytes,
        });
        dispatched = true;

        if (mode === "generate") {
          const result = await runGenerate(
            settings,
            alias,
            safeOptions,
            controller.signal,
          );
          await quotaManager.settle(settings.quotas, reservation.id, {
            tokens: usageTokens(result.usage, reservedTokens),
          });
          reservation = undefined;
          await recordAudit(settings, execution, {
            type: "model-request",
            origin,
            requestId,
            alias: payload.alias,
            mode: execution.mode,
            status: "completed",
            requestBytes,
            outputTokens: usageTokens(result.usage, reservedTokens),
            durationMs: Date.now() - startedAt,
          });
          post(
            createBridgeEnvelope({
              direction: "extension-to-page",
              clientId: message.clientId,
              sessionId: message.sessionId!,
              requestId,
              type: "model.result",
              payload: encodeWireValue(sanitizeGenerateResult(result)),
            }) as ExtensionToPageMessage,
          );
        } else {
          const result = await runStream(
            settings,
            alias,
            safeOptions,
            controller.signal,
          );
          let streamUsage: LanguageModelV4Usage | undefined;
          for await (const part of result.stream) {
            if (part.type === "finish") streamUsage = part.usage;
            const safePart = sanitizeStreamPart(part);
            if (safePart === undefined) continue;
            post(
              createBridgeEnvelope({
                direction: "extension-to-page",
                clientId: message.clientId,
                sessionId: message.sessionId!,
                requestId,
                type: "model.stream.part",
                payload: encodeWireValue(safePart),
              }) as ExtensionToPageMessage,
            );
          }
          const tokens = usageTokens(streamUsage, reservedTokens);
          await quotaManager.settle(settings.quotas, reservation.id, {
            tokens,
          });
          reservation = undefined;
          await recordAudit(settings, execution, {
            type: "model-request",
            origin,
            requestId,
            alias: payload.alias,
            mode: execution.mode,
            status: "completed",
            requestBytes,
            outputTokens: tokens,
            durationMs: Date.now() - startedAt,
          });
          post(
            createBridgeEnvelope({
              direction: "extension-to-page",
              clientId: message.clientId,
              sessionId: message.sessionId!,
              requestId,
              type: "model.stream.end",
            }) as ExtensionToPageMessage,
          );
        }
      } catch (error) {
        if (reservation !== undefined && requestSettings !== undefined) {
          try {
            if (dispatched) {
              await quotaManager.settle(
                requestSettings.quotas,
                reservation.id,
                { tokens: reservedTokens },
              );
            } else {
              await quotaManager.release(
                requestSettings.quotas,
                reservation.id,
              );
            }
            reservation = undefined;
          } catch {
            // A persisted reservation remains conservative outcome-unknown
            // state and will be reconciled on the next worker start.
          }
        }
        if (requestSettings !== undefined && requestExecution !== undefined) {
          try {
            const bridgeError = toBridgeError(error, { timedOut });
            await recordAudit(requestSettings, requestExecution, {
              type: "model-request",
              origin,
              requestId,
              ...(auditAlias === undefined ? {} : { alias: auditAlias }),
              mode: requestExecution.mode,
              status: dispatched ? "outcome-unknown" : "failed",
              errorCode: bridgeError.code,
              ...(dispatched ? { outputTokens: reservedTokens } : {}),
              durationMs: Date.now() - startedAt,
            });
          } catch {
            // The original request failure remains the user-facing result.
          }
        }
        postError(
          message.clientId,
          requestId,
          toBridgeError(error, { timedOut }),
        );
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (controllers.delete(requestKey)) {
          activeCount = Math.max(0, activeCount - 1);
        }
      }
    };

    port.onMessage.addListener((value: unknown) => {
      if (isBootstrapMessage(value)) {
        if (value.type !== "hello" || value.direction !== "page-to-extension")
          return;
        const selectedVersion = negotiateProtocolVersion(value);
        if (selectedVersion === undefined) {
          post({
            channel: "agent-provider.bridge",
            bootstrap: 0,
            type: "reject",
            direction: "extension-to-page",
            clientId: value.clientId,
            code: "NO_VERSION_OVERLAP",
          });
          return;
        }
        const sessionId = `session-${crypto.randomUUID()}`;
        sessions.set(value.clientId, sessionId);
        void capabilitiesFor(tabId, origin).then((capabilities) => {
          post(
            createBootstrapReady({
              hello: value,
              sessionId,
              selectedVersion,
              capabilities,
            }),
          );
        });
        return;
      }

      if (!isBridgeEnvelopeForDirection(value, "page-to-extension")) return;
      const message = value;
      if (message.sessionId !== sessions.get(message.clientId)) {
        return;
      }

      if (message.type === "session.open" && message.requestId !== undefined) {
        void postCapabilities(
          "session.ready",
          message.clientId,
          message.requestId,
        );
        return;
      }

      if (
        message.type === "permission.query" &&
        message.requestId !== undefined
      ) {
        void postCapabilities(
          "permission.result",
          message.clientId,
          message.requestId,
        );
        return;
      }

      if (
        message.type === "permission.request" &&
        message.requestId !== undefined
      ) {
        void (async () => {
          const permission = await permissionFor(tabId, origin);
          if (
            permission === "granted-session" ||
            permission === "granted-persistent" ||
            permission === "denied"
          ) {
            await postCapabilities(
              "permission.result",
              message.clientId,
              message.requestId!,
              permission,
            );
            return;
          }
          const key = sessionKey(tabId, origin);
          if (pendingPermissions.has(key)) {
            postError(message.clientId, message.requestId!, {
              code: "RATE_LIMITED",
              message:
                "An Agent Provider permission window is already open for this tab.",
              retryable: true,
            });
            return;
          }
          const clientId = message.clientId;
          const requestId = message.requestId!;
          const reason =
            typeof (message.payload as { reason?: unknown } | undefined)
              ?.reason === "string"
              ? (message.payload as { reason: string }).reason.slice(0, 300)
              : undefined;
          const timer = setTimeout(() => {
            pendingPermissions.delete(key);
            ownedPendingKeys.delete(key);
            postError(clientId, requestId, {
              code: "APPROVAL_EXPIRED",
              message: "The extension permission request expired.",
              retryable: true,
            });
          }, 120_000);
          const pending: PendingPermission = {
            complete: async (decision) => {
              clearTimeout(timer);
              pendingPermissions.delete(key);
              ownedPendingKeys.delete(key);
              await postCapabilities(
                "permission.result",
                clientId,
                requestId,
                decision === "deny" ? "denied" : undefined,
              );
            },
            dispose: () => clearTimeout(timer),
          };
          pendingPermissions.set(key, pending);
          ownedPendingKeys.add(key);
          const query = new URLSearchParams({
            tabId: String(tabId),
            origin,
            ...(reason === undefined ? {} : { reason }),
          });
          try {
            await browser.windows.create({
              url: browser.runtime.getURL(`/approval.html?${query.toString()}`),
              type: "popup",
              width: 760,
              height: 590,
              focused: true,
            });
          } catch {
            pending.dispose();
            pendingPermissions.delete(key);
            ownedPendingKeys.delete(key);
            postError(clientId, requestId, {
              code: "BRIDGE_UNAVAILABLE",
              message: "The extension could not open its permission window.",
              retryable: true,
            });
          }
        })();
        return;
      }

      if (message.type === "model.cancel") {
        const target = (
          message.payload as { targetRequestId?: unknown } | undefined
        )?.targetRequestId;
        if (typeof target === "string") {
          controllers.get(`${message.clientId}:${target}`)?.abort();
        }
        return;
      }

      if (message.type === "model.generate") {
        void executeModelRequest(message, "generate");
      } else if (message.type === "model.stream") {
        void executeModelRequest(message, "stream");
      }
    });

    port.onDisconnect.addListener(() => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      for (const key of ownedPendingKeys) {
        pendingPermissions.get(key)?.dispose();
        pendingPermissions.delete(key);
      }
      ownedPendingKeys.clear();
    });
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    const prefix = `${tabId}:`;
    for (const key of sessionGrants) {
      if (key.startsWith(prefix)) {
        sessionGrants.delete(key);
        sessionAliasFingerprints.delete(key);
      }
    }
    for (const key of deniedUntil.keys()) {
      if (key.startsWith(prefix)) deniedUntil.delete(key);
    }
    for (const key of sessionExecution.keys()) {
      if (key.startsWith(prefix)) sessionExecution.delete(key);
    }
  });

  browser.runtime.onMessage.addListener(
    async (value: unknown, sender): Promise<PopupResponse | undefined> => {
      const extensionPage = browser.runtime.getURL("/");
      if (
        sender.id !== browser.runtime.id ||
        !sender.url?.startsWith(extensionPage) ||
        !isPopupRequest(value)
      ) {
        return undefined;
      }
      if (value.type === "approval.get") {
        const pending = pendingProviderApprovals.get(value.approvalId);
        return pending === undefined
          ? { ok: false, error: "This approval expired or was already used." }
          : { ok: true, approval: pending.prompt };
      }
      if (value.type === "approval.decide") {
        const pending = pendingProviderApprovals.get(value.approvalId);
        if (pending === undefined) {
          return {
            ok: false,
            error: "This approval expired or was already used.",
          };
        }
        await pending.complete(value.decision);
        return { ok: true };
      }
      if (value.type === "audit.query") {
        let persistent: AuditEvent[] = [];
        try {
          persistent = [
            ...(await auditRecorder.persistentEvents(value.origin)),
          ];
          persistentAuditError = false;
        } catch {
          persistentAuditError = true;
        }
        return {
          ok: true,
          audit: {
            session: [...auditRecorder.sessionEvents(value.origin)],
            persistent,
            persistentError: persistentAuditError,
          },
        };
      }
      if (value.type === "audit.delete") {
        const deleted =
          value.origin === undefined
            ? await auditRecorder.deleteAllPersistent()
            : await auditRecorder.deletePersistentOrigin(value.origin);
        return { ok: true, deleted };
      }
      if (!(await verifyTrustedTab(value.tabId, value.origin))) {
        return { ok: false, error: "The active tab changed." };
      }

      const key = sessionKey(value.tabId, value.origin);
      const settings = await loadSettings();
      const execution = executionFor(value.tabId, value.origin, settings);
      if (value.type === "session.set") {
        sessionExecution.set(key, {
          mode: value.mode,
          privateMode: value.privateMode,
        });
      }
      if (value.type === "permission.set") {
        if (value.decision === "grant-session") {
          sessionGrants.add(key);
          sessionAliasFingerprints.set(key, await aliasFingerprints(settings));
          deniedUntil.delete(key);
        } else if (value.decision === "grant-persistent") {
          await grantPersistentPermission(value.origin);
          await setPersistentFingerprints(
            value.origin,
            await aliasFingerprints(settings),
          );
          sessionGrants.delete(key);
          sessionAliasFingerprints.delete(key);
          deniedUntil.delete(key);
        } else if (value.decision === "revoke") {
          sessionGrants.delete(key);
          sessionAliasFingerprints.delete(key);
          deniedUntil.delete(key);
          await revokePersistentPermission(value.origin);
          await setPersistentFingerprints(value.origin, undefined);
        } else {
          sessionGrants.delete(key);
          sessionAliasFingerprints.delete(key);
          deniedUntil.set(key, Date.now() + 60_000);
        }
        if (value.decision !== "revoke") {
          await pendingPermissions.get(key)?.complete(value.decision);
        }
        await recordAudit(settings, execution, {
          type: "permission-decision",
          origin: value.origin,
          mode: execution.mode,
          decision:
            value.decision === "deny" || value.decision === "revoke"
              ? "denied"
              : "allowed",
          ...(value.decision === "grant-persistent"
            ? { grantScope: "persistent" }
            : value.decision === "grant-session"
              ? { grantScope: "session" }
              : {}),
        });
      }

      let persistentEvents = 0;
      if (settings.audit.persistentEnabled) {
        try {
          persistentEvents = (
            await auditRecorder.persistentEvents(value.origin)
          ).length;
          persistentAuditError = false;
        } catch {
          persistentAuditError = true;
        }
      }

      const status: PopupStatus = {
        origin: value.origin,
        permission: await permissionFor(value.tabId, value.origin),
        providerConfigured:
          settings.provider.apiKey.length > 0 ||
          Object.values(settings.profiles).some(
            (profile) => profile.apiKey.length > 0,
          ),
        aliases: Object.keys(settings.aliases).sort(),
        execution: executionFor(value.tabId, value.origin, settings),
        audit: {
          persistentEnabled: settings.audit.persistentEnabled,
          persistentError: persistentAuditError,
          sessionEvents: auditRecorder.sessionEvents(value.origin).length,
          persistentEvents,
        },
      };
      return { ok: true, status };
    },
  );
});
