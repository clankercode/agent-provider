export interface QuotaLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerDay: number;
  costMicrosPerDay?: number;
  allowUnknownPricing: boolean;
}

export interface QuotaReservationRequest {
  id?: string;
  scope: string;
  estimatedTokens: number;
  estimatedCostMicros?: number;
  pricingKnown: boolean;
  now?: number;
}

export interface QuotaReservation {
  readonly id: string;
  readonly scope: string;
  readonly reservedAt: number;
  readonly estimatedTokens: number;
  readonly estimatedCostMicros?: number;
}

export interface SettledUsage {
  scope: string;
  timestamp: number;
  tokens: number;
  costMicros?: number;
}

export interface QuotaSnapshot {
  reservations: readonly QuotaReservation[];
  settled: readonly SettledUsage[];
}

export class QuotaExceededError extends Error {
  readonly dimension: "requests-minute" | "requests-day" | "tokens" | "cost";

  constructor(dimension: QuotaExceededError["dimension"]) {
    super(`Quota reservation exceeds the ${dimension} limit.`);
    this.name = "QuotaExceededError";
    this.dimension = dimension;
  }
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const MINUTE_MS = 60 * 1_000;

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative finite number.`);
  }
  return Math.ceil(value);
}

/** In-memory atomic authority ledger; persist snapshots from the owning worker. */
export class QuotaLedger {
  readonly #reservations = new Map<string, QuotaReservation>();
  readonly #limits: Readonly<QuotaLimits>;
  #settled: SettledUsage[] = [];

  constructor(
    limits: Readonly<QuotaLimits>,
    snapshot: Readonly<QuotaSnapshot> = { reservations: [], settled: [] },
  ) {
    for (const [field, value] of Object.entries({
      requestsPerMinute: limits.requestsPerMinute,
      requestsPerDay: limits.requestsPerDay,
      tokensPerDay: limits.tokensPerDay,
      ...(limits.costMicrosPerDay === undefined
        ? {}
        : { costMicrosPerDay: limits.costMicrosPerDay }),
    })) {
      if (!Number.isFinite(value) || value < 0) {
        throw new TypeError(`Quota limit ${field} must be non-negative.`);
      }
    }
    this.#limits = Object.freeze({ ...limits });
    for (const reservation of snapshot.reservations) {
      if (
        typeof reservation.id !== "string" ||
        reservation.id.length === 0 ||
        typeof reservation.scope !== "string" ||
        reservation.scope.length === 0 ||
        !Number.isFinite(reservation.reservedAt) ||
        reservation.reservedAt < 0
      ) {
        throw new TypeError("Quota reservation snapshot is invalid.");
      }
      const safe: QuotaReservation = Object.freeze({
        id: reservation.id,
        scope: reservation.scope,
        reservedAt: reservation.reservedAt,
        estimatedTokens: nonNegativeInteger(
          reservation.estimatedTokens,
          "estimatedTokens",
        ),
        ...(reservation.estimatedCostMicros === undefined
          ? {}
          : {
              estimatedCostMicros: nonNegativeInteger(
                reservation.estimatedCostMicros,
                "estimatedCostMicros",
              ),
            }),
      });
      if (this.#reservations.has(safe.id)) {
        throw new TypeError("Quota reservation snapshot contains duplicates.");
      }
      this.#reservations.set(safe.id, safe);
    }
    this.#settled = snapshot.settled.map((usage) => {
      if (
        typeof usage.scope !== "string" ||
        usage.scope.length === 0 ||
        !Number.isFinite(usage.timestamp) ||
        usage.timestamp < 0
      ) {
        throw new TypeError("Settled quota snapshot is invalid.");
      }
      return {
        scope: usage.scope,
        timestamp: usage.timestamp,
        tokens: nonNegativeInteger(usage.tokens, "tokens"),
        ...(usage.costMicros === undefined
          ? {}
          : {
              costMicros: nonNegativeInteger(usage.costMicros, "costMicros"),
            }),
      };
    });
  }

  reserve(request: QuotaReservationRequest): QuotaReservation {
    const now = request.now ?? Date.now();
    const estimatedTokens = nonNegativeInteger(
      request.estimatedTokens,
      "estimatedTokens",
    );
    const estimatedCostMicros =
      request.estimatedCostMicros === undefined
        ? undefined
        : nonNegativeInteger(
            request.estimatedCostMicros,
            "estimatedCostMicros",
          );
    if (
      this.#limits.costMicrosPerDay !== undefined &&
      !request.pricingKnown &&
      !this.#limits.allowUnknownPricing
    ) {
      throw new QuotaExceededError("cost");
    }
    if (
      this.#limits.costMicrosPerDay !== undefined &&
      request.pricingKnown &&
      estimatedCostMicros === undefined
    ) {
      throw new TypeError(
        "Known pricing requires an estimated cost reservation.",
      );
    }
    this.#prune(now);
    const scopeReservations = [...this.#reservations.values()].filter(
      (item) => item.scope === request.scope,
    );
    const scopeSettled = this.#settled.filter(
      (item) => item.scope === request.scope,
    );
    const minuteRequests =
      scopeReservations.filter((item) => item.reservedAt > now - MINUTE_MS)
        .length +
      scopeSettled.filter((item) => item.timestamp > now - MINUTE_MS).length;
    const dayRequests = scopeReservations.length + scopeSettled.length;
    if (minuteRequests + 1 > this.#limits.requestsPerMinute) {
      throw new QuotaExceededError("requests-minute");
    }
    if (dayRequests + 1 > this.#limits.requestsPerDay) {
      throw new QuotaExceededError("requests-day");
    }
    const tokens =
      scopeReservations.reduce(
        (total, item) => total + item.estimatedTokens,
        0,
      ) + scopeSettled.reduce((total, item) => total + item.tokens, 0);
    if (tokens + estimatedTokens > this.#limits.tokensPerDay) {
      throw new QuotaExceededError("tokens");
    }
    if (this.#limits.costMicrosPerDay !== undefined) {
      const cost =
        scopeReservations.reduce(
          (total, item) => total + (item.estimatedCostMicros ?? 0),
          0,
        ) +
        scopeSettled.reduce((total, item) => total + (item.costMicros ?? 0), 0);
      if (cost + (estimatedCostMicros ?? 0) > this.#limits.costMicrosPerDay) {
        throw new QuotaExceededError("cost");
      }
    }

    const id = request.id ?? crypto.randomUUID();
    if (this.#reservations.has(id)) {
      throw new TypeError("Quota reservation identifier already exists.");
    }
    const reservation: QuotaReservation = Object.freeze({
      id,
      scope: request.scope,
      reservedAt: now,
      estimatedTokens,
      ...(estimatedCostMicros === undefined ? {} : { estimatedCostMicros }),
    });
    this.#reservations.set(id, reservation);
    return reservation;
  }

  settle(
    reservationId: string,
    actual: { tokens: number; costMicros?: number; now?: number },
  ): void {
    const reservation = this.#reservations.get(reservationId);
    if (reservation === undefined) {
      throw new TypeError("Quota reservation is missing or already settled.");
    }
    const tokens = nonNegativeInteger(actual.tokens, "tokens");
    const costMicros =
      actual.costMicros === undefined
        ? undefined
        : nonNegativeInteger(actual.costMicros, "costMicros");
    this.#reservations.delete(reservationId);
    this.#settled.push({
      scope: reservation.scope,
      timestamp: actual.now ?? Date.now(),
      tokens,
      ...(costMicros === undefined ? {} : { costMicros }),
    });
  }

  /** Releases work proven not to have dispatched; it consumes no quota. */
  release(reservationId: string): boolean {
    return this.#reservations.delete(reservationId);
  }

  /** Conservatively charges abandoned reservations after a worker restart. */
  reconcileUnknownOutcomes(now = Date.now()): readonly QuotaReservation[] {
    const unknown = [...this.#reservations.values()];
    for (const reservation of unknown) {
      this.#reservations.delete(reservation.id);
      this.#settled.push({
        scope: reservation.scope,
        timestamp: now,
        tokens: reservation.estimatedTokens,
        ...(reservation.estimatedCostMicros === undefined
          ? {}
          : { costMicros: reservation.estimatedCostMicros }),
      });
    }
    return Object.freeze(unknown.map((item) => Object.freeze({ ...item })));
  }

  snapshot(now = Date.now()): Readonly<QuotaSnapshot> {
    this.#prune(now);
    return Object.freeze({
      reservations: Object.freeze([...this.#reservations.values()]),
      settled: Object.freeze(
        this.#settled.map((item) => Object.freeze({ ...item })),
      ),
    });
  }

  #prune(now: number): void {
    this.#settled = this.#settled.filter(
      (item) => item.timestamp > now - DAY_MS,
    );
    for (const [id, reservation] of this.#reservations) {
      if (reservation.reservedAt <= now - DAY_MS) this.#reservations.delete(id);
    }
  }
}
