import {and, eq} from 'drizzle-orm';
import type {
  IntegrationConnection,
  IntegrationConnectionLifecycleStatus,
} from '#core/entities/connection.js';
import type {IntegrationProviderKind} from '#core/entities/provider.js';
import {db} from './db.js';
import {integrationConnections, toIntegrationConnection} from './schema/connections.js';

type IntegrationDb = ReturnType<typeof db>;
type IntegrationTx = Parameters<Parameters<IntegrationDb['transaction']>[0]>[0];

export interface UpsertIntegrationConnectionParams {
  workspaceId: string;
  provider: IntegrationProviderKind;
  externalAccountId: string;
  displayName: string;
  lifecycleStatus?: IntegrationConnectionLifecycleStatus | undefined;
}

export async function upsertIntegrationConnection(
  params: UpsertIntegrationConnectionParams,
  options: {tx?: IntegrationDb | IntegrationTx | undefined} = {},
): Promise<IntegrationConnection> {
  const executor = options.tx ?? db();
  const now = new Date();
  const [row] = await executor
    .insert(integrationConnections)
    .values({
      workspaceId: params.workspaceId,
      provider: params.provider,
      externalAccountId: params.externalAccountId,
      displayName: params.displayName,
      lifecycleStatus: params.lifecycleStatus ?? 'active',
    })
    .onConflictDoUpdate({
      target: [
        integrationConnections.workspaceId,
        integrationConnections.provider,
        integrationConnections.externalAccountId,
      ],
      set: {
        displayName: params.displayName,
        lifecycleStatus: params.lifecycleStatus ?? 'active',
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new Error('Integration connection upsert returned no rows');
  return toIntegrationConnection(row);
}

export async function getIntegrationConnectionById(
  id: string,
): Promise<IntegrationConnection | undefined> {
  const rows = await db()
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toIntegrationConnection(row);
}

export interface ListIntegrationConnectionsParams {
  workspaceId: string;
}

export async function listIntegrationConnections(
  params: ListIntegrationConnectionsParams,
): Promise<IntegrationConnection[]> {
  const rows = await db()
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.workspaceId, params.workspaceId),
        eq(integrationConnections.lifecycleStatus, 'active'),
      ),
    )
    .orderBy(integrationConnections.createdAt, integrationConnections.id);

  const connections = rows.map(toIntegrationConnection);
  return connections;
}
