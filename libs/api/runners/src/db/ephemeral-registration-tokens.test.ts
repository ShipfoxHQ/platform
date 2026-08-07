import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {and, eq, inArray} from 'drizzle-orm';
import {
  ActiveEphemeralRegistrationTokensExistError,
  type RegistrationTokenBatchExceedsReservationError,
  ReservationNotFoundError,
} from '#core/errors.js';
import {db} from '#db/db.js';
import {
  createEphemeralRegistrationTokensBatch,
  deleteExpiredEphemeralRegistrationTokens,
  resolveEphemeralRegistrationTokenByHash,
} from '#db/ephemeral-registration-tokens.js';
import {ephemeralRegistrationTokens} from '#db/schema/ephemeral-registration-tokens.js';
import {reservations} from '#db/schema/reservations.js';
import {ephemeralRegistrationTokenFactory} from '#test/index.js';

describe('createEphemeralRegistrationTokensBatch', () => {
  let workspaceId: string;
  let provisionerId: string;
  let reservationId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
    reservationId = await createReservation({count: 3});
  });

  it('persists all rows for the reservation in one batch', async () => {
    const rawTokens = [
      generateOpaqueToken('ephemeralRegistrationToken'),
      generateOpaqueToken('ephemeralRegistrationToken'),
    ];
    const expiresAt = new Date(Date.now() + 300_000);

    const result = await createEphemeralRegistrationTokensBatch({
      workspaceId,
      provisionerId,
      reservationId,
      expiresAt,
      rows: [
        row('provisioned-runner-a', rawTokens[0] ?? ''),
        row('provisioned-runner-b', rawTokens[1] ?? ''),
      ],
    });

    expect(result).toHaveLength(2);
    expect(result.map((token) => token.providerRunnerId).sort()).toEqual([
      'provisioned-runner-a',
      'provisioned-runner-b',
    ]);
    expect(result.every((token) => token.reservationId === reservationId)).toBe(true);
    expect(result.every((token) => token.workspaceId === workspaceId)).toBe(true);
    expect(result.every((token) => token.provisionerId === provisionerId)).toBe(true);
    expect(
      await resolveEphemeralRegistrationTokenByHash(hashOpaqueToken(rawTokens[0] ?? '')),
    ).toEqual(expect.objectContaining({providerRunnerId: 'provisioned-runner-a'}));
  });

  it('rejects bound reservations', async () => {
    const boundReservationId = await createReservation({count: 1, kind: 'bound'});

    await expect(
      createEphemeralRegistrationTokensBatch({
        workspaceId,
        provisionerId,
        reservationId: boundReservationId,
        expiresAt: new Date(Date.now() + 300_000),
        rows: [row('bound-runner', generateOpaqueToken('ephemeralRegistrationToken'))],
      }),
    ).rejects.toBeInstanceOf(ReservationNotFoundError);
  });

  it('rejects the batch and inserts no rows when any provisioned runner already has an active token', async () => {
    await ephemeralRegistrationTokenFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-a',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const rawToken = generateOpaqueToken('ephemeralRegistrationToken');

    await expect(
      createEphemeralRegistrationTokensBatch({
        workspaceId,
        provisionerId,
        reservationId,
        expiresAt: new Date(Date.now() + 300_000),
        rows: [row('provisioned-runner-a', rawToken), row('provisioned-runner-b', rawToken)],
      }),
    ).rejects.toBeInstanceOf(ActiveEphemeralRegistrationTokensExistError);

    const rows = await db()
      .select()
      .from(ephemeralRegistrationTokens)
      .where(
        and(
          eq(ephemeralRegistrationTokens.workspaceId, workspaceId),
          eq(ephemeralRegistrationTokens.provisionerId, provisionerId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.providerRunnerId).toBe('provisioned-runner-a');
  });

  it('allows sequential batches that exactly reach the reservation count', async () => {
    const expiresAt = new Date(Date.now() + 300_000);

    await createEphemeralRegistrationTokensBatch({
      workspaceId,
      provisionerId,
      reservationId,
      expiresAt,
      rows: [
        row('provisioned-runner-a', generateOpaqueToken('ephemeralRegistrationToken')),
        row('provisioned-runner-b', generateOpaqueToken('ephemeralRegistrationToken')),
      ],
    });
    const result = await createEphemeralRegistrationTokensBatch({
      workspaceId,
      provisionerId,
      reservationId,
      expiresAt,
      rows: [row('provisioned-runner-c', generateOpaqueToken('ephemeralRegistrationToken'))],
    });

    expect(result).toHaveLength(1);
    expect(await countReservationTokens()).toBe(3);
  });

  it('rejects sequential batches that cumulatively exceed the reservation count', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    await createEphemeralRegistrationTokensBatch({
      workspaceId,
      provisionerId,
      reservationId,
      expiresAt,
      rows: [
        row('provisioned-runner-a', generateOpaqueToken('ephemeralRegistrationToken')),
        row('provisioned-runner-b', generateOpaqueToken('ephemeralRegistrationToken')),
      ],
    });

    await expect(
      createEphemeralRegistrationTokensBatch({
        workspaceId,
        provisionerId,
        reservationId,
        expiresAt,
        rows: [
          row('provisioned-runner-c', generateOpaqueToken('ephemeralRegistrationToken')),
          row('provisioned-runner-d', generateOpaqueToken('ephemeralRegistrationToken')),
        ],
      }),
    ).rejects.toMatchObject({
      name: 'RegistrationTokenBatchExceedsReservationError',
      requested: 2,
      reservationCount: 3,
      alreadyMinted: 2,
    } satisfies Partial<RegistrationTokenBatchExceedsReservationError>);

    expect(await countReservationTokens()).toBe(2);
  });

  it('counts consumed and expired tokens against the reservation total', async () => {
    const consumed = await ephemeralRegistrationTokenFactory.create({
      workspaceId,
      provisionerId,
      reservationId,
      providerRunnerId: 'provisioned-runner-consumed',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db()
      .update(ephemeralRegistrationTokens)
      .set({consumedAt: new Date()})
      .where(eq(ephemeralRegistrationTokens.id, consumed.id));
    await ephemeralRegistrationTokenFactory.create({
      workspaceId,
      provisionerId,
      reservationId,
      providerRunnerId: 'provisioned-runner-expired',
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      createEphemeralRegistrationTokensBatch({
        workspaceId,
        provisionerId,
        reservationId,
        expiresAt: new Date(Date.now() + 300_000),
        rows: [
          row('provisioned-runner-a', generateOpaqueToken('ephemeralRegistrationToken')),
          row('provisioned-runner-b', generateOpaqueToken('ephemeralRegistrationToken')),
        ],
      }),
    ).rejects.toMatchObject({
      name: 'RegistrationTokenBatchExceedsReservationError',
      requested: 2,
      reservationCount: 3,
      alreadyMinted: 2,
    } satisfies Partial<RegistrationTokenBatchExceedsReservationError>);
  });

  async function createReservation(params: {
    count: number;
    kind?: 'bound' | 'launch';
  }): Promise<string> {
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: params.count,
        kind: params.kind ?? 'launch',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({id: reservations.id});
    if (!reservation) throw new Error('Insert returned no rows');
    return reservation.id;
  }

  async function countReservationTokens(): Promise<number> {
    const rows = await db()
      .select()
      .from(ephemeralRegistrationTokens)
      .where(eq(ephemeralRegistrationTokens.reservationId, reservationId));
    return rows.length;
  }

  function row(providerRunnerId: string, rawToken: string) {
    return {
      providerRunnerId,
      hashedToken: hashOpaqueToken(rawToken),
      prefix: extractDisplayPrefix(rawToken),
    };
  }
});

describe('deleteExpiredEphemeralRegistrationTokens', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('deletes consumed tokens whose consumption is older than the retention window', async () => {
    const stale = await insertToken({consumedAt: daysAgo(8), expiresAt: daysAgo(8)});
    const fresh = await insertToken({consumedAt: daysAgo(6), expiresAt: daysAgo(6)});

    const deleted = await deleteExpiredEphemeralRegistrationTokens({retentionDays: 7, limit: 100});

    const remaining = await listTokenIds([stale, fresh]);
    expect(deleted).toBe(1);
    expect(remaining).toEqual([fresh]);
  });

  it('deletes expired unconsumed tokens older than the retention window', async () => {
    const stale = await insertToken({consumedAt: null, expiresAt: daysAgo(8)});
    const fresh = await insertToken({consumedAt: null, expiresAt: daysAgo(6)});

    const deleted = await deleteExpiredEphemeralRegistrationTokens({retentionDays: 7, limit: 100});

    const remaining = await listTokenIds([stale, fresh]);
    expect(deleted).toBe(1);
    expect(remaining).toEqual([fresh]);
  });

  it('keeps active tokens that are neither consumed nor expired', async () => {
    const active = await insertToken({consumedAt: null, expiresAt: daysFromNow(1)});

    const deleted = await deleteExpiredEphemeralRegistrationTokens({retentionDays: 7, limit: 100});

    const remaining = await listTokenIds([active]);
    expect(deleted).toBe(0);
    expect(remaining).toEqual([active]);
  });

  it('keeps recently consumed tokens even when their expiry has already passed', async () => {
    const recentlyConsumed = await insertToken({consumedAt: daysAgo(1), expiresAt: daysAgo(6)});

    const deleted = await deleteExpiredEphemeralRegistrationTokens({retentionDays: 7, limit: 100});

    const remaining = await listTokenIds([recentlyConsumed]);
    expect(deleted).toBe(0);
    expect(remaining).toEqual([recentlyConsumed]);
  });

  it('honors the deletion limit', async () => {
    const first = await insertToken({consumedAt: daysAgo(30), expiresAt: daysAgo(30)});
    const second = await insertToken({consumedAt: daysAgo(20), expiresAt: daysAgo(20)});
    const third = await insertToken({consumedAt: daysAgo(10), expiresAt: daysAgo(10)});

    const deleted = await deleteExpiredEphemeralRegistrationTokens({retentionDays: 7, limit: 2});

    const remaining = await listTokenIds([first, second, third]);
    expect(deleted).toBe(2);
    expect(remaining).toEqual([third]);
  });

  function daysAgo(days: number): Date {
    return new Date(Date.now() - days * DAY_MS);
  }

  function daysFromNow(days: number): Date {
    return new Date(Date.now() + days * DAY_MS);
  }

  async function insertToken(params: {
    consumedAt: Date | null;
    expiresAt: Date;
    createdAt?: Date;
  }): Promise<string> {
    const id = crypto.randomUUID();

    await db()
      .insert(ephemeralRegistrationTokens)
      .values({
        id,
        workspaceId,
        provisionerId,
        providerRunnerId: `provisioned-${id}`,
        hashedToken: crypto.randomUUID(),
        prefix: 'sfxr_test',
        expiresAt: params.expiresAt,
        consumedAt: params.consumedAt,
        createdAt: params.createdAt ?? params.expiresAt,
      });

    return id;
  }

  async function listTokenIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];

    const rows = await db()
      .select({id: ephemeralRegistrationTokens.id})
      .from(ephemeralRegistrationTokens)
      .where(
        and(
          eq(ephemeralRegistrationTokens.workspaceId, workspaceId),
          inArray(ephemeralRegistrationTokens.id, ids),
        ),
      );

    return ids.filter((id) => rows.some((row) => row.id === id));
  }
});
