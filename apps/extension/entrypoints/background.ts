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
import { isAllowedApplicationOrigin } from "../agent-provider.config.js";
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
const AUTHORITY_FINGERPRINTS_KEY = "agent-provider.authority-fingerprints.v1";

interface PendingPermission {
  complete(decision: PermissionDecision): Promise<void>;
  dispose(): void;
}

const pendingPermissions = new Map<string, PendingPermission>();

// TODO(alpha-hardening): The audited QuotaLedger, AuditRecorder, grant-policy,
// and single-use approval stores in lib/ are deliberate integration seams, not
// yet background lifecycle enforcement. Before a production claim, wire them
// around provider dispatch and tool execution exactly as tracked in
// docs/FUTURE-CONCERNS.md. Current enforcement is exact-origin consent,
// authority fingerprints, request/concurrency/token bounds, timeouts, and
// result scrubbing.

function sessionKey(tabId: number, origin: string): string {
  return `${tabId}:${origin}`;
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
      const requestKey = `${message.clientId}:${requestId}`;

      try {
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
        if (
          estimateWireBytes(payload.callOptions) >
          settings.limits.maxRequestBytes
        ) {
          throw new RequestFailure(
            "POLICY_VIOLATION",
            "The model request is larger than the configured byte limit.",
          );
        }

        const rawOptions = decodeWireValue(payload.callOptions);
        const safeOptions = enforceCallPolicy(rawOptions, alias, settings);
        const controller = new AbortController();
        controllers.set(requestKey, controller);
        activeCount += 1;
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, settings.limits.requestTimeoutMs);

        if (mode === "generate") {
          const result = await runGenerate(
            settings,
            alias,
            safeOptions,
            controller.signal,
          );
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
          for await (const part of result.stream) {
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
  });

  browser.runtime.onMessage.addListener(
    async (value: unknown, sender): Promise<PopupResponse | undefined> => {
      if (sender.id !== browser.runtime.id || !isPopupRequest(value)) {
        return undefined;
      }
      if (!(await verifyTrustedTab(value.tabId, value.origin))) {
        return { ok: false, error: "The active tab changed." };
      }

      const key = sessionKey(value.tabId, value.origin);
      const settings = await loadSettings();
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
      };
      return { ok: true, status };
    },
  );
});
