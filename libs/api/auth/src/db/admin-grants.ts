import type {AdminRole} from '@shipfox/api-auth-dto';
import {and, asc, eq, isNull, sql} from 'drizzle-orm';
import {highestAdminRole} from '#core/admin-role-model.js';
import type {AdminGrant} from '#core/entities/admin-grant.js';
import {LastAdminOwnerError} from '#core/errors.js';
import {db} from './db.js';
import {adminGrants, toAdminGrant} from './schema/admin-grants.js';
import {users} from './schema/users.js';

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

export async function listAdminGrants(): Promise<AdminGrant[]> {
  const rows = await db().select().from(adminGrants).orderBy(asc(adminGrants.createdAt));
  return rows.map(toAdminGrant);
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
