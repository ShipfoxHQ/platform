import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  min,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {alias} from 'drizzle-orm/pg-core';
import type {PostgresOutboxTable} from './schema.js';
import type {
  ClaimedOutboxEvent,
  OutboxAcknowledgeResult,
  OutboxClaimReference,
  OutboxHealth,
  OutboxRetryResult,
} from './types.js';

export interface PostgresOutboxOptions<
  TSchema extends Record<string, unknown> = Record<string, never>,
> {
  database: NodePgDatabase<TSchema>;
  table: PostgresOutboxTable;
  /** Number of claims allowed before a failed or expired delivery is dead-lettered. Defaults to 5. */
  maxAttempts?: number;
  /** Largest retry delay accepted from a caller. Defaults to 30 minutes. */
  maxRetryDelayMs?: number;
}

export interface ClaimOutboxEventsOptions {
  batchSize: number;
  leaseDurationMs: number;
  now?: Date;
}

export interface AcknowledgeOutboxEventOptions extends OutboxClaimReference {
  now?: Date;
}

export interface RetryOutboxEventOptions extends OutboxClaimReference {
  delayMs: number;
  failure: unknown;
  now?: Date;
}

export interface GetOutboxHealthOptions {
  now?: Date;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_MAX_RETRY_DELAY_MS = 30 * 60 * 1_000;

/** PostgreSQL-backed leased delivery operations for a `createPostgresOutboxTable` table. */
export class PostgresOutbox<TSchema extends Record<string, unknown> = Record<string, never>> {
  readonly #database: NodePgDatabase<TSchema>;
  readonly #table: PostgresOutboxTable;
  readonly #maxAttempts: number;
  readonly #maxRetryDelayMs: number;

