import {and, eq, sql} from 'drizzle-orm';
import type {IntegrationConnectionRepositoryGrant} from '#core/entities/repository-grant.js';
import {db} from './db.js';
import {integrationConnections} from './schema/connections.js';
import {
  integrationConnectionRepositoryGrants,
  toIntegrationConnectionRepositoryGrant,
} from './schema/repository-grants.js';

type IntegrationDb = ReturnType<typeof db>;
type IntegrationTx = Parameters<Parameters<IntegrationDb['transaction']>[0]>[0];
type Executor = IntegrationDb | IntegrationTx;

export interface UpsertIntegrationConnectionRepositoryGrantParams {
  connectionId: string;
  externalRepositoryId: string;
  repositoryOwner: string;
  repositoryName: string;
}

/**
 * Stores picker metadata for a connection-owned repository grant.
 *
 * The workspace is deliberately loaded from the connection in this operation;
 * callers cannot provide a workspace id that disagrees with the connection.
 */
export async function upsertIntegrationConnectionRepositoryGrant(
  params: UpsertIntegrationConnectionRepositoryGrantParams,
  options: {tx?: Executor | undefined} = {},
): Promise<IntegrationConnectionRepositoryGrant | undefined> {
  if (options.tx === undefined) {
    return await db().transaction((tx) => upsertIntegrationConnectionRepositoryGrant(params, {tx}));
  }

  const [connection] = await options.tx
    .select({workspaceId: integrationConnections.workspaceId})
    .from(integrationConnections)
    .where(eq(integrationConnections.id, params.connectionId))
    .limit(1)
    .for('update');
  if (!connection) return undefined;

  const [row] = await options.tx
    .insert(integrationConnectionRepositoryGrants)
    .values({
      connectionId: params.connectionId,
      workspaceId: connection.workspaceId,
      externalRepositoryId: params.externalRepositoryId,
      repositoryOwner: params.repositoryOwner,
      repositoryName: params.repositoryName,
    })
    .onConflictDoUpdate({
      target: [
        integrationConnectionRepositoryGrants.connectionId,
        integrationConnectionRepositoryGrants.externalRepositoryId,
      ],
      set: {
        workspaceId: connection.workspaceId,
        repositoryOwner: params.repositoryOwner,
        repositoryName: params.repositoryName,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row ? toIntegrationConnectionRepositoryGrant(row) : undefined;
}

export interface GetIntegrationConnectionRepositoryGrantParams {
  connectionId: string;
  externalRepositoryId: string;
}

export async function getIntegrationConnectionRepositoryGrant(
  params: GetIntegrationConnectionRepositoryGrantParams,
  options: {tx?: Executor | undefined} = {},
): Promise<IntegrationConnectionRepositoryGrant | undefined> {
  const executor = options.tx ?? db();
  const [row] = await executor
    .select()
    .from(integrationConnectionRepositoryGrants)
    .where(
      and(
        eq(integrationConnectionRepositoryGrants.connectionId, params.connectionId),
        eq(integrationConnectionRepositoryGrants.externalRepositoryId, params.externalRepositoryId),
      ),
    )
    .limit(1);
  return row ? toIntegrationConnectionRepositoryGrant(row) : undefined;
}

export interface ListIntegrationConnectionRepositoryGrantsParams {
  connectionId: string;
}

export async function listIntegrationConnectionRepositoryGrants(
  params: ListIntegrationConnectionRepositoryGrantsParams,
  options: {tx?: Executor | undefined} = {},
): Promise<IntegrationConnectionRepositoryGrant[]> {
  const executor = options.tx ?? db();
  const rows = await executor
    .select()
    .from(integrationConnectionRepositoryGrants)
    .where(eq(integrationConnectionRepositoryGrants.connectionId, params.connectionId))
    .orderBy(
      integrationConnectionRepositoryGrants.createdAt,
      integrationConnectionRepositoryGrants.id,
    );
  return rows.map(toIntegrationConnectionRepositoryGrant);
}

export interface ListIntegrationConnectionRepositoryGrantsByNameParams {
  connectionId: string;
  repositoryOwner: string;
  repositoryName: string;
}

export async function listIntegrationConnectionRepositoryGrantsByName(
  params: ListIntegrationConnectionRepositoryGrantsByNameParams,
  options: {tx?: Executor | undefined} = {},
): Promise<IntegrationConnectionRepositoryGrant[]> {
  const executor = options.tx ?? db();
  const rows = await executor
    .select()
    .from(integrationConnectionRepositoryGrants)
    .where(
      and(
        eq(integrationConnectionRepositoryGrants.connectionId, params.connectionId),
        sql`lower(${integrationConnectionRepositoryGrants.repositoryOwner}) = lower(${params.repositoryOwner})`,
        sql`lower(${integrationConnectionRepositoryGrants.repositoryName}) = lower(${params.repositoryName})`,
      ),
    )
    .orderBy(
      integrationConnectionRepositoryGrants.createdAt,
      integrationConnectionRepositoryGrants.id,
    );
  return rows.map(toIntegrationConnectionRepositoryGrant);
}

export interface UpdateIntegrationConnectionRepositoryGrantMetadataParams
  extends GetIntegrationConnectionRepositoryGrantParams {
  repositoryOwner: string;
  repositoryName: string;
}

export async function updateIntegrationConnectionRepositoryGrantMetadata(
  params: UpdateIntegrationConnectionRepositoryGrantMetadataParams,
  options: {tx?: Executor | undefined} = {},
): Promise<IntegrationConnectionRepositoryGrant | undefined> {
  if (options.tx === undefined) {
    return await db().transaction((tx) =>
      updateIntegrationConnectionRepositoryGrantMetadata(params, {tx}),
    );
  }

  const [row] = await options.tx
    .update(integrationConnectionRepositoryGrants)
    .set({
      repositoryOwner: params.repositoryOwner,
      repositoryName: params.repositoryName,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrationConnectionRepositoryGrants.connectionId, params.connectionId),
        eq(integrationConnectionRepositoryGrants.externalRepositoryId, params.externalRepositoryId),
      ),
    )
    .returning();
  return row ? toIntegrationConnectionRepositoryGrant(row) : undefined;
}

export interface DeleteIntegrationConnectionRepositoryGrantParams
  extends GetIntegrationConnectionRepositoryGrantParams {}

export async function deleteIntegrationConnectionRepositoryGrant(
  params: DeleteIntegrationConnectionRepositoryGrantParams,
  options: {tx?: Executor | undefined} = {},
): Promise<boolean> {
  if (options.tx === undefined) {
    return await db().transaction((tx) => deleteIntegrationConnectionRepositoryGrant(params, {tx}));
  }

  const result = await options.tx
    .delete(integrationConnectionRepositoryGrants)
    .where(
      and(
        eq(integrationConnectionRepositoryGrants.connectionId, params.connectionId),
        eq(integrationConnectionRepositoryGrants.externalRepositoryId, params.externalRepositoryId),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteIntegrationConnectionRepositoryGrants(
  params: {connectionId: string},
  options: {tx?: Executor | undefined} = {},
): Promise<number> {
  const executor = options.tx ?? db();
  const result = await executor
    .delete(integrationConnectionRepositoryGrants)
    .where(eq(integrationConnectionRepositoryGrants.connectionId, params.connectionId));
  return result.rowCount ?? 0;
}
