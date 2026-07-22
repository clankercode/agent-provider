import { canonicalJson, fingerprintCanonicalJson } from "./canonical-json.js";
import type { BaseExecutionMode } from "./policy-resolution.js";

interface CommonApprovalBinding {
  origin: string;
  tabId: number;
  clientId: string;
  sessionId: string;
  requestId: string;
}

export interface ProviderApprovalBinding extends CommonApprovalBinding {
  mode: BaseExecutionMode;
  aliasFingerprint: string;
  dispatchPayloadHash: string;
}

export interface ToolApprovalBinding extends CommonApprovalBinding {
  runId: string;
  toolCallId: string;
  toolName: string;
  risk: "read" | "write" | "destructive";
  declarationInputHash: string;
}

export type ApprovalBinding = ProviderApprovalBinding | ToolApprovalBinding;
export type ApprovalKind = "provider" | "tool";
export type ApprovalDecision = "approved" | "denied";

export interface ApprovalRecord {
  readonly id: string;
  readonly kind: ApprovalKind;
  readonly binding: ApprovalBinding;
  readonly bindingHash: string;
  readonly decision: ApprovalDecision;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export type ApprovalConsumeResult =
  | { ok: true; record: ApprovalRecord }
  | { ok: false; reason: "missing" | "mismatch" | "expired" | "denied" };

export async function createApprovalRecord(input: {
  id?: string;
  kind: ApprovalKind;
  binding: ApprovalBinding;
  decision: ApprovalDecision;
  createdAt: number;
  expiresAt: number;
}): Promise<ApprovalRecord> {
  if (input.expiresAt <= input.createdAt) {
    throw new TypeError("Approval expiry must be after creation.");
  }
  canonicalJson(input.binding);
  const binding = structuredClone(input.binding);
  return Object.freeze({
    ...input,
    id: input.id ?? crypto.randomUUID(),
    binding: Object.freeze(binding),
    bindingHash: await fingerprintCanonicalJson(binding),
  });
}

export interface ApprovalStore {
  put(record: ApprovalRecord): Promise<void>;
  consume(
    id: string,
    kind: ApprovalKind,
    binding: ApprovalBinding,
    now?: number,
  ): Promise<ApprovalConsumeResult>;
}

function cloneRecord(record: ApprovalRecord): ApprovalRecord {
  return structuredClone(record);
}

export class InMemoryApprovalStore implements ApprovalStore {
  readonly #records = new Map<string, ApprovalRecord>();

  async put(record: ApprovalRecord): Promise<void> {
    if (this.#records.has(record.id)) {
      throw new TypeError("Approval identifier already exists.");
    }
    this.#records.set(record.id, cloneRecord(record));
  }

  async consume(
    id: string,
    kind: ApprovalKind,
    binding: ApprovalBinding,
    now = Date.now(),
  ): Promise<ApprovalConsumeResult> {
    const expectedHash = await fingerprintCanonicalJson(binding);
    // No await occurs between this read/compare/delete sequence: it is atomic
    // with respect to all callers sharing this extension worker instance.
    const record = this.#records.get(id);
    if (record === undefined) return { ok: false, reason: "missing" };
    if (record.kind !== kind || record.bindingHash !== expectedHash) {
      return { ok: false, reason: "mismatch" };
    }
    this.#records.delete(id);
    if (now >= record.expiresAt) return { ok: false, reason: "expired" };
    if (record.decision !== "approved") return { ok: false, reason: "denied" };
    return { ok: true, record: cloneRecord(record) };
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB failed."));
  });
}

/** IndexedDB transactions provide cross-task atomic compare-and-consume. */
export class IndexedDbApprovalStore implements ApprovalStore {
  readonly #database: Promise<IDBDatabase>;

  constructor(name = "agent-provider-authority-v1") {
    this.#database = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("approvals")) {
          request.result.createObjectStore("approvals", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB failed."));
    });
  }

  async put(record: ApprovalRecord): Promise<void> {
    const db = await this.#database;
    const transaction = db.transaction("approvals", "readwrite");
    transaction.objectStore("approvals").add(cloneRecord(record));
    await transactionComplete(transaction);
  }

  async consume(
    id: string,
    kind: ApprovalKind,
    binding: ApprovalBinding,
    now = Date.now(),
  ): Promise<ApprovalConsumeResult> {
    const expectedHash = await fingerprintCanonicalJson(binding);
    const db = await this.#database;
    const transaction = db.transaction("approvals", "readwrite");
    const store = transaction.objectStore("approvals");
    const record = (await requestResult(store.get(id))) as
      ApprovalRecord | undefined;
    let result: ApprovalConsumeResult;
    if (record === undefined) {
      result = { ok: false, reason: "missing" };
    } else if (record.kind !== kind || record.bindingHash !== expectedHash) {
      result = { ok: false, reason: "mismatch" };
    } else {
      store.delete(id);
      result =
        now >= record.expiresAt
          ? { ok: false, reason: "expired" }
          : record.decision === "approved"
            ? { ok: true, record: cloneRecord(record) }
            : { ok: false, reason: "denied" };
    }
    await transactionComplete(transaction);
    return result;
  }
}