  constructor(options: PostgresOutboxOptions<TSchema>) {
    this.#database = options.database;
    this.#table = options.table;
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    assertPositiveInteger(this.#maxAttempts, 'maxAttempts');
    assertNonNegativeInteger(this.#maxRetryDelayMs, 'maxRetryDelayMs');
  }

  /** Claims a deterministic bounded batch and increments each event's attempt count. */
  async claim<TPayload = unknown>(
    options: ClaimOutboxEventsOptions,
  ): Promise<Array<ClaimedOutboxEvent<TPayload>>> {
    assertPositiveInteger(options.batchSize, 'batchSize');
    assertPositiveInteger(options.leaseDurationMs, 'leaseDurationMs');
    const now = normalizeDate(options.now);

    const rows = await this.#database.transaction(async (tx) => {
      const exhausted = await tx
        .select({id: this.#table.id})
        .from(this.#table)
        .where(
          and(
            isNull(this.#table.dispatchedAt),
            isNull(this.#table.deadLetteredAt),
            gte(this.#table.dispatchAttempts, this.#maxAttempts),
            or(isNull(this.#table.leaseExpiresAt), lte(this.#table.leaseExpiresAt, now)),
          ),
        )
        .orderBy(asc(this.#table.leaseExpiresAt), asc(this.#table.createdAt), asc(this.#table.id))
        .limit(options.batchSize)
        .for('update', {skipLocked: true});
      if (exhausted.length > 0) {
        await tx
          .update(this.#table)
          .set({deadLetteredAt: now, leaseToken: null, leaseExpiresAt: null})
          .where(
            inArray(
              this.#table.id,
              exhausted.map((event) => event.id),
            ),
          );
      }

      const earlier = alias(this.#table, 'earlier_outbox');
      const candidates = await tx
        .select({id: this.#table.id})
        .from(this.#table)
        .where(
          and(
            isNull(this.#table.dispatchedAt),
            isNull(this.#table.deadLetteredAt),
            lte(this.#table.dispatchAttempts, this.#maxAttempts - 1),
            lte(this.#table.nextDispatchAt, now),
            or(isNull(this.#table.leaseExpiresAt), lte(this.#table.leaseExpiresAt, now)),
            or(
              isNull(this.#table.orderingKey),
              notExists(
                tx
                  .select({id: earlier.id})
                  .from(earlier)
                  .where(
                    and(
                      isNull(earlier.dispatchedAt),
                      isNull(earlier.deadLetteredAt),
                      eq(earlier.orderingKey, this.#table.orderingKey),
                      sql`(${earlier.createdAt}, ${earlier.id}) < (${this.#table.createdAt}, ${this.#table.id})`,
                    ),
                  ),
              ),
            ),
          ),
        )
        .orderBy(asc(this.#table.nextDispatchAt), asc(this.#table.createdAt), asc(this.#table.id))
        .limit(options.batchSize)
        .for('update', {skipLocked: true});
      if (candidates.length === 0) return [];

      return await tx
        .update(this.#table)
        .set({
          dispatchAttempts: sql`${this.#table.dispatchAttempts} + 1`,
          leaseToken: sql`gen_random_uuid()`,
          leaseExpiresAt: sql`${now}::timestamptz + (${options.leaseDurationMs} * interval '1 millisecond')`,
        })
        .where(
          inArray(
            this.#table.id,
            candidates.map((candidate) => candidate.id),
          ),
        )
        .returning({
          id: this.#table.id,
          idempotencyKey: this.#table.idempotencyKey,
          eventType: this.#table.eventType,
          orderingKey: this.#table.orderingKey,
          payload: this.#table.payload,
          createdAt: this.#table.createdAt,
          nextDispatchAt: this.#table.nextDispatchAt,
          dispatchAttempts: this.#table.dispatchAttempts,
          leaseToken: this.#table.leaseToken,
          leaseExpiresAt: this.#table.leaseExpiresAt,
        });
    });

    return rows.sort(compareClaimedRows).map((row) => ({
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      type: row.eventType,
      orderingKey: row.orderingKey,
      payload: row.payload as TPayload,
      createdAt: row.createdAt,
      attempts: row.dispatchAttempts,
      leaseToken: requireClaimValue(row.leaseToken, 'leaseToken'),
      leaseExpiresAt: requireClaimValue(row.leaseExpiresAt, 'leaseExpiresAt'),
    }));
  }

  /** Marks a delivery complete only while its lease token is current and unexpired. */
  async acknowledge(options: AcknowledgeOutboxEventOptions): Promise<OutboxAcknowledgeResult> {
    const now = normalizeDate(options.now);
    const result = await this.#database
      .update(this.#table)
      .set({dispatchedAt: now, leaseToken: null, leaseExpiresAt: null})
      .where(
        and(
          eq(this.#table.id, options.id),
          eq(this.#table.leaseToken, options.leaseToken),
          gt(this.#table.leaseExpiresAt, now),
          isNull(this.#table.dispatchedAt),
          isNull(this.#table.deadLetteredAt),
        ),
      )
      .returning({id: this.#table.id});

    return {status: result.length === 0 ? 'stale' : 'acknowledged'};
  }

  /** Records a failure and schedules a bounded retry or moves the event to dead letter. */
  async retry(options: RetryOutboxEventOptions): Promise<OutboxRetryResult> {
    assertNonNegativeInteger(options.delayMs, 'delayMs');
    const now = normalizeDate(options.now);
    const boundedDelayMs = Math.min(options.delayMs, this.#maxRetryDelayMs);
    const failure = serializeFailure(options.failure);
    const result = await this.#database
      .update(this.#table)
      .set({
        nextDispatchAt: sql`CASE
          WHEN ${this.#table.dispatchAttempts} >= ${this.#maxAttempts}
            THEN ${this.#table.nextDispatchAt}
          ELSE ${now}::timestamptz + (${boundedDelayMs} * interval '1 millisecond')
        END`,
        lastDispatchError: failure,
        lastDispatchFailedAt: now,
        deadLetteredAt: sql`CASE
          WHEN ${this.#table.dispatchAttempts} >= ${this.#maxAttempts} THEN ${now}
          ELSE ${this.#table.deadLetteredAt}
        END`,
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(this.#table.id, options.id),
          eq(this.#table.leaseToken, options.leaseToken),
          gt(this.#table.leaseExpiresAt, now),
          isNull(this.#table.dispatchedAt),
          isNull(this.#table.deadLetteredAt),
        ),
      )
      .returning({
        deadLetteredAt: this.#table.deadLetteredAt,
        nextDispatchAt: this.#table.nextDispatchAt,
      });
    const row = result[0];
    if (!row) return {status: 'stale'};
    if (row.deadLetteredAt) return {status: 'dead-lettered'};
    return {status: 'retry-scheduled', nextAttemptAt: new Date(row.nextDispatchAt)};
  }

  /** Reads the pending count and oldest pending event age. Database failures reject the call. */
  async health(options: GetOutboxHealthOptions = {}): Promise<OutboxHealth> {
    const now = normalizeDate(options.now);
    const result = await this.#database
      .select({pendingCount: count(), oldestPendingAt: min(this.#table.createdAt)})
      .from(this.#table)
      .where(and(isNull(this.#table.dispatchedAt), isNull(this.#table.deadLetteredAt)));
    const row = result[0] ?? {pendingCount: 0, oldestPendingAt: null};
    const oldestPendingAt = row.oldestPendingAt ? new Date(row.oldestPendingAt) : undefined;

    return {
      status: 'ready',
      checkedAt: now,
      pendingCount: row.pendingCount,
      ...(oldestPendingAt
        ? {
            oldestPendingAt,
            oldestPendingAgeMs: Math.max(0, now.getTime() - oldestPendingAt.getTime()),
          }
        : {}),
    };
  }
}

export function createPostgresOutbox<TSchema extends Record<string, unknown>>(
  options: PostgresOutboxOptions<TSchema>,
): PostgresOutbox<TSchema> {
  return new PostgresOutbox(options);
}

function compareClaimedRows(
  left: {id: string; nextDispatchAt: Date; createdAt: Date},
  right: {id: string; nextDispatchAt: Date; createdAt: Date},
): number {
  const availableDelta =
    new Date(left.nextDispatchAt).getTime() - new Date(right.nextDispatchAt).getTime();
  if (availableDelta !== 0) return availableDelta;
  const createdDelta = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  return createdDelta === 0 ? left.id.localeCompare(right.id) : createdDelta;
}

function normalizeDate(value: Date | undefined): Date {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error('now must be a valid date');
  return date;
}

function requireClaimValue<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`Claimed outbox event is missing ${name}`);
  return value;
}

function serializeFailure(failure: unknown): unknown {
  return toJsonSafe(failure, new WeakSet<object>());
}

function toJsonSafe(value: unknown, ancestors: WeakSet<object>): unknown {
  const primitive = serializePrimitive(value);
  if (primitive.handled) return primitive.value;
  const objectValue = primitive.value;

  try {
    if (objectValue instanceof Date) {
      return Number.isNaN(objectValue.getTime()) ? String(objectValue) : objectValue.toISOString();
    }
    if (ancestors.has(objectValue)) return '[Circular]';
    ancestors.add(objectValue);

    let serialized: unknown;
    if (objectValue instanceof Error) serialized = serializeError(objectValue, ancestors);
    else if (Array.isArray(objectValue)) {
      serialized = objectValue.map((item) => toJsonSafe(item, ancestors));
    } else serialized = serializeObject(objectValue, ancestors);
    ancestors.delete(objectValue);
    return serialized;
  } catch (_error) {
    ancestors.delete(objectValue);
    return '[Unserializable]';
  }
}

function serializePrimitive(
  value: unknown,
): {handled: true; value: unknown} | {handled: false; value: object} {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return {handled: true, value};
  }
  if (typeof value === 'number') {
    return {handled: true, value: Number.isFinite(value) ? value : String(value)};
  }
  if (typeof value === 'bigint') return {handled: true, value: value.toString()};
  if (typeof value === 'undefined') return {handled: true, value: null};
  if (typeof value === 'symbol' || typeof value === 'function') {
    try {
      return {handled: true, value: String(value)};
    } catch (_error) {
      return {handled: true, value: '[Unserializable]'};
    }
  }
  return {handled: false, value};
}

function serializeError(error: Error, ancestors: WeakSet<object>): Record<string, unknown> {
  const properties = serializeObject(error, ancestors);
  return {
    ...properties,
    name: error.name,
    message: error.message,
    ...(error.stack ? {stack: error.stack} : {}),
    ...(error.cause !== undefined ? {cause: toJsonSafe(error.cause, ancestors)} : {}),
  };
}

function serializeObject(value: object, ancestors: WeakSet<object>): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    try {
      defineOwnProperty(
        serialized,
        key,
        toJsonSafe((value as Record<string, unknown>)[key], ancestors),
      );
    } catch (_error) {
      defineOwnProperty(serialized, key, '[Unserializable]');
    }
  }
  return serialized;
}

function defineOwnProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
