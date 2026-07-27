import type {AdminRole} from '@shipfox/api-auth-dto';
import type {
  AdministrationActionEvent,
  AdministrationActionEventMap,
} from '@shipfox/api-common-dto';
import {
  paginateTimestampIdRows,
  type TimestampIdCursor,
  timestampIdCursorWhere,
} from '@shipfox/node-drizzle';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, desc, eq, isNull, sql} from 'drizzle-orm';
import {highestAdminRole} from '#core/admin-role-model.js';
import type {AdminGrant} from '#core/entities/admin-grant.js';
import type {AdministratorGrantSummary} from '#core/entities/administrator-read-model.js';
import {
  AdminBootstrapClosedError,
  AdminGrantAlreadyExistsError,
  AdminGrantNotFoundError,
  AdminIdempotencyKeyReuseError,
  LastAdminOwnerError,
  UserNotFoundError,
} from '#core/errors.js';
import {db} from './db.js';
import {
  type AdminCommandResultDb,
  adminCommandResults,
  type StoredAdminGrant,
} from './schema/admin-command-results.js';
import {adminGrants, toAdminGrant} from './schema/admin-grants.js';
import {authOutbox} from './schema/outbox.js';
import {users} from './schema/users.js';

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

export interface CreateAdminGrantParams {
  userId: string;
  role: AdminRole;
}

export async function createAdminGrant(params: CreateAdminGrantParams): Promise<AdminGrant> {
  const rows = await db()
    .insert(adminGrants)
    .values({userId: params.userId, role: params.role})
    .returning();
  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toAdminGrant(row);
}

export interface AdministratorGrantSummaryRecord {
  id: string;
  role: AdminRole;
  createdAt: Date;
  revokedAt: Date | null;
  user: AdministratorGrantSummary['user'];
}

export async function listAdminGrantSummaries(params: {
  limit: number;
  cursor?: TimestampIdCursor;
}): Promise<{
  rows: AdministratorGrantSummaryRecord[];
  nextCursor: TimestampIdCursor | null;
}> {
  const cursorCondition = timestampIdCursorWhere({
    timestampColumn: adminGrants.createdAt,
    idColumn: adminGrants.id,
    cursor: params.cursor,
  });
  const conditions = cursorCondition ? [cursorCondition] : [];
  const rows = await db()
    .select({
      id: adminGrants.id,
      role: adminGrants.role,
      createdAt: adminGrants.createdAt,
      revokedAt: adminGrants.revokedAt,
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
        status: users.status,
      },
    })
    .from(adminGrants)
    .innerJoin(users, eq(adminGrants.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(adminGrants.createdAt), desc(adminGrants.id))
    .limit(params.limit + 1);

  const page = paginateTimestampIdRows({rows, limit: params.limit, timestampKey: 'createdAt'});
  return {
    rows: page.pageRows,
    nextCursor: page.nextCursor,
  };
}

export async function findCurrentAdminRole(params: {userId: string}): Promise<AdminRole | null> {
  const rows = await db()
    .select({role: adminGrants.role})
    .from(adminGrants)
    .innerJoin(users, eq(adminGrants.userId, users.id))
    .where(
      and(
        eq(adminGrants.userId, params.userId),
        isNull(adminGrants.revokedAt),
        eq(users.status, 'active'),
      ),
    );

  return highestAdminRole(rows.map(({role}) => role));
}

export async function revokeAdminGrant(params: {grantId: string}): Promise<AdminGrant | undefined> {
  return await db().transaction(async (tx) => {
    // All owner grant changes share one lock so concurrent revocations cannot
    // both observe the same final owner and leave the instance ownerless.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('auth_admin_owner_grants'))`);

    const rows = await tx
      .select()
      .from(adminGrants)
      .where(and(eq(adminGrants.id, params.grantId), isNull(adminGrants.revokedAt)))
      .limit(1);
    const grant = rows[0];
    if (!grant) return undefined;

    if (grant.role === 'admin-owner') {
      const activeOwners = await tx
        .select({id: adminGrants.id})
        .from(adminGrants)
        .innerJoin(users, eq(adminGrants.userId, users.id))
        .where(
          and(
            eq(adminGrants.role, 'admin-owner'),
            isNull(adminGrants.revokedAt),
            eq(users.status, 'active'),
          ),
        );
      if (activeOwners.length <= 1) throw new LastAdminOwnerError();
    }

    const updated = await tx
      .update(adminGrants)
      .set({revokedAt: new Date(), updatedAt: new Date()})
      .where(and(eq(adminGrants.id, grant.id), isNull(adminGrants.revokedAt)))
      .returning();
    const row = updated[0];
    return row ? toAdminGrant(row) : undefined;
  });
}

interface AuditedAdminCommandParams {
  actorId: string;
  idempotencyKeyFingerprint: string;
  requestFingerprint: string;
  event: AdministrationActionEvent;
}

function toStoredAdminGrant(grant: AdminGrant): StoredAdminGrant {
  return {
    id: grant.id,
    userId: grant.userId,
    role: grant.role,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  };
}

function fromStoredAdminGrant(grant: StoredAdminGrant): AdminGrant {
  return {
    id: grant.id,
    userId: grant.userId,
    role: grant.role,
    revokedAt: grant.revokedAt ? new Date(grant.revokedAt) : null,
    createdAt: new Date(grant.createdAt),
    updatedAt: new Date(grant.updatedAt),
  };
}

