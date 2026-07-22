import { useEffect, useState, type FormEvent } from "react";
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

export function OptionsApp() {
  const [settings, setSettings] = useState<AgentProviderExtensionSettings>(() =>
    structuredClone(DEFAULT_SETTINGS),
  );
  const [aliasesText, setAliasesText] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState("Loading…");
  const [error, setError] = useState<string>();

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setSettings(loaded);
      setAliasesText(JSON.stringify(loaded.aliases, null, 2));
      setStatus("Ready");
    });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setStatus("Saving…");
    try {
      const aliases = JSON.parse(aliasesText) as unknown;
      const saved = await saveSettings(
        normalizeSettings({ ...settings, aliases }),
      );
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
