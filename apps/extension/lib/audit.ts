import { canonicalJson } from "./canonical-json.js";
import type { BaseExecutionMode } from "./policy-resolution.js";

export type AuditEventType =
  | "permission-decision"
  | "model-request"
  | "tool-proposal"
  | "policy-failure"
  | "bridge-failure"
  | "audit-control";

export interface AuditEvent {
  id: string;
  timestamp: number;
  type: AuditEventType;
  origin?: string;
  requestId?: string;
  runId?: string;
  alias?: string;
  mode?: BaseExecutionMode;
  grantScope?: "session" | "persistent";
  decision?: "allowed" | "denied" | "cancelled" | "expired";
  status?: "queued" | "dispatched" | "completed" | "failed" | "outcome-unknown";
  toolName?: string;
  risk?: "read" | "write" | "destructive";
  errorCode?: string;
  requestBytes?: number;
  outputTokens?: number;
  durationMs?: number;
}

export interface AuditRetention {
  maxAgeMs: number;
  maxEvents: number;
  maxBytes: number;
}

export const HARD_AUDIT_RETENTION: Readonly<AuditRetention> = Object.freeze({
  maxAgeMs: 30 * 24 * 60 * 60 * 1_000,
  maxEvents: 10_000,
  maxBytes: 10 * 1024 * 1024,
});

const EVENT_TYPES = new Set<AuditEventType>([
  "permission-decision",
  "model-request",
  "tool-proposal",
  "policy-failure",
  "bridge-failure",
  "audit-control",
]);
const MODES = new Set<BaseExecutionMode>(["standard", "audit-first"]);
const GRANT_SCOPES = new Set(["session", "persistent"] as const);
const DECISIONS = new Set([
  "allowed",
  "denied",
  "cancelled",
  "expired",
] as const);
const STATUSES = new Set([
  "queued",
  "dispatched",
  "completed",
  "failed",
  "outcome-unknown",
] as const);
const RISKS = new Set(["read", "write", "destructive"] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maximum)
    : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function exactOrigin(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.origin === value ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Whitelists metadata fields; content and arbitrary provider data are ignored. */
export function createAuditEvent(value: unknown): AuditEvent {
  if (!isRecord(value) || !EVENT_TYPES.has(value.type as AuditEventType)) {
    throw new TypeError("Audit event type is invalid.");
  }
  const timestamp = count(value.timestamp);
  if (timestamp === undefined)
    throw new TypeError("Audit timestamp is invalid.");
  const id = text(value.id, 128) ?? crypto.randomUUID();
  const origin = exactOrigin(value.origin);
  if (value.origin !== undefined && origin === undefined) {
    throw new TypeError("Audit origin is invalid.");
  }
  const requestId = text(value.requestId, 128);
  const runId = text(value.runId, 128);
  const alias = text(value.alias, 64);
  const toolName = text(value.toolName, 128);
  const errorCode = text(value.errorCode, 128);
  const requestBytes = count(value.requestBytes);
  const outputTokens = count(value.outputTokens);
  const durationMs = count(value.durationMs);
  const event: AuditEvent = {
    id,
    timestamp,
    type: value.type as AuditEventType,
    ...(origin === undefined ? {} : { origin }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(runId === undefined ? {} : { runId }),
    ...(alias === undefined ? {} : { alias }),
    ...(MODES.has(value.mode as BaseExecutionMode)
      ? { mode: value.mode as BaseExecutionMode }
      : {}),
    ...(GRANT_SCOPES.has(value.grantScope as "session" | "persistent")
      ? { grantScope: value.grantScope as "session" | "persistent" }
      : {}),
    ...(DECISIONS.has(
      value.decision as "allowed" | "denied" | "cancelled" | "expired",
    )
      ? {
          decision: value.decision as
            "allowed" | "denied" | "cancelled" | "expired",
        }
      : {}),
    ...(STATUSES.has(
      value.status as
        "queued" | "dispatched" | "completed" | "failed" | "outcome-unknown",
    )
      ? {
          status: value.status as
            | "queued"
            | "dispatched"
            | "completed"
            | "failed"
            | "outcome-unknown",
        }
      : {}),
    ...(toolName === undefined ? {} : { toolName }),
    ...(RISKS.has(value.risk as "read" | "write" | "destructive")
      ? { risk: value.risk as "read" | "write" | "destructive" }
      : {}),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(requestBytes === undefined ? {} : { requestBytes }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(durationMs === undefined ? {} : { durationMs }),
  };
  return Object.freeze(event);
}

export function tightenAuditRetention(
  requested: Partial<AuditRetention> = {},
): AuditRetention {
  const tighten = (value: number | undefined, hard: number): number => {
    if (value === undefined) return hard;
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError("Audit retention limits must be non-negative.");
    }
    return Math.min(Math.floor(value), hard);
  };
  return {
    maxAgeMs: tighten(requested.maxAgeMs, HARD_AUDIT_RETENTION.maxAgeMs),
    maxEvents: tighten(requested.maxEvents, HARD_AUDIT_RETENTION.maxEvents),
    maxBytes: tighten(requested.maxBytes, HARD_AUDIT_RETENTION.maxBytes),
  };
}

function eventBytes(event: AuditEvent): number {
  return new TextEncoder().encode(canonicalJson(event)).byteLength;
}

/** Applies age, count, then global byte caps, always deleting oldest first. */
export function applyAuditRetention(
  events: readonly AuditEvent[],
  requested: Partial<AuditRetention> = {},
  now = Date.now(),
): AuditEvent[] {
  const retention = tightenAuditRetention(requested);
  const retained = events
    .filter((event) => event.timestamp > now - retention.maxAgeMs)
    .map((event) => createAuditEvent(event))
    .sort((left, right) =>
      left.timestamp === right.timestamp
        ? left.id.localeCompare(right.id)
        : left.timestamp - right.timestamp,
    );
  while (retained.length > retention.maxEvents) retained.shift();
  let bytes = retained.reduce((total, event) => total + eventBytes(event), 0);
  while (retained.length > 0 && bytes > retention.maxBytes) {
    bytes -= eventBytes(retained.shift()!);
  }
  return retained;
}

export interface PersistentAuditStore {
  load(): Promise<readonly AuditEvent[]>;
  replace(events: readonly AuditEvent[]): Promise<void>;
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Persistent audit storage failed."));
  });
}

function idbTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Persistent audit storage aborted."),
      );
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Persistent audit storage failed."),
      );
  });
}

/** Extension-local IndexedDB implementation for opt-in persistent audit. */
export class IndexedDbPersistentAuditStore implements PersistentAuditStore {
  readonly #database: Promise<IDBDatabase>;

  constructor(name = "agent-provider-audit-v1") {
    this.#database = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        if (request.result.objectStoreNames.contains("events")) return;
        const store = request.result.createObjectStore("events", {
          keyPath: "id",
        });
        store.createIndex("origin", "origin", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Persistent audit storage failed."));
    });
  }

  async load(): Promise<readonly AuditEvent[]> {
    const database = await this.#database;
    const transaction = database.transaction("events", "readonly");
    const events = (await idbRequest(
      transaction.objectStore("events").getAll(),
    )) as AuditEvent[];
    await idbTransaction(transaction);
    return events.map((event) => createAuditEvent(event));
  }

  async replace(events: readonly AuditEvent[]): Promise<void> {
    const safeEvents = events.map((event) => createAuditEvent(event));
    const database = await this.#database;
    const transaction = database.transaction("events", "readwrite");
    const store = transaction.objectStore("events");
    store.clear();
    for (const event of safeEvents) store.put(event);
    await idbTransaction(transaction);
  }
}

export class InMemoryPersistentAuditStore implements PersistentAuditStore {
  #events: AuditEvent[] = [];
  async load(): Promise<readonly AuditEvent[]> {
    return structuredClone(this.#events);
  }
  async replace(events: readonly AuditEvent[]): Promise<void> {
    this.#events = structuredClone([...events]);
  }
}

export class AuditRecorder {
  #session: AuditEvent[] = [];

  constructor(
    private readonly persistent: PersistentAuditStore,
    private readonly retention: Partial<AuditRetention> = {},
  ) {}

  async record(
    input: unknown,
    options: {
      privateMode: boolean;
      persistentEnabled: boolean;
      requirePersistentAudit?: boolean;
      retention?: Partial<AuditRetention>;
      now?: number;
    },
  ): Promise<{ persistent: boolean; persistentError: boolean }> {
    const event = createAuditEvent(input);
    const now = options.now ?? Date.now();
    const retention = options.retention ?? this.retention;
    this.#session = applyAuditRetention(
      [...this.#session, event],
      retention,
      now,
    );
    if (options.privateMode || !options.persistentEnabled) {
      return { persistent: false, persistentError: false };
    }
    try {
      const current = await this.persistent.load();
      await this.persistent.replace(
        applyAuditRetention([...current, event], retention, now),
      );
      return { persistent: true, persistentError: false };
    } catch (error) {
      if (options.requirePersistentAudit) throw error;
      return { persistent: false, persistentError: true };
    }
  }

  sessionEvents(origin?: string): readonly AuditEvent[] {
    return structuredClone(
      origin === undefined
        ? this.#session
        : this.#session.filter((event) => event.origin === origin),
    );
  }

  async persistentEvents(origin?: string): Promise<readonly AuditEvent[]> {
    const events = await this.persistent.load();
    return structuredClone(
      origin === undefined
        ? events
        : events.filter((event) => event.origin === origin),
    );
  }

  async deletePersistentOrigin(origin: string): Promise<number> {
    const events = await this.persistent.load();
    const retained = events.filter((event) => event.origin !== origin);
    await this.persistent.replace(retained);
    return events.length - retained.length;
  }

  async deleteAllPersistent(): Promise<number> {
    const events = await this.persistent.load();
    await this.persistent.replace([]);
    return events.length;
  }

  clearSession(): void {
    this.#session = [];
  }
}
