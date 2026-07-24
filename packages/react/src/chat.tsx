import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
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

export interface AgentProviderChatProps {
  className?: string;
  title?: string;
  placeholder?: string;
  connectLabel?: string;
  components?: AgentProviderChatComponents;
  autoConnect?: boolean;
  showToolActivity?: boolean;
}

const DefaultButton: ComponentType<ButtonHTMLAttributes<HTMLButtonElement>> = (
  props,
) => <button {...props} />;

const DefaultTextarea: ComponentType<
  TextareaHTMLAttributes<HTMLTextAreaElement>
> = (props) => <textarea {...props} />;

function DefaultMessage({ message }: { message: AgentProviderMessage }) {
  return (
    <article
      className={`agent-provider-message agent-provider-message--${message.role}`}
      data-status={message.status}
    >
      <span className="agent-provider-message__role">
        {message.role === "assistant" ? "AgentProvider" : "You"}
      </span>
      <div className="agent-provider-message__text">
        {message.text || (message.status === "streaming" ? "…" : "")}
      </div>
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

function DefaultActivity({ activity }: { activity: ToolActivity }) {
  return (
    <div className="agent-provider-activity">
      <span>{activity.toolName}</span>
      <span>{activity.phase.replaceAll("-", " ")}</span>
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
}: AgentProviderChatProps) {
  const runtime = useAgentProviderRuntime();
  const state = useAgentProviderState();
  const [input, setInput] = useState("");
  const [authorizing, setAuthorizing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const Button = components.Button ?? DefaultButton;
  const Textarea = components.Textarea ?? DefaultTextarea;
  const Message = components.Message ?? DefaultMessage;
  const Activity = components.Activity ?? DefaultActivity;

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
      return "AgentProvider extension not detected.";
    if (state.connection === "error") return state.error ?? "Bridge error.";
    if (!providerConfigured)
      return "Configure a provider in the AgentProvider extension.";
    if (!granted) return "This page needs permission to use your model.";
    return undefined;
  }, [granted, providerConfigured, state.connection, state.error]);

  async function connectAndAuthorize() {
    setAuthorizing(true);
    try {
      await runtime.connect();
      const current = runtime.getSnapshot();
      if (!isPermissionGranted(current.capabilities?.permission)) {
        await runtime.requestPermission(
          "Use your configured model with this page’s prompt and tool schemas.",
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

  return (
    <section
      className={`agent-provider-chat ${className}`.trim()}
      aria-label={title}
    >
      <header className="agent-provider-header">
        <div>
          <strong>{title}</strong>
          <span>Page tools · your model</span>
        </div>
        {busy ? (
          <Button
            type="button"
            className="agent-provider-button agent-provider-button--ghost"
            onClick={() => runtime.cancel()}
          >
            Stop
          </Button>
        ) : null}
      </header>

      {statusText !== undefined ? (
        <div className="agent-provider-status" role="status">
          <span>{statusText}</span>
          {state.connection !== "connecting" &&
          (!granted || state.connection !== "ready") ? (
            <Button
              type="button"
              className="agent-provider-button"
              disabled={authorizing}
              onClick={() => void connectAndAuthorize()}
            >
              {authorizing ? "Connecting…" : connectLabel}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="agent-provider-transcript" aria-live="polite">
        {state.messages.length === 0 ? (
          <div className="agent-provider-empty">
            Ask about the current page or let AgentProvider use one of its
            declared tools.
          </div>
        ) : null}
        {state.messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}

        {showToolActivity
          ? state.toolActivity
              .slice(-4)
              .map((activity) => (
                <Activity key={activity.id} activity={activity} />
              ))
          : null}

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
}

export function AgentProviderLauncher({
  buttonLabel = "Ask AgentProvider",
  defaultOpen = false,
  ...chatProps
}: AgentProviderLauncherProps) {
  const [open, setOpen] = useState(defaultOpen);
  const Button = chatProps.components?.Button ?? DefaultButton;

  return (
    <div className="agent-provider-launcher" data-open={open}>
      {/* Keep the chat mounted while closed so the transcript survives
          open/close and the panel can fade/slide via CSS (driven by
          data-open on the wrapper) instead of mounting/unmounting
          abruptly. Note this also means the chat's auto-connect probe
          fires when the launcher mounts, not on first open. */}
      <div className="agent-provider-launcher__panel">
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
