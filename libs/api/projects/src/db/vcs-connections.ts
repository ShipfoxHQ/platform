import {eq} from 'drizzle-orm';
import type {VcsConnection, VcsProviderKind} from '#core/entities/vcs-connection.js';
import {db} from './db.js';
import {toVcsConnection, vcsConnections} from './schema/vcs-connections.js';

export interface CreateVcsConnectionParams {
  workspaceId: string;
  provider: VcsProviderKind;
  providerHost: string;
  externalConnectionId: string;
  displayName: string;
  credentials?: Record<string, unknown> | undefined;
}

export async function createVcsConnection(
  params: CreateVcsConnectionParams,
): Promise<VcsConnection> {
  const [row] = await db()
    .insert(vcsConnections)
    .values({
      workspaceId: params.workspaceId,
      provider: params.provider,
      providerHost: params.providerHost,
      externalConnectionId: params.externalConnectionId,
      displayName: params.displayName,
      credentials: params.credentials ?? {},
    })
    .onConflictDoUpdate({
      target: [
        vcsConnections.workspaceId,
        vcsConnections.provider,
        vcsConnections.providerHost,
        vcsConnections.externalConnectionId,
      ],
      set: {
        displayName: params.displayName,
        credentials: params.credentials ?? {},
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) throw new Error('Insert returned no rows');
  return toVcsConnection(row);
}

export async function getVcsConnectionById(id: string): Promise<VcsConnection | undefined> {
  const rows = await db().select().from(vcsConnections).where(eq(vcsConnections.id, id)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toVcsConnection(row);
}