async function findCommandResult(
  tx: Tx,
  params: Pick<
    AuditedAdminCommandParams,
    'actorId' | 'idempotencyKeyFingerprint' | 'requestFingerprint'
  > & {
    command: string;
  },
): Promise<AdminGrant | undefined> {
  const rows = await tx
    .select()
    .from(adminCommandResults)
    .where(
      and(
        eq(adminCommandResults.actorId, params.actorId),
        eq(adminCommandResults.idempotencyKeyFingerprint, params.idempotencyKeyFingerprint),
      ),
    )
    .limit(1);
  const result: AdminCommandResultDb | undefined = rows[0];
  if (!result) return undefined;
  if (
    result.command !== params.command ||
    result.requestFingerprint !== params.requestFingerprint
  ) {
    throw new AdminIdempotencyKeyReuseError();
  }
  return fromStoredAdminGrant(result.result.grant);
}

async function storeCommandResult(
  tx: Tx,
  params: AuditedAdminCommandParams,
  grant: AdminGrant,
): Promise<void> {
  await tx.insert(adminCommandResults).values({
    actorId: params.actorId,
    idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
    command: params.event.command,
    requestFingerprint: params.requestFingerprint,
    result: {grant: toStoredAdminGrant(grant)},
  });
}

async function writeAdminAction(tx: Tx, event: AdministrationActionEvent): Promise<void> {
  await writeOutboxEvent<AdministrationActionEventMap>(tx, authOutbox, {
    type: 'administration.action.performed',
    payload: event,
  });
}

async function lockAdminCommand(
  tx: Tx,
  params: {actorId: string; idempotencyKeyFingerprint: string},
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`auth_admin_command:${params.actorId}:${params.idempotencyKeyFingerprint}`}))`,
  );
}

export async function bootstrapFirstAdminOwner(
  params: AuditedAdminCommandParams & {userId: string},
): Promise<AdminGrant> {
  return await db().transaction(async (tx) => {
    await lockAdminCommand(tx, params);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('auth_admin_owner_grants'))`);

    const existing = await findCommandResult(tx, {
      ...params,
      command: params.event.command,
    });
    if (existing) return existing;

    const activeOwners = await tx
      .select({id: adminGrants.id})
      .from(adminGrants)
      .innerJoin(users, eq(adminGrants.userId, users.id))
      .where(
        and(
          eq(adminGrants.role, 'admin-owner'),
          isNull(adminGrants.revokedAt),
          eq(users.status, 'active'),
        ),
      )
      .limit(1);
    if (activeOwners.length > 0) throw new AdminBootstrapClosedError();

    const userRows = await tx
      .select({id: users.id, status: users.status})
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    const user = userRows[0];
    if (user?.status !== 'active') throw new UserNotFoundError(params.userId);

    const rows = await tx
      .insert(adminGrants)
      .values({userId: params.userId, role: 'admin-owner'})
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Bootstrap grant insert returned no rows');

    const grant = toAdminGrant(row);
    await writeAdminAction(tx, params.event);
    await storeCommandResult(tx, params, grant);
    return grant;
  });
}

export async function grantAdminRoleWithAudit(
  params: AuditedAdminCommandParams & {userId: string; role: AdminRole},
): Promise<AdminGrant> {
  return await db().transaction(async (tx) => {
    await lockAdminCommand(tx, params);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('auth_admin_owner_grants'))`);

    const existing = await findCommandResult(tx, {
      ...params,
      command: params.event.command,
    });
    if (existing) return existing;

    const userRows = await tx
      .select({id: users.id, status: users.status})
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    const user = userRows[0];
    if (user?.status !== 'active') throw new UserNotFoundError(params.userId);

    const activeRows = await tx
      .select({id: adminGrants.id})
      .from(adminGrants)
      .where(
        and(
          eq(adminGrants.userId, params.userId),
          eq(adminGrants.role, params.role),
          isNull(adminGrants.revokedAt),
        ),
      )
      .limit(1);
    if (activeRows.length > 0) throw new AdminGrantAlreadyExistsError();

    const rows = await tx
      .insert(adminGrants)
      .values({userId: params.userId, role: params.role})
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Administrator grant insert returned no rows');

    const grant = toAdminGrant(row);
    await writeAdminAction(tx, params.event);
    await storeCommandResult(tx, params, grant);
    return grant;
  });
}

export async function revokeAdminGrantWithAudit(
  params: AuditedAdminCommandParams & {grantId: string},
): Promise<AdminGrant> {
  return await db().transaction(async (tx) => {
    await lockAdminCommand(tx, params);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('auth_admin_owner_grants'))`);

    const existing = await findCommandResult(tx, {
      ...params,
      command: params.event.command,
    });
    if (existing) return existing;

    const rows = await tx
      .select()
      .from(adminGrants)
      .where(and(eq(adminGrants.id, params.grantId), isNull(adminGrants.revokedAt)))
      .limit(1);
    const grant = rows[0];
    if (!grant) throw new AdminGrantNotFoundError();

    if (grant.role === 'admin-owner') {
      const activeOwners = await tx
        .select({id: adminGrants.id})
        .from(adminGrants)
        .innerJoin(users, eq(adminGrants.userId, users.id))
        .where(
          and(
            eq(adminGrants.role, 'admin-owner'),
            isNull(adminGrants.revokedAt),
            eq(users.status, 'active'),
          ),
        );
      if (activeOwners.length <= 1) throw new LastAdminOwnerError();
    }

    const updated = await tx
      .update(adminGrants)
      .set({revokedAt: new Date(), updatedAt: new Date()})
      .where(and(eq(adminGrants.id, grant.id), isNull(adminGrants.revokedAt)))
      .returning();
    const updatedRow = updated[0];
    if (!updatedRow) throw new AdminGrantNotFoundError();

    const revoked = toAdminGrant(updatedRow);
    await writeAdminAction(tx, params.event);
    await storeCommandResult(tx, params, revoked);
    return revoked;
  });
}
