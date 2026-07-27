import type {AdminRole} from '@shipfox/api-auth-dto';
import {and, eq, isNull} from 'drizzle-orm';
import {highestAdminRole} from '#core/admin-role-model.js';
import type {UserStatus} from '#core/entities/user.js';
import {db} from './db.js';
import {adminGrants} from './schema/admin-grants.js';
import {users} from './schema/users.js';

export interface AdministratorUserRecord {
  id: string;
  email: string;
  name: string | null;
  emailVerifiedAt: Date | null;
  status: UserStatus;
  createdAt: Date;
  adminRole: AdminRole | null;
}

type AdministratorUserLookup = {id: string; email?: never} | {email: string; id?: never};

export async function findAdministratorUser(
  params: AdministratorUserLookup,
): Promise<AdministratorUserRecord | undefined> {
  const identifier = 'id' in params ? eq(users.id, params.id) : eq(users.email, params.email);
  const rows = await db()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerifiedAt: users.emailVerifiedAt,
      status: users.status,
      createdAt: users.createdAt,
      adminRole: adminGrants.role,
    })
    .from(users)
    .leftJoin(
      adminGrants,
      and(
        eq(adminGrants.userId, users.id),
        isNull(adminGrants.revokedAt),
        eq(users.status, 'active'),
      ),
    )
    .where(identifier);

  const first = rows[0];
  if (!first) return undefined;

  return {
    id: first.id,
    email: first.email,
    name: first.name,
    emailVerifiedAt: first.emailVerifiedAt,
    status: first.status,
    createdAt: first.createdAt,
    adminRole: highestAdminRole(rows.flatMap(({adminRole}) => (adminRole ? [adminRole] : []))),
  };
}
