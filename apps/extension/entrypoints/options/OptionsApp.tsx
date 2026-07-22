import { useEffect, useRef, useState, type FormEvent } from "react";
import { browser } from "wxt/browser";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type AgentProviderExtensionSettings,
} from "../../lib/settings.js";
import type {
  ProviderFamily,
  ProviderProfile,
} from "../../lib/provider-profiles.js";
import { DEFAULT_PROVIDER_ENDPOINTS } from "../../lib/provider-profiles.js";
import {
  listProviderModels,
  type ProviderModel,
} from "../../lib/provider-models.js";
import {
  AGENT_PROVIDER_UI_MARKER,
  type AuditView,
  type PopupResponse,
} from "../../lib/ui-messages.js";

async function readAudit(origin?: string): Promise<AuditView> {
  const response = (await browser.runtime.sendMessage({
    marker: AGENT_PROVIDER_UI_MARKER,
    type: "audit.query",
    ...(origin === undefined ? {} : { origin }),
  })) as PopupResponse;
  if (!response.ok || response.audit === undefined) {
    throw new Error(response.error ?? "The audit ledger is unavailable.");
  }
  return response.audit;
}

async function requestProviderOrigins(
  settings: AgentProviderExtensionSettings,
): Promise<void> {
  const endpoints = [
    settings.provider.endpoint,
    ...Object.values(settings.profiles).map((profile) => profile.endpoint),
  ];
  const patterns = [
    ...new Set(endpoints.map((endpoint) => `${new URL(endpoint).origin}/*`)),
  ];
  const missing: string[] = [];
  for (const pattern of patterns) {
    if (!(await browser.permissions.contains({ origins: [pattern] }))) {
      missing.push(pattern);
    }
  }
  if (
    missing.length > 0 &&
    !(await browser.permissions.request({ origins: missing }))
  ) {
    throw new Error("Provider host access was not granted.");
  }
}

interface ModelCatalogState {
  phase: "loading" | "ready" | "error";
  models: ProviderModel[];
  selectedId?: string;
  message?: string;
}

