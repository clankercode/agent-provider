import { useEffect, useState, type FormEvent } from "react";
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

export function OptionsApp() {
  const initialAuditOrigin = new URLSearchParams(location.search).get("origin");
  const [settings, setSettings] = useState<AgentProviderExtensionSettings>(() =>
    structuredClone(DEFAULT_SETTINGS),
  );
  const [aliasesText, setAliasesText] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState("Loading…");
  const [error, setError] = useState<string>();
  const [audit, setAudit] = useState<AuditView>();
  const [auditOrigin, setAuditOrigin] = useState<string | undefined>(
    initialAuditOrigin === null ? undefined : initialAuditOrigin,
  );
  const [confirmAuditDelete, setConfirmAuditDelete] = useState(false);

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setSettings(loaded);
      setAliasesText(JSON.stringify(loaded.aliases, null, 2));
      setStatus("Ready");
    });
    void readAudit(initialAuditOrigin ?? undefined)
      .then(setAudit)
      .catch(() => undefined);
  }, []);

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
    setStatus("Saving…");
    try {
      const aliases = JSON.parse(aliasesText) as unknown;
      const next = normalizeSettings({ ...settings, aliases });
      await requestProviderOrigins(next);
      const saved = await saveSettings(next);
      setSettings(saved);
      setAliasesText(JSON.stringify(saved.aliases, null, 2));
      setStatus("Saved");
    } catch (cause) {
      setStatus("Not saved");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function updateProfile(id: string, patch: Partial<ProviderProfile>) {
    setSettings((current) => ({
      ...current,
      profiles: {
        ...current.profiles,
        [id]: { ...current.profiles[id]!, ...patch },
      },
    }));
  }

  function addProfile() {
    setSettings((current) => {
      let index = Object.keys(current.profiles).length + 1;
      while (current.profiles[`provider-${index}`] !== undefined) index += 1;
      const id = `provider-${index}`;
      return {
        ...current,
        profiles: {
          ...current.profiles,
          [id]: {
            id,
            family: "openai-compatible",
            endpoint: "https://api.openai.com/v1/",
            apiKey: "",
          },
        },
      };
    });
  }

  function removeProfile(id: string) {
    setSettings((current) => {
      const profiles = { ...current.profiles };
      delete profiles[id];
      return { ...current, profiles };
    });
  }

  const auditOrigins = [
    ...new Set(
      [...(audit?.persistent ?? []), ...(audit?.session ?? [])].flatMap(
        (event) => (event.origin === undefined ? [] : [event.origin]),
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
            <button className="secondary" type="button" onClick={addProfile}>
              Add profile
            </button>
          </div>

          {Object.entries(settings.profiles).length === 0 ? (
            <div className="empty-state">
              <strong>No named profiles yet</strong>
              <span>Add one for custom endpoints or non-OpenAI providers.</span>
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
                        onChange={(event) =>
                          updateProfile(id, {
                            family: event.currentTarget.value as ProviderFamily,
                          })
                        }
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
                setSettings((current) => ({
                  ...current,
                  provider: {
                    ...current.provider,
                    endpoint: event.currentTarget.value,
                  },
                }))
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
                  setSettings((current) => ({
                    ...current,
                    provider: {
                      ...current.provider,
                      apiKey: event.currentTarget.value,
                    },
                  }))
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
                  setSettings((current) => ({
                    ...current,
                    provider: {
                      ...current.provider,
                      organization: event.currentTarget.value,
                    },
                  }))
                }
              />
            </label>
            <label>
              Project (optional)
              <input
                value={settings.provider.project}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    provider: {
                      ...current.provider,
                      project: event.currentTarget.value,
                    },
                  }))
                }
              />
            </label>
          </div>
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
            {[...(audit?.persistent ?? []), ...(audit?.session ?? [])]
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
        <footer>
          <span>{status}</span>
          <button type="submit">Save settings</button>
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
