import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import type {
  ApprovalRequest,
  AgentProviderMessage,
  ToolActivity,
} from "@agent-provider/runtime";
import { useAgentProviderRuntime, useAgentProviderState } from "./context.js";

export interface AgentProviderChatComponents {
  Button?: ComponentType<ButtonHTMLAttributes<HTMLButtonElement>>;
  Textarea?: ComponentType<TextareaHTMLAttributes<HTMLTextAreaElement>>;
  Message?: ComponentType<{ message: AgentProviderMessage }>;
  Approval?: ComponentType<{
    request: ApprovalRequest;
    approve: () => void;
    deny: () => void;
  }>;
  Activity?: ComponentType<{ activity: ToolActivity }>;
}

/**
 * A host-provided renderer for tool-call results. Receives the full
 * ToolActivity (including output, toolName, toolCallId) and returns
 * arbitrary React content. When provided, a "rendered" view-mode button
 * appears alongside raw/pretty in the expanded Result section.
 *
 * New in NEXT_VERSION.
 */
export type ToolResultRenderer = (activity: ToolActivity) => ReactNode;

export type ToolResultViewMode = "raw" | "pretty" | "rendered";

export interface AgentProviderChatProps {
  className?: string;
  title?: string;
  placeholder?: string;
  connectLabel?: string;
  components?: AgentProviderChatComponents;
  autoConnect?: boolean;
  showToolActivity?: boolean;
  /**
   * Override the subtitle in the chat header. Pass a string for a fixed
   * label, or a function that receives `{ toolCount, modelLabel }` and
   * returns a string. When omitted the default format is used:
   * "Page tools (n) · Model: gpt-5-mini high".
   *
   * New in 0.1.4.
   */
  headerLabel?:
    string | ((info: { toolCount: number; modelLabel: string }) => string);
  /**
   * CSS custom property for the thinking indicator color. Default uses
   * --agent-provider-accent. Set to a color value to customise.
   *
   * New in 0.1.4.
   */
  thinkingColor?: string;
  /**
   * When true, render assistant messages with markdown formatting.
   * Default: true.
   *
   * New in 0.1.4.
   */
  markdown?: boolean;
  /**
   * Host-provided renderer for tool-call results. When set, the expanded
   * Result section shows a [raw|pretty|rendered] button group. "rendered"
   * calls this function with the full ToolActivity and displays whatever
   * React content it returns.
   *
   * New in NEXT_VERSION.
   */
  toolResultRenderer?: ToolResultRenderer;
}

/**
 * Corner the floating launcher docks to. Driven by `data-placement` on the
 * launcher root so host apps can choose a corner without forking CSS; fine
 * offsets use the `--agent-provider-inset-*` custom properties.
 */
export type AgentProviderLauncherPlacement =
  "bottom-right" | "bottom-left" | "top-right" | "top-left";

export interface AgentProviderLauncherInsets {
  top?: number | string;
  right?: number | string;
  bottom?: number | string;
  left?: number | string;
}

