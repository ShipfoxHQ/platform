import type {AdminRole} from '@shipfox/api-auth-dto';
import {
  paginateTimestampIdRows,
  type TimestampIdCursor,
  timestampIdCursorWhere,
} from '@shipfox/node-drizzle';
import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  ne,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from 'drizzle-orm';
import {highestAdminRole} from '#core/admin-role-model.js';
import type {AdministratorUserSummary} from '#core/entities/administrator-read-model.js';
import type {UserStatus} from '#core/entities/user.js';
import type {db} from './db.js';
import {adminGrants} from './schema/admin-grants.js';
import {users} from './schema/users.js';

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];
export type AdministratorUserSummaryExecutor = ReturnType<typeof db> | Tx;

type AdministratorUserLookup = {id: string; email?: never} | {email: string; id?: never};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEARCH_TERM_SEPARATOR = /\s+/;

export interface ListAdministratorUserSummariesParams {
  actorId: string;
  limit: number;
  cursor?: TimestampIdCursor | undefined;
  search?: string | undefined;
  status?: UserStatus | undefined;
  eligible?: boolean | undefined;
}

export interface ListAdministratorUserSummariesResult {
  rows: AdministratorUserSummary[];
  nextCursor: TimestampIdCursor | null;
}

function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function containsTerm(column: SQLWrapper, term: string): SQLWrapper {
  return sql`${column} ILIKE ${`%${escapeLikeTerm(term)}%`}`;
}

function adminRoleFromRank(rank: number | null, status: UserStatus): AdminRole | null {
  if (status !== 'active' || rank === null) return null;
  if (rank === 3) return 'admin-owner';
  if (rank === 2) return 'admin-operator';
  if (rank === 1) return 'admin-observer';
  return null;
}

export async function findAdministratorUserSummary(
  executor: AdministratorUserSummaryExecutor,
  params: AdministratorUserLookup,
): Promise<AdministratorUserSummary | undefined> {
  const identifier = 'id' in params ? eq(users.id, params.id) : eq(users.email, params.email);
  const rows = await executor
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
  } satisfies AdministratorUserSummary;
}

export async function listAdministratorUserSummaries(
  executor: AdministratorUserSummaryExecutor,
  params: ListAdministratorUserSummariesParams,
): Promise<ListAdministratorUserSummariesResult> {
  // Aggregate grants in a subquery so pagination is over users, not grants.
  const activeAdminRoles = executor
    .select({
      userId: adminGrants.userId,
      roleRank: sql<number>`max(case ${adminGrants.role}
        when 'admin-observer' then 1
        when 'admin-operator' then 2
        when 'admin-owner' then 3
      end)`.as('role_rank'),
    })
    .from(adminGrants)
    .where(isNull(adminGrants.revokedAt))
    .groupBy(adminGrants.userId)
    .as('active_admin_roles');

  const conditions: SQL[] = [];
  const cursorCondition = timestampIdCursorWhere({
    timestampColumn: users.createdAt,
    idColumn: users.id,
    cursor: params.cursor,
  });
  if (cursorCondition) conditions.push(cursorCondition);
  if (params.status) conditions.push(eq(users.status, params.status));

  if (params.eligible) {
    conditions.push(
      eq(users.status, 'active'),
      isNotNull(users.emailVerifiedAt),
      isNull(activeAdminRoles.userId),
      ne(users.id, params.actorId),
    );
  }

  const search = params.search?.trim() ?? '';
  if (search) {
    if (isUuid(search)) {
      conditions.push(eq(users.id, search));
    } else {
      for (const term of search.split(SEARCH_TERM_SEPARATOR)) {
        const termCondition = or(containsTerm(users.name, term), containsTerm(users.email, term));
        if (termCondition) conditions.push(termCondition);
      }
    }
  }

  const rows = await executor
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerifiedAt: users.emailVerifiedAt,
      status: users.status,
      createdAt: users.createdAt,
      adminRoleRank: activeAdminRoles.roleRank,
    })
    .from(users)
    .leftJoin(activeAdminRoles, eq(activeAdminRoles.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(params.limit + 1);

  const mappedRows = rows.map(
    ({adminRoleRank, ...row}): AdministratorUserSummary => ({
      ...row,
      adminRole: adminRoleFromRank(adminRoleRank, row.status),
    }),
  );
  const page = paginateTimestampIdRows({
    rows: mappedRows,
    limit: params.limit,
    timestampKey: 'createdAt',
  });

  return {rows: page.pageRows, nextCursor: page.nextCursor};
}