function settingsSnapshot(
  settings: AgentProviderExtensionSettings,
  aliasesText: string,
): string {
  return JSON.stringify({ aliasesText, settings });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ModelCatalog({
  state,
  disabled,
  onPull,
  onSelect,
  onUse,
}: {
  state: ModelCatalogState | undefined;
  disabled: boolean;
  onPull(): void;
  onSelect(id: string): void;
  onUse(id: string): void;
}) {
  const selectedId = state?.selectedId ?? state?.models[0]?.id ?? "";
  return (
    <div className="model-catalog" aria-live="polite">
      <div className="model-catalog-heading">
        <div>
          <strong>Provider models</strong>
          <span>Pull the provider catalog without exposing your key.</span>
        </div>
        <button
          className="secondary"
          type="button"
          disabled={disabled || state?.phase === "loading"}
          onClick={onPull}
        >
          {state?.phase === "loading" ? "Pulling…" : "Pull models"}
        </button>
      </div>
      {state?.phase === "error" ? (
        <div className="catalog-error" role="alert">
          {state.message}
        </div>
      ) : null}
      {state?.phase === "ready" && state.models.length === 0 ? (
        <div className="catalog-empty">
          No usable generation models were returned. Manual model IDs still
          work.
        </div>
      ) : null}
      {state?.phase === "ready" && state.models.length > 0 ? (
        <div className="model-catalog-result">
          <label>
            Available models ({state.models.length})
            <select
              value={selectedId}
              onChange={(event) => onSelect(event.currentTarget.value)}
            >
              {state.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName === undefined
                    ? model.id
                    : `${model.displayName} — ${model.id}`}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            type="button"
            onClick={() => onUse(selectedId)}
          >
            Use for default alias
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function OptionsApp() {
  const initialAuditOrigin = new URLSearchParams(location.search).get("origin");
  const [settings, setSettings] = useState<AgentProviderExtensionSettings>(() =>
    structuredClone(DEFAULT_SETTINGS),
  );
  const [aliasesText, setAliasesText] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savePhase, setSavePhase] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [savedSnapshot, setSavedSnapshot] = useState<string>();
  const [error, setError] = useState<string>();
  const [modelCatalogs, setModelCatalogs] = useState<
    Record<string, ModelCatalogState>
  >({});
  const modelCatalogRequests = useRef(new Map<string, AbortController>());
  const [audit, setAudit] = useState<AuditView>();
  const [auditOrigin, setAuditOrigin] = useState<string | undefined>(
    initialAuditOrigin === null ? undefined : initialAuditOrigin,
  );
  const [confirmAuditDelete, setConfirmAuditDelete] = useState(false);

  useEffect(() => {
    void loadSettings().then((loaded) => {
      const loadedAliases = JSON.stringify(loaded.aliases, null, 2);
      setSettings(loaded);
      setAliasesText(loadedAliases);
      setSavedSnapshot(settingsSnapshot(loaded, loadedAliases));
    });
    void readAudit(initialAuditOrigin ?? undefined)
      .then(setAudit)
      .catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      for (const request of modelCatalogRequests.current.values()) {
        request.abort();
      }
      modelCatalogRequests.current.clear();
    },
    [],
  );

  const dirty =
    savedSnapshot !== undefined &&
    settingsSnapshot(settings, aliasesText) !== savedSnapshot;
  const saveBarVisible =
    dirty ||
    savePhase === "saving" ||
    savePhase === "saved" ||
    savePhase === "error";

  useEffect(() => {
    if (savePhase !== "saved") return;
    const timeout = window.setTimeout(() => setSavePhase("idle"), 2_400);
    return () => window.clearTimeout(timeout);
  }, [savePhase]);

  useEffect(() => {
    if (dirty && savePhase === "saved") setSavePhase("idle");
  }, [dirty, savePhase]);

  useEffect(() => {
    if (!dirty && savePhase === "error") {
      setError(undefined);
      setSavePhase("idle");
    }
  }, [dirty, savePhase]);

  async function deleteAudit() {
    const response = (await browser.runtime.sendMessage({
      marker: AGENT_PROVIDER_UI_MARKER,
      type: "audit.delete",
      ...(auditOrigin === undefined ? {} : { origin: auditOrigin }),
    })) as PopupResponse;
    if (!response.ok) {
      throw new Error(response.error ?? "The audit ledger was not deleted.");
    }
    setAudit(await readAudit(auditOrigin));
    setConfirmAuditDelete(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (!dirty) return;
    setSavePhase("saving");
    try {
      const aliases = JSON.parse(aliasesText) as unknown;
      const next = normalizeSettings({ ...settings, aliases });
      await requestProviderOrigins(next);
      const saved = await saveSettings(next);
      const savedAliases = JSON.stringify(saved.aliases, null, 2);
      setSettings(saved);
      setAliasesText(savedAliases);
      setSavedSnapshot(settingsSnapshot(saved, savedAliases));
      setSavePhase("saved");
    } catch (cause) {
      setSavePhase("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function clearModelCatalog(id: string) {
    modelCatalogRequests.current.get(id)?.abort();
    modelCatalogRequests.current.delete(id);
    setModelCatalogs((current) => {
      if (current[id] === undefined) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function pullModels(id: string, profile: ProviderProfile) {
    modelCatalogRequests.current.get(id)?.abort();
    const controller = new AbortController();
    modelCatalogRequests.current.set(id, controller);
    setModelCatalogs((current) => ({
      ...current,
      [id]: { phase: "loading", models: [] },
    }));
    try {
      await requestProviderOrigins({
        ...settings,
        profiles: { [profile.id]: profile },
        provider: {
          ...settings.provider,
          endpoint: profile.endpoint,
        },
      });
      const models = await listProviderModels(profile, {
        signal: controller.signal,
      });
      if (modelCatalogRequests.current.get(id) !== controller) return;
      setModelCatalogs((current) => ({
        ...current,
        [id]: {
          phase: "ready",
          models,
          ...(models[0] === undefined ? {} : { selectedId: models[0].id }),
        },
      }));
    } catch (cause) {
      if (
        controller.signal.aborted ||
        modelCatalogRequests.current.get(id) !== controller
      ) {
        return;
      }
      setModelCatalogs((current) => ({
        ...current,
        [id]: {
          phase: "error",
          models: [],
          message: cause instanceof Error ? cause.message : String(cause),
        },
      }));
    } finally {
      if (modelCatalogRequests.current.get(id) === controller) {
        modelCatalogRequests.current.delete(id);
      }
    }
  }

  function selectModel(catalogId: string, selectedId: string) {
    setModelCatalogs((current) => {
      const catalog = current[catalogId];
      if (catalog === undefined) return current;
      return { ...current, [catalogId]: { ...catalog, selectedId } };
    });
  }

  function useModelForDefaultAlias(
    profileId: string | undefined,
    modelId: string,
  ) {
    try {
      const aliases = JSON.parse(aliasesText) as unknown;
      if (!isRecord(aliases))
        throw new TypeError("Alias map must be an object.");
      const existing = isRecord(aliases.default) ? aliases.default : {};
      const defaultAlias: Record<string, unknown> = {
        ...existing,
        model: modelId,
        maxOutputTokens:
          typeof existing.maxOutputTokens === "number"
            ? existing.maxOutputTokens
            : 2_048,
      };
      if (profileId === undefined) delete defaultAlias.profileId;
      else defaultAlias.profileId = profileId;
      setAliasesText(
        JSON.stringify({ ...aliases, default: defaultAlias }, null, 2),
      );
      setError(undefined);
      setSavePhase("idle");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Fix the alias JSON before applying a model: ${cause.message}`
          : "Fix the alias JSON before applying a model.",
      );
      setSavePhase("error");
    }
  }

  function updateProfile(id: string, patch: Partial<ProviderProfile>) {
    clearModelCatalog(id);
    setSettings((current) => ({
      ...current,
      profiles: {
        ...current.profiles,
        [id]: { ...current.profiles[id]!, ...patch },
      },
    }));
  }

  function addProfile(family: ProviderFamily) {
    setSettings((current) => {
      const stem =
        family === "openai-compatible"
          ? "openai"
          : family === "anthropic-compatible"
            ? "anthropic"
            : "gemini";
      let id = stem;
      let index = 2;
      while (current.profiles[id] !== undefined) {
        id = `${stem}-${index}`;
        index += 1;
      }
      return {
        ...current,
        profiles: {
          ...current.profiles,
          [id]: {
            id,
            family,
            endpoint: DEFAULT_PROVIDER_ENDPOINTS[family],
            apiKey: "",
          },
        },
      };
    });
  }

  function removeProfile(id: string) {
    clearModelCatalog(id);
    setSettings((current) => {
      const profiles = { ...current.profiles };
      delete profiles[id];
      return { ...current, profiles };
    });
  }

  function updateLegacyProvider(
    patch: Partial<AgentProviderExtensionSettings["provider"]>,
  ) {
    clearModelCatalog("legacy-openai");
    setSettings((current) => ({
      ...current,
      provider: { ...current.provider, ...patch },
    }));
  }

  const legacyProfile: ProviderProfile = {
    id: "legacy-openai",
    family: "openai-compatible",
    endpoint: settings.provider.endpoint,
    apiKey: settings.provider.apiKey,
    ...(settings.provider.organization
      ? { organization: settings.provider.organization }
      : {}),
    ...(settings.provider.project
      ? { project: settings.provider.project }
      : {}),
  };

  const auditEvents = [
    ...new Map(
      [...(audit?.persistent ?? []), ...(audit?.session ?? [])].map((event) => [
        `${event.id}:${event.timestamp}`,
        event,
      ]),
    ).values(),
  ];
  const auditOrigins = [
    ...new Set(
      auditEvents.flatMap((event) =>
        event.origin === undefined ? [] : [event.origin],
      ),
    ),
  ].sort();

  return (
    <main>
      <header>
        <div className="mark">AP</div>
        <div>
          <h1>Agent Provider</h1>
          <p>Your credentials. Trusted pages. Typed tools.</p>
        </div>
      </header>

      <form onSubmit={(event) => void submit(event)}>
        <section>
          <div className="section-heading">
            <div>
              <span className="eyebrow">Credential authority</span>
              <h2>Provider profiles</h2>
              <p>
                Configure OpenAI-compatible, Anthropic-compatible, or Gemini
                endpoints. Alias grants are invalidated when authority fields
                change.
              </p>
            </div>
            <div
              className="provider-add-actions"
              aria-label="Add provider profile"
            >
              <button
                className="secondary"
                type="button"
                onClick={() => addProfile("openai-compatible")}
              >
                Add OpenAI
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => addProfile("anthropic-compatible")}
              >
                Add Anthropic
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => addProfile("gemini")}
              >
                Add Gemini
              </button>
            </div>
          </div>

          {Object.entries(settings.profiles).length === 0 ? (
            <div className="empty-state">
              <strong>No named profiles yet</strong>
              <span>
                Start with an OpenAI, Anthropic, or Gemini endpoint preset. You
                can replace it with a compatible custom endpoint.
              </span>
            </div>
          ) : (
            <div className="profile-list">
              {Object.entries(settings.profiles).map(([id, profile]) => (
                <article className="profile-card" key={id}>
                  <div className="profile-heading">
                    <div>
                      <span className="eyebrow">{profile.family}</span>
                      <strong>{id}</strong>
                    </div>
                    <button
                      className="danger-link"
                      type="button"
                      onClick={() => removeProfile(id)}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid profile-grid">
                    <label>
                      Family
                      <select
                        value={profile.family}
                        onChange={(event) => {
                          const family = event.currentTarget
                            .value as ProviderFamily;
                          updateProfile(id, {
                            family,
                            ...(profile.endpoint ===
                            DEFAULT_PROVIDER_ENDPOINTS[profile.family]
                              ? { endpoint: DEFAULT_PROVIDER_ENDPOINTS[family] }
                              : {}),
                          });
                        }}
                      >
                        <option value="openai-compatible">
                          OpenAI compatible
                        </option>
                        <option value="anthropic-compatible">
                          Anthropic compatible
                        </option>
                        <option value="gemini">Gemini</option>
                      </select>
                    </label>
                    <label>
                      Base endpoint
                      <input
                        type="url"
                        value={profile.endpoint}
                        onChange={(event) =>
                          updateProfile(id, {
                            endpoint: event.currentTarget.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    API key
                    <input
                      type={showKey ? "text" : "password"}
                      autoComplete="off"
                      value={profile.apiKey}
                      onChange={(event) =>
                        updateProfile(id, { apiKey: event.currentTarget.value })
                      }
                    />
                  </label>
                  <ModelCatalog
                    state={modelCatalogs[id]}
                    disabled={
                      profile.apiKey.trim().length === 0 ||
                      profile.endpoint.trim().length === 0
                    }
                    onPull={() => void pullModels(id, profile)}
                    onSelect={(modelId) => selectModel(id, modelId)}
                    onUse={(modelId) => useModelForDefaultAlias(id, modelId)}
                  />
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="section-heading">
            <div>
              <h2>Legacy OpenAI profile</h2>
              <p>
                The key is stored in extension-local storage and is never sent
                into page JavaScript.
              </p>
            </div>
            <span className={settings.provider.apiKey ? "good" : "warn"}>
              {settings.provider.apiKey ? "Configured" : "Needs key"}
            </span>
          </div>

          <label>
            Base endpoint
            <input
              type="url"
              value={settings.provider.endpoint}
              onChange={(event) =>
                updateLegacyProvider({ endpoint: event.currentTarget.value })
              }
            />
          </label>

          <label>
            API key
            <div className="inline">
              <input
                type={showKey ? "text" : "password"}
                autoComplete="off"
                value={settings.provider.apiKey}
                placeholder="sk-…"
                onChange={(event) =>
                  updateLegacyProvider({ apiKey: event.currentTarget.value })
                }
              />
              <button
                className="secondary"
                type="button"
                onClick={() => setShowKey((current) => !current)}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <div className="grid">
            <label>
              Organization (optional)
              <input
                value={settings.provider.organization}
                onChange={(event) =>
                  updateLegacyProvider({
                    organization: event.currentTarget.value,
                  })
                }
              />
            </label>
            <label>
              Project (optional)
              <input
                value={settings.provider.project}
                onChange={(event) =>
                  updateLegacyProvider({ project: event.currentTarget.value })
                }
              />
            </label>
          </div>
          <ModelCatalog
            state={modelCatalogs["legacy-openai"]}
            disabled={
              legacyProfile.apiKey.trim().length === 0 ||
              legacyProfile.endpoint.trim().length === 0
            }
            onPull={() => void pullModels("legacy-openai", legacyProfile)}
            onSelect={(modelId) => selectModel("legacy-openai", modelId)}
            onUse={(modelId) => useModelForDefaultAlias(undefined, modelId)}
          />
        </section>

        <section>
          <h2>Model aliases</h2>
          <p>
            Pages ask for logical names such as <code>default</code> or{" "}
            <code>reasoning</code>. Only you choose the actual provider model
            and output ceiling.
          </p>
          <label>
            Alias map (JSON)
            <textarea
              rows={14}
              spellCheck={false}
              value={aliasesText}
              onChange={(event) => setAliasesText(event.currentTarget.value)}
            />
          </label>
          <pre className="example">{`{
  "default": {
    "model": "gpt-5-mini",
    "maxOutputTokens": 2048,
    "reasoning": "low"
  }
}`}</pre>
        </section>

        <section>
          <h2>Guardrails</h2>
          <div className="grid limits">
            <label>
              Request bytes
              <input
                type="number"
                min={16000}
                value={settings.limits.maxRequestBytes}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    limits: {
                      ...current.limits,
                      maxRequestBytes: Number(event.currentTarget.value),
                    },
                  }))
                }
              />
            </label>
            <label>
              Maximum output tokens
              <input
                type="number"
                min={64}
                value={settings.limits.maxOutputTokens}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    limits: {
                      ...current.limits,
                      maxOutputTokens: Number(event.currentTarget.value),
                    },
                  }))
                }
              />
            </label>
            <label>
              Concurrent calls per tab
              <input
                type="number"
                min={1}
                max={8}
                value={settings.limits.maxConcurrentRequests}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    limits: {
                      ...current.limits,
                      maxConcurrentRequests: Number(event.currentTarget.value),
                    },
                  }))
                }
              />
            </label>
            <label>
              Tools per request
              <input
                type="number"
                min={0}
                value={settings.limits.maxTools}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    limits: {
                      ...current.limits,
                      maxTools: Number(event.currentTarget.value),
                    },
                  }))
                }
              />
            </label>
            <label>
              Timeout (milliseconds)
              <input
                type="number"
                min={5000}
                value={settings.limits.requestTimeoutMs}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    limits: {
                      ...current.limits,
                      requestTimeoutMs: Number(event.currentTarget.value),
                    },
                  }))
                }
              />
            </label>
          </div>
        </section>

        <section>
          <div className="section-heading">
            <div>
              <span className="eyebrow">Execution authority</span>
              <h2>Modes, audit, and durable quotas</h2>
              <p>
                Audit-first requires one extension-owned approval per model
                dispatch. Private sessions never write persistent audit data.
              </p>
            </div>
            <span className={audit?.persistentError ? "warn" : "good"}>
              {audit?.persistentError ? "Audit write failed" : "Audit healthy"}
            </span>
          </div>

          <div className="grid">
            <label>
              Default dispatch mode
              <select
                value={settings.execution.defaultMode}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    execution: {
                      ...current.execution,
                      defaultMode: event.currentTarget.value as
                        "standard" | "audit-first",
                    },
                  }))
                }
              >
                <option value="standard">Standard</option>
                <option value="audit-first">Audit-first</option>
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.execution.privateByDefault}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    execution: {
                      ...current.execution,
                      privateByDefault: event.currentTarget.checked,
                    },
                  }))
                }
              />
              New sessions are private by default
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.audit.persistentEnabled}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    audit: {
                      ...current.audit,
                      persistentEnabled: event.currentTarget.checked,
                      requirePersistent: event.currentTarget.checked
                        ? current.audit.requirePersistent
                        : false,
                    },
                  }))
                }
              />
              Keep metadata-only audit between restarts
              <small>Default for sites without a popup override.</small>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.audit.requirePersistent}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    audit: {
                      ...current.audit,
                      requirePersistent: event.currentTarget.checked,
                      persistentEnabled:
                        event.currentTarget.checked ||
                        current.audit.persistentEnabled,
                    },
                  }))
                }
              />
              Block dispatch if persistent audit cannot be written
            </label>
          </div>

          <div className="grid limits">
            <label>
              Requests per minute / origin
              <input
                type="number"
                min={1}
                value={settings.quotas.requestsPerMinute}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    quotas: {
                      ...current.quotas,
                      requestsPerMinute: Number(event.currentTarget.value),
                    },
                  }))
                }
              />
            </label>
            <label>
              Requests per day / origin
              <input
                type="number"
                min={1}
                value={settings.quotas.requestsPerDay}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    quotas: {
                      ...current.quotas,
                      requestsPerDay: Number(event.currentTarget.value),
                    },
                  }))
                }
              />
            </label>
            <label>
              Tokens per day / origin
              <input
                type="number"
                min={64}
                value={settings.quotas.tokensPerDay}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    quotas: {
                      ...current.quotas,
                      tokensPerDay: Number(event.currentTarget.value),
                    },
                  }))
                }
              />
            </label>
          </div>

          <div className="audit-heading">
            <div>
              <strong>
                {auditOrigin === undefined ? "Metadata ledger" : "Site ledger"}
              </strong>
              <span>
                {audit === undefined
                  ? "Loading…"
                  : `${audit.session.length} session · ${audit.persistent.length} persistent`}
              </span>
              {auditOrigin === undefined ? null : <code>{auditOrigin}</code>}
            </div>
            <div className="audit-actions">
              {auditOrigin === undefined ? null : (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setAuditOrigin(undefined);
                    setConfirmAuditDelete(false);
                    history.replaceState(null, "", location.pathname);
                    void readAudit().then(setAudit);
                  }}
                >
                  View all origins
                </button>
              )}
              {confirmAuditDelete ? (
                <>
                  <button
                    className="danger-link"
                    type="button"
                    onClick={() =>
                      void deleteAudit().catch((cause) =>
                        setError(String(cause)),
                      )
                    }
                  >
                    Confirm delete
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setConfirmAuditDelete(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="danger-link"
                  type="button"
                  disabled={
                    audit === undefined || audit.persistent.length === 0
                  }
                  onClick={() => setConfirmAuditDelete(true)}
                >
                  {auditOrigin === undefined
                    ? "Delete all persistent audit"
                    : "Delete this site’s audit"}
                </button>
              )}
            </div>
          </div>
          {auditOrigin === undefined && auditOrigins.length > 0 ? (
            <nav className="audit-origins" aria-label="Audit origins">
              {auditOrigins.map((origin) => (
                <button
                  className="secondary"
                  type="button"
                  key={origin}
                  onClick={() => {
                    setAuditOrigin(origin);
                    setConfirmAuditDelete(false);
                    history.replaceState(
                      null,
                      "",
                      `${location.pathname}?origin=${encodeURIComponent(origin)}`,
                    );
                    void readAudit(origin).then(setAudit);
                  }}
                >
                  {origin}
                </button>
              ))}
            </nav>
          ) : null}
          <ol className="audit-list">
            {auditEvents
              .sort((left, right) => right.timestamp - left.timestamp)
              .slice(0, 12)
              .map((event) => (
                <li key={`${event.id}:${event.timestamp}`}>
                  <code>{event.origin ?? "global"}</code>
                  <span>
                    {event.type} ·{" "}
                    {event.status ?? event.decision ?? "recorded"}
                  </span>
                  <time dateTime={new Date(event.timestamp).toISOString()}>
                    {new Date(event.timestamp).toLocaleString()}
                  </time>
                </li>
              ))}
          </ol>
          {audit !== undefined &&
          audit.session.length === 0 &&
          audit.persistent.length === 0 ? (
            <div className="empty-state">
              <strong>No audit events yet</strong>
              <span>
                Only bounded metadata appears here; prompt content is never
                recorded.
              </span>
            </div>
          ) : null}
        </section>

        {error ? <div className="error">{error}</div> : null}
        <footer
          className={`save-bar${saveBarVisible ? " is-visible" : ""}`}
          aria-hidden={!saveBarVisible}
        >
          <span>
            {savePhase === "saving"
              ? "Saving…"
              : savePhase === "saved"
                ? "Settings saved"
                : savePhase === "error"
                  ? "Settings not saved"
                  : "Unsaved changes"}
          </span>
          <button type="submit" disabled={!dirty || savePhase === "saving"}>
            {savePhase === "saving" ? "Saving…" : "Save settings"}
          </button>
        </footer>
      </form>

      <aside>
        <strong>Security boundary</strong>
        <p>
          AgentProvider protects credentials from page code, but it cannot
          distinguish between different scripts running under the same web
          origin. Grant only origins you trust as a whole.
        </p>
      </aside>
    </main>
  );
}