function formatInset(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/** Style object for host-supplied launcher insets (CSS custom properties). */
export function launcherInsetStyle(
  insets: AgentProviderLauncherInsets | undefined,
): { [key: `--${string}`]: string } | undefined {
  if (insets === undefined) return undefined;
  const style: { [key: `--${string}`]: string } = {};
  const top = formatInset(insets.top);
  const right = formatInset(insets.right);
  const bottom = formatInset(insets.bottom);
  const left = formatInset(insets.left);
  if (top !== undefined) style["--agent-provider-inset-top"] = top;
  if (right !== undefined) style["--agent-provider-inset-right"] = right;
  if (bottom !== undefined) style["--agent-provider-inset-bottom"] = bottom;
  if (left !== undefined) style["--agent-provider-inset-left"] = left;
  return Object.keys(style).length > 0 ? style : undefined;
}

const DefaultButton: ComponentType<ButtonHTMLAttributes<HTMLButtonElement>> = (
  props,
) => <button {...props} />;

const DefaultTextarea: ComponentType<
  TextareaHTMLAttributes<HTMLTextAreaElement>
> = (props) => <textarea {...props} />;

// ---------------------------------------------------------------------------
// Lightweight markdown renderer — no dependencies, handles the common cases:
// code blocks, inline code, bold, italic, links, headings, unordered lists,
// and paragraphs. Output is rendered via dangerouslySetInnerHTML with basic
// HTML-escaping to prevent injection.
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  // Inline code `code`
  out = out.replaceAll(
    /`([^`]+)`/g,
    '<code class="agent-provider-md-code">$1</code>',
  );
  // Bold **text** or __text__
  out = out.replaceAll(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replaceAll(/__(.+?)__/g, "<strong>$1</strong>");
  // Italic *text* or _text_
  out = out.replaceAll(/\*(.+?)\*/g, "<em>$1</em>");
  out = out.replaceAll(/_(.+?)_/g, "<em>$1</em>");
  // Links [text](url) — sanitize against javascript:/data: scheme injection
  out = out.replaceAll(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, linkText: string, url: string) => {
      const trimmed = url.trim();
      const safe = /^(https?:\/\/|mailto:|\/|#|\.\/)/.test(trimmed);
      const href = safe ? escapeHtml(trimmed) : "#";
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
    },
  );
  return out;
}

function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const html: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    // Code block fence
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        html.push(
          `<pre class="agent-provider-md-pre"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        closeList();
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headings
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1]!.length;
      html.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`);
      continue;
    }

    // Unordered list items
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        html.push('<ul class="agent-provider-md-ul">');
        inList = true;
      }
      html.push(`<li>${renderInline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      closeList();
      continue;
    }

    // Regular paragraph
    closeList();
    html.push(`<p>${renderInline(line)}</p>`);
  }

  // Close any open blocks
  if (inCodeBlock) {
    html.push(
      `<pre class="agent-provider-md-pre"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
    );
  }
  closeList();

  return html.join("");
}

function DefaultMessage({
  message,
  markdown = true,
}: {
  message: AgentProviderMessage;
  markdown?: boolean;
}) {
  const isUser = message.role === "user";
  const isError = message.status === "error";
  const html = useMemo(() => {
    if (isUser || !markdown || !message.text) return undefined;
    return renderMarkdown(message.text);
  }, [isUser, markdown, message.text]);

  return (
    <article
      className={`agent-provider-message agent-provider-message--${message.role}`}
      data-status={message.status}
    >
      <span className="agent-provider-message__role">
        {isUser ? "You" : "Agent"}
      </span>
      <div className="agent-provider-message__text">
        {isUser || !html ? (
          message.text || (message.status === "streaming" ? "…" : "")
        ) : (
          <div
            className="agent-provider-md"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
      {isError ? (
        <span className="agent-provider-message__icon agent-provider-message__icon--error">
          ⚠
        </span>
      ) : message.status === "streaming" ? (
        <span className="agent-provider-message__icon agent-provider-message__icon--thinking">
          <span className="agent-provider-dot" />
        </span>
      ) : null}
    </article>
  );
}

function displayJson(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, item) => (typeof item === "bigint" ? `${item}n` : item),
      2,
    );
  } catch {
    return "[Unrenderable tool input]";
  }
}

function displayJsonRaw(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? `${item}n` : item,
    );
  } catch {
    return "[Unrenderable tool input]";
  }
}

function DefaultApproval({
  request,
  approve,
  deny,
  Button,
}: {
  request: ApprovalRequest;
  approve: () => void;
  deny: () => void;
  Button: typeof DefaultButton;
}) {
  return (
    <section className="agent-provider-approval" aria-live="polite">
      <strong>{request.label}</strong>
      <span
        className={`agent-provider-risk agent-provider-risk--${request.risk}`}
      >
        {request.risk}
      </span>
      <pre>{displayJson(request.input)}</pre>
      <div className="agent-provider-row">
        <Button
          type="button"
          className="agent-provider-button"
          onClick={approve}
        >
          Allow
        </Button>
        <Button
          type="button"
          className="agent-provider-button agent-provider-button--ghost"
          onClick={deny}
        >
          Deny
        </Button>
      </div>
    </section>
  );
}

function DefaultActivity({
  activity,
  resultRenderer,
}: {
  activity: ToolActivity;
  resultRenderer?: ToolResultRenderer;
}) {
  const [expanded, setExpanded] = useState(false);
  const [resultMode, setResultMode] = useState<ToolResultViewMode>(
    resultRenderer ? "rendered" : "pretty",
  );

  const phaseLabel: Record<ToolActivity["phase"], string> = {
    "awaiting-approval": "awaiting approval",
    running: "running…",
    succeeded: "done",
    denied: "denied",
    failed: "failed",
  };
  const hasResult = activity.output !== undefined;

  return (
    <div
      className={`agent-provider-tool agent-provider-tool--${activity.phase}`}
    >
      <button
        type="button"
        className="agent-provider-tool__header"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span
          className={`agent-provider-tool__status agent-provider-tool__status--${activity.phase}`}
        />
        <span className="agent-provider-tool__name">{activity.toolName}</span>
        <span className="agent-provider-tool__phase">
          {phaseLabel[activity.phase]}
        </span>
        <span className="agent-provider-tool__chevron">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded ? (
        <div className="agent-provider-tool__body">
          {activity.input !== undefined ? (
            <details className="agent-provider-tool__section">
              <summary>Arguments</summary>
              <pre>{displayJson(activity.input)}</pre>
            </details>
          ) : null}
          {hasResult ? (
            <details className="agent-provider-tool__section" open>
              <summary className="agent-provider-tool__result-summary">
                <span>Result</span>
                {resultRenderer ? (
                  <div className="agent-provider-tool__view-toggle">
                    <button
                      type="button"
                      className={
                        resultMode === "rendered"
                          ? "agent-provider-tool__view-btn agent-provider-tool__view-btn--active"
                          : "agent-provider-tool__view-btn"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setResultMode("rendered");
                      }}
                    >
                      rendered
                    </button>
                    <button
                      type="button"
                      className={
                        resultMode === "pretty"
                          ? "agent-provider-tool__view-btn agent-provider-tool__view-btn--active"
                          : "agent-provider-tool__view-btn"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setResultMode("pretty");
                      }}
                    >
                      pretty
                    </button>
                    <button
                      type="button"
                      className={
                        resultMode === "raw"
                          ? "agent-provider-tool__view-btn agent-provider-tool__view-btn--active"
                          : "agent-provider-tool__view-btn"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setResultMode("raw");
                      }}
                    >
                      raw
                    </button>
                  </div>
                ) : (
                  <div className="agent-provider-tool__view-toggle">
                    <button
                      type="button"
                      className={
                        resultMode === "pretty"
                          ? "agent-provider-tool__view-btn agent-provider-tool__view-btn--active"
                          : "agent-provider-tool__view-btn"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setResultMode("pretty");
                      }}
                    >
                      pretty
                    </button>
                    <button
                      type="button"
                      className={
                        resultMode === "raw"
                          ? "agent-provider-tool__view-btn agent-provider-tool__view-btn--active"
                          : "agent-provider-tool__view-btn"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setResultMode("raw");
                      }}
                    >
                      raw
                    </button>
                  </div>
                )}
              </summary>
              {resultMode === "rendered" && resultRenderer ? (
                <div className="agent-provider-tool__rendered">
                  {resultRenderer(activity)}
                </div>
              ) : resultMode === "raw" ? (
                <pre className="agent-provider-tool__raw">
                  {displayJsonRaw(activity.output)}
                </pre>
              ) : (
                <pre>{displayJson(activity.output)}</pre>
              )}
            </details>
          ) : null}
          {activity.error !== undefined ? (
            <details className="agent-provider-tool__section" open>
              <summary>Error</summary>
              <pre className="agent-provider-tool__error">{activity.error}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function isPermissionGranted(permission: string | undefined): boolean {
  return (
    permission === "granted-session" || permission === "granted-persistent"
  );
}

export function AgentProviderChat({
  className = "",
  title = "AgentProvider",
  placeholder = "Ask this page to help…",
  connectLabel = "Connect AgentProvider",
  components = {},
  autoConnect = true,
  showToolActivity = true,
  headerLabel,
  thinkingColor,
  markdown = true,
  toolResultRenderer,
}: AgentProviderChatProps) {
  const runtime = useAgentProviderRuntime();
  const state = useAgentProviderState();
  const [input, setInput] = useState("");
  const [authorizing, setAuthorizing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const Button = components.Button ?? DefaultButton;
  const Textarea = components.Textarea ?? DefaultTextarea;
  const CustomActivity = components.Activity;
  const Message = components.Message;

  const granted = isPermissionGranted(state.capabilities?.permission);
  const providerConfigured = state.capabilities?.providerConfigured ?? true;
  const busy =
    state.runState === "submitting" || state.runState === "streaming";
  const canSend =
    state.connection === "ready" && granted && providerConfigured && !busy;

  useEffect(() => {
    if (autoConnect && state.connection === "idle") {
      void runtime.connect().catch(() => {});
    }
  }, [autoConnect, runtime, state.connection]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [state.messages, state.approvals, state.toolActivity]);

  const statusText = useMemo(() => {
    if (state.connection === "connecting") return "Looking for the extension…";
    if (state.connection === "unavailable")
      return "Agent Provider extension not detected. Install it, then open the popup on this tab and choose Enable on this site. Reload the page after enabling.";
    if (state.connection === "needs-enable")
      return (
        state.error ??
        "Agent Provider is installed, but this origin is not enabled. Open the extension popup → Enable on this site, then reload."
      );
    if (state.connection === "error") return state.error ?? "Bridge error.";
    if (!providerConfigured)
      return "Configure a provider in the Agent Provider extension (options page).";
    if (!granted)
      return "Please allow this page in the Agent Provider extension (Allow this tab or Always allow).";
    return undefined;
  }, [granted, providerConfigured, state.connection, state.error]);

  const subtitle = useMemo(() => {
    if (typeof headerLabel === "string") return headerLabel;
    const toolCount = runtime.toolCount;
    const modelLabel = runtime.modelLabel;
    if (typeof headerLabel === "function")
      return headerLabel({ toolCount, modelLabel });
    // Default format: "Page tools (n) · Model: gpt-5-mini high"
    const parts: string[] = [];
    if (toolCount > 0) parts.push(`Page tools (${toolCount})`);
    if (modelLabel.length > 0) parts.push(`Model: ${modelLabel}`);
    return parts.length > 0 ? parts.join(" · ") : "Page tools · your model";
    // state.capabilities is in deps so the label refreshes after connect.
  }, [headerLabel, runtime, state.capabilities]);

  const showConnectAction =
    state.connection !== "connecting" &&
    (state.connection === "unavailable" ||
      state.connection === "needs-enable" ||
      state.connection === "error" ||
      (state.connection === "ready" && !granted));

  const connectButtonLabel = authorizing
    ? "Connecting…"
    : state.connection === "ready" && !granted
      ? "Request access"
      : connectLabel;

  async function connectAndAuthorize() {
    setAuthorizing(true);
    try {
      await runtime.connect();
      const current = runtime.getSnapshot();
      if (!isPermissionGranted(current.capabilities?.permission)) {
        await runtime.requestPermission(
          "Use your configured model with this page's prompt and tool schemas.",
        );
      }
    } finally {
      setAuthorizing(false);
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = input.trim();
    if (!canSend || value.length === 0) return;
    setInput("");
    await runtime.send(value).catch(() => {});
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  const headerStyle = useMemo(
    () =>
      thinkingColor === undefined
        ? undefined
        : ({
            "--agent-provider-thinking": thinkingColor,
          } as React.CSSProperties),
    [thinkingColor],
  );

  return (
    <section
      className={`agent-provider-chat ${className}`.trim()}
      aria-label={title}
      data-busy={busy || undefined}
      style={headerStyle}
    >
      <header className="agent-provider-header">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        {busy ? (
          <div className="agent-provider-header__actions">
            <span className="agent-provider-thinking">
              <span className="agent-provider-dot" />
              <span className="agent-provider-dot" />
              <span className="agent-provider-dot" />
            </span>
            <Button
              type="button"
              className="agent-provider-button agent-provider-button--ghost"
              onClick={() => runtime.cancel()}
            >
              Stop
            </Button>
          </div>
        ) : null}
      </header>

      {statusText !== undefined ? (
        <div
          className="agent-provider-status"
          role="status"
          data-tone={
            state.connection === "unavailable" ||
            state.connection === "needs-enable" ||
            state.connection === "error"
              ? "error"
              : state.connection === "ready" && !granted
                ? "warn"
                : "info"
          }
        >
          <span className="agent-provider-status__text">{statusText}</span>
          <div className="agent-provider-status__action">
            {showConnectAction ? (
              <Button
                type="button"
                className="agent-provider-button"
                disabled={authorizing}
                onClick={() => void connectAndAuthorize()}
              >
                {connectButtonLabel}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="agent-provider-transcript" aria-live="polite">
        {state.messages.length === 0 && state.toolActivity.length === 0 ? (
          <div className="agent-provider-empty">
            Ask about the current page or let AgentProvider use one of its
            declared tools.
          </div>
        ) : null}
        {(() => {
          // Merge messages and tool activities into a single timeline by
          // timestamp so tool calls appear inline with the conversation.
          type TimelineItem =
            | { kind: "message"; ts: number; data: AgentProviderMessage }
            | { kind: "tool"; ts: number; data: ToolActivity };

          const timeline: TimelineItem[] = [
            ...state.messages.map((m) => ({
              kind: "message" as const,
              ts: m.createdAt,
              data: m,
            })),
            ...(showToolActivity
              ? state.toolActivity.map((a) => ({
                  kind: "tool" as const,
                  ts: a.startedAt,
                  data: a,
                }))
              : []),
          ];
          timeline.sort((a, b) => a.ts - b.ts);

          return timeline.map((item) =>
            item.kind === "message" ? (
              Message === undefined ? (
                <DefaultMessage
                  key={item.data.id}
                  message={item.data}
                  markdown={markdown}
                />
              ) : (
                <Message key={item.data.id} message={item.data} />
              )
            ) : CustomActivity ? (
              <CustomActivity key={item.data.id} activity={item.data} />
            ) : (
              <DefaultActivity
                key={item.data.id}
                activity={item.data}
                {...(toolResultRenderer
                  ? { resultRenderer: toolResultRenderer }
                  : {})}
              />
            ),
          );
        })()}

        {state.approvals.map((request) => {
          const approve = () => runtime.resolveApproval(request.id, true);
          const deny = () => runtime.resolveApproval(request.id, false);
          const Approval = components.Approval;
          return Approval === undefined ? (
            <DefaultApproval
              key={request.id}
              request={request}
              approve={approve}
              deny={deny}
              Button={Button}
            />
          ) : (
            <Approval
              key={request.id}
              request={request}
              approve={approve}
              deny={deny}
            />
          );
        })}
        <div ref={endRef} />
      </div>

      {runtime.suggestions.length > 0 && state.messages.length === 0 ? (
        <div className="agent-provider-suggestions">
          {runtime.suggestions.map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              className="agent-provider-chip"
              disabled={!canSend}
              onClick={() => {
                setInput("");
                void runtime.send(suggestion).catch(() => {});
              }}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      ) : null}

      <form
        className="agent-provider-composer"
        onSubmit={(event) => void submit(event)}
      >
        <Textarea
          value={input}
          rows={2}
          placeholder={placeholder}
          disabled={!granted || !providerConfigured}
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          aria-label={placeholder}
        />
        <Button
          type="submit"
          className="agent-provider-button"
          disabled={!canSend || input.trim().length === 0}
        >
          Send
        </Button>
      </form>
    </section>
  );
}

export interface AgentProviderLauncherProps extends AgentProviderChatProps {
  buttonLabel?: string;
  defaultOpen?: boolean;
  /**
   * Which viewport corner the floating launcher occupies. Default
   * `bottom-right`. The panel opens away from the chosen edges.
   */
  placement?: AgentProviderLauncherPlacement;
  /**
   * Optional edge offsets. Numbers are pixels; strings pass through as CSS
   * (e.g. `"4.5rem"`). Applied as `--agent-provider-inset-*` variables so
   * hosts can also set them from a stylesheet without a prop.
   */
  insets?: AgentProviderLauncherInsets;
  /** When false, the launcher fades out via `data-visible` (probe gating). */
  visible?: boolean;
  className?: string;
  /**
   * When true, the chat panel can be dragged by its header to pop out of
   * the docked corner. The panel becomes position:fixed and follows the
   * cursor. Close/drag back to re-dock.
   *
   * New in 0.1.4.
   */
  draggable?: boolean;
}

export function AgentProviderLauncher({
  buttonLabel = "Ask AgentProvider",
  defaultOpen = false,
  placement = "bottom-right",
  insets,
  visible = true,
  className = "",
  draggable = false,
  ...chatProps
}: AgentProviderLauncherProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [poppedOut, setPoppedOut] = useState(false);
  const [dragPos, setDragPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panelX: number;
    panelY: number;
  } | null>(null);
  const Button = chatProps.components?.Button ?? DefaultButton;
  const insetStyle = launcherInsetStyle(insets);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!poppedOut) return;
    const handleMove = (e: PointerEvent) => {
      if (dragRef.current === null) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setDragPos({
        x: Math.max(0, dragRef.current.panelX + dx),
        y: Math.max(0, dragRef.current.panelY + dy),
      });
    };
    const handleUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [poppedOut]);

  function handleHeaderPointerDown(e: React.PointerEvent) {
    if (!draggable) return;
    const panel = headerRef.current?.closest(
      ".agent-provider-launcher__panel",
    ) as HTMLElement | null;
    if (panel === null) return;
    const rect = panel.getBoundingClientRect();
    // Only initiate drag from non-docked edges/corners (the header itself).
    // On first drag, pop out to fixed position.
    if (!poppedOut) {
      setPoppedOut(true);
      setDragPos({ x: rect.left, y: rect.top });
    }
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panelX: poppedOut ? (dragPos?.x ?? rect.left) : rect.left,
      panelY: poppedOut ? (dragPos?.y ?? rect.top) : rect.top,
    };
  }

  const panelStyle =
    poppedOut && dragPos !== null
      ? {
          position: "fixed" as const,
          left: `${dragPos.x}px`,
          top: `${dragPos.y}px`,
          right: "auto" as const,
          bottom: "auto" as const,
          margin: 0,
        }
      : undefined;

  return (
    <div
      className={["agent-provider-launcher", className]
        .filter(Boolean)
        .join(" ")}
      data-open={open}
      data-placement={placement}
      data-visible={visible}
      data-popped-out={poppedOut || undefined}
      style={insetStyle}
    >
      <div
        className="agent-provider-launcher__panel"
        style={panelStyle}
        ref={headerRef}
      >
        <div
          className="agent-provider-launcher__drag-handle"
          onPointerDown={draggable ? handleHeaderPointerDown : undefined}
          style={{ display: draggable ? "block" : "none" }}
        >
          {poppedOut ? (
            <button
              type="button"
              className="agent-provider-launcher__dock"
              onClick={() => {
                setPoppedOut(false);
                setDragPos(null);
              }}
            >
              ⤓ Dock
            </button>
          ) : (
            <span className="agent-provider-launcher__drag-hint">⤢ Drag</span>
          )}
        </div>
        <AgentProviderChat {...chatProps} />
      </div>
      <Button
        type="button"
        className="agent-provider-launcher__button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "Close" : buttonLabel}
      </Button>
    </div>
  );
}
