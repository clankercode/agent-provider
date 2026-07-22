import { browser } from "wxt/browser";
import {
  QuotaLedger,
  type QuotaLimits,
  type QuotaReservation,
  type QuotaReservationRequest,
  type QuotaSnapshot,
} from "./quotas.js";

const QUOTA_STATE_KEY = "agent-provider.quota-state.v1";

export interface QuotaStateStore {
  load(): Promise<unknown>;
  save(snapshot: Readonly<QuotaSnapshot>): Promise<void>;
}

export class BrowserQuotaStateStore implements QuotaStateStore {
  async load(): Promise<unknown> {
    const stored = await browser.storage.local.get(QUOTA_STATE_KEY);
    return stored[QUOTA_STATE_KEY];
  }

  async save(snapshot: Readonly<QuotaSnapshot>): Promise<void> {
    await browser.storage.local.set({
      [QUOTA_STATE_KEY]: structuredClone(snapshot),
    });
  }
}

export class InMemoryQuotaStateStore implements QuotaStateStore {
  #snapshot: unknown;

  constructor(snapshot?: unknown) {
    this.#snapshot = structuredClone(snapshot);
  }

  async load(): Promise<unknown> {
    return structuredClone(this.#snapshot);
  }

  async save(snapshot: Readonly<QuotaSnapshot>): Promise<void> {
    this.#snapshot = structuredClone(snapshot);
  }
}

function snapshotFrom(value: unknown): QuotaSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { reservations: [], settled: [] };
  }
  const record = value as Record<string, unknown>;
  return {
    reservations: Array.isArray(record.reservations)
      ? (record.reservations as QuotaSnapshot["reservations"])
      : [],
    settled: Array.isArray(record.settled)
      ? (record.settled as QuotaSnapshot["settled"])
      : [],
  };
}

/** Serializes reserve/settle persistence across every connected tab. */
export class PersistentQuotaManager {
  #tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: QuotaStateStore = new BrowserQuotaStateStore(),
  ) {}

  async recoverUnknownOutcomes(
    limits: Readonly<QuotaLimits>,
    now = Date.now(),
  ): Promise<readonly QuotaReservation[]> {
    return this.#serialized(async () => {
      const ledger = await this.#load(limits);
      const recovered = ledger.reconcileUnknownOutcomes(now);
      await this.store.save(ledger.snapshot(now));
      return recovered;
    });
  }

  async reserve(
    limits: Readonly<QuotaLimits>,
    request: QuotaReservationRequest,
  ): Promise<QuotaReservation> {
    return this.#serialized(async () => {
      const ledger = await this.#load(limits);
      const reservation = ledger.reserve(request);
      await this.store.save(ledger.snapshot(request.now));
      return reservation;
    });
  }

  async settle(
    limits: Readonly<QuotaLimits>,
    reservationId: string,
    actual: { tokens: number; costMicros?: number; now?: number },
  ): Promise<void> {
    await this.#serialized(async () => {
      const ledger = await this.#load(limits);
      ledger.settle(reservationId, actual);
      await this.store.save(ledger.snapshot(actual.now));
    });
  }

  async release(
    limits: Readonly<QuotaLimits>,
    reservationId: string,
    now = Date.now(),
  ): Promise<boolean> {
    return this.#serialized(async () => {
      const ledger = await this.#load(limits);
      const released = ledger.release(reservationId);
      await this.store.save(ledger.snapshot(now));
      return released;
    });
  }

  async snapshot(
    limits: Readonly<QuotaLimits>,
    now = Date.now(),
  ): Promise<Readonly<QuotaSnapshot>> {
    return this.#serialized(async () => {
      const ledger = await this.#load(limits);
      const snapshot = ledger.snapshot(now);
      await this.store.save(snapshot);
      return snapshot;
    });
  }

  async #load(limits: Readonly<QuotaLimits>): Promise<QuotaLedger> {
    return new QuotaLedger(limits, snapshotFrom(await this.store.load()));
  }

  #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
