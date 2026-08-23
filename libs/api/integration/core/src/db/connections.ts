import {
  CONNECTION_SLUG_MAX_LENGTH,
  INTEGRATION_CONNECTION_AVAILABLE,
  type IntegrationsEventMap,
  RESERVED_CONNECTION_SLUGS,
} from '@shipfox/api-integration-core-dto';
import {ConnectionSlugConflictError} from '@shipfox/api-integration-spi';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, eq} from 'drizzle-orm';
import type {
  IntegrationConnection,
  IntegrationConnectionLifecycleStatus,
} from '#core/entities/connection.js';
import type {IntegrationCapability, IntegrationProviderKind} from '#core/entities/provider.js';
import {IntegrationConnectionAlreadyExistsError} from '#core/errors.js';
import {db} from './db.js';
import {integrationConnections, toIntegrationConnection} from './schema/connections.js';
import {integrationsOutbox} from './schema/outbox.js';

type IntegrationDb = ReturnType<typeof db>;
type IntegrationTx = Parameters<Parameters<IntegrationDb['transaction']>[0]>[0];

export interface UpsertIntegrationConnectionParams {
  workspaceId: string;
  provider: IntegrationProviderKind;
  externalAccountId: string;
  slug: string;
  displayName: string;
  lifecycleStatus?: IntegrationConnectionLifecycleStatus | undefined;
  capabilities?: IntegrationCapability[] | undefined;
}

export async function upsertIntegrationConnection(
  params: UpsertIntegrationConnectionParams,
  options: {tx?: IntegrationDb | IntegrationTx | undefined} = {},
): Promise<IntegrationConnection> {
  assertConnectionSlugIsNotReserved(params.slug);
  if (options.tx === undefined) {
    return await db().transaction((tx) => upsertIntegrationConnection(params, {tx}));
  }

  const executor = options.tx;
  const now = new Date();
  let [row] = await executor
    .insert(integrationConnections)
    .values({
      workspaceId: params.workspaceId,
      provider: params.provider,
      externalAccountId: params.externalAccountId,
      slug: params.slug,
      displayName: params.displayName,
      lifecycleStatus: params.lifecycleStatus ?? 'active',
    })
    .onConflictDoNothing({
      target: [
        integrationConnections.workspaceId,
        integrationConnections.provider,
        integrationConnections.externalAccountId,
      ],
    })
    .returning();

  let becameAvailable = row?.lifecycleStatus === 'active';
  if (!row) {
    const [existing] = await executor
      .select({
        id: integrationConnections.id,
        lifecycleStatus: integrationConnections.lifecycleStatus,
      })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.workspaceId, params.workspaceId),
          eq(integrationConnections.provider, params.provider),
          eq(integrationConnections.externalAccountId, params.externalAccountId),
        ),
      )
      .limit(1)
      .for('update');
    if (!existing) throw new Error('Integration connection upsert conflict row was not found');

    [row] = await executor
      .update(integrationConnections)
      .set({
        displayName: params.displayName,
        lifecycleStatus: params.lifecycleStatus ?? 'active',
        updatedAt: now,
      })
      .where(eq(integrationConnections.id, existing.id))
      .returning();
    becameAvailable = existing.lifecycleStatus !== 'active' && row?.lifecycleStatus === 'active';
  }

  if (!row) throw new Error('Integration connection upsert returned no rows');
  const connection = toIntegrationConnection(row);
  if (becameAvailable) {
    await writeConnectionAvailableEvent(executor, connection, params.capabilities);
  }
  return connection;
}

export interface CreateIntegrationConnectionParams {
  workspaceId: string;
  provider: IntegrationProviderKind;
  externalAccountId: string;
  slug: string;
  displayName: string;
  lifecycleStatus?: IntegrationConnectionLifecycleStatus | undefined;
  capabilities?: IntegrationCapability[] | undefined;
}

const INTEGRATION_CONNECTION_EXTERNAL_UNIQUE_CONSTRAINT =
  'integrations_connections_workspace_external_unique';
const INTEGRATION_CONNECTION_SLUG_UNIQUE_CONSTRAINT =
  'integrations_connections_workspace_slug_unique';

export function isIntegrationConnectionUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (typeof current !== 'object') return false;
    const {code, constraint} = current as {code?: unknown; constraint?: unknown};
    if (code === '23505' && constraint === INTEGRATION_CONNECTION_EXTERNAL_UNIQUE_CONSTRAINT) {
      return true;
    }
    current = (current as {cause?: unknown}).cause;
  }
  return false;
}

export function isIntegrationConnectionSlugUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (typeof current !== 'object') return false;
    const {code, constraint} = current as {code?: unknown; constraint?: unknown};
    if (code === '23505' && constraint === INTEGRATION_CONNECTION_SLUG_UNIQUE_CONSTRAINT) {
      return true;
    }
    current = (current as {cause?: unknown}).cause;
  }
  return false;
}

export async function createIntegrationConnection(
  params: CreateIntegrationConnectionParams,
  options: {tx?: IntegrationDb | IntegrationTx | undefined} = {},
): Promise<IntegrationConnection> {
  assertConnectionSlugIsNotReserved(params.slug);
  if (options.tx === undefined) {
    return await db().transaction((tx) => createIntegrationConnection(params, {tx}));
  }

  const executor = options.tx;
  let rows: (typeof integrationConnections.$inferSelect)[];
  try {
    rows = await executor
      .insert(integrationConnections)
      .values({
        workspaceId: params.workspaceId,
        provider: params.provider,
        externalAccountId: params.externalAccountId,
        slug: params.slug,
        displayName: params.displayName,
        lifecycleStatus: params.lifecycleStatus ?? 'active',
      })
      .returning();
  } catch (error) {
    if (isIntegrationConnectionUniqueViolation(error)) {
      throw new IntegrationConnectionAlreadyExistsError(
        params.workspaceId,
        params.provider,
        params.externalAccountId,
      );
    }
    if (isIntegrationConnectionSlugUniqueViolation(error)) {
      throw new ConnectionSlugConflictError(error);
    }
    throw error;
  }

  const row = rows[0];
  if (!row) throw new Error('Integration connection insert returned no rows');
  const connection = toIntegrationConnection(row);
  if (connection.lifecycleStatus === 'active') {
    await writeConnectionAvailableEvent(executor, connection, params.capabilities);
  }
  return connection;
}

export interface ResolveUniqueConnectionSlugParams {
  workspaceId: string;
  provider: IntegrationProviderKind;
  externalAccountId: string;
  baseSlug: string;
}

export async function resolveUniqueConnectionSlug(
  params: ResolveUniqueConnectionSlugParams,
  options: {tx?: IntegrationDb | IntegrationTx | undefined} = {},
): Promise<string> {
  assertConnectionSlugIsNotReserved(params.baseSlug);
  const executor = options.tx ?? db();
  const [existing] = await executor
    .select({slug: integrationConnections.slug})
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.workspaceId, params.workspaceId),
        eq(integrationConnections.provider, params.provider),
        eq(integrationConnections.externalAccountId, params.externalAccountId),
      ),
    )
    .limit(1);
  if (existing) return existing.slug;

  const workspaceSlugs = await executor
    .select({slug: integrationConnections.slug})
    .from(integrationConnections)
    .where(eq(integrationConnections.workspaceId, params.workspaceId));
  const used = new Set(workspaceSlugs.map((row) => row.slug));

  for (let suffixNumber = 1; ; suffixNumber += 1) {
    const suffix = suffixNumber === 1 ? '' : `_${suffixNumber}`;
    const baseBudget = CONNECTION_SLUG_MAX_LENGTH - suffix.length;
    const candidate = `${params.baseSlug.slice(0, baseBudget).replaceAll(/[_-]+$/g, '')}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

function assertConnectionSlugIsNotReserved(slug: string): void {
  if (!(RESERVED_CONNECTION_SLUGS as readonly string[]).includes(slug)) return;
  throw new ConnectionSlugConflictError(
    new Error(`Slug "${slug}" is reserved for a built-in trigger source`),
  );
}

export type CreateIntegrationConnectionFn = typeof createIntegrationConnection;

export async function getIntegrationConnectionById(
  id: string,
  options: {tx?: IntegrationDb | IntegrationTx | undefined} = {},
): Promise<IntegrationConnection | undefined> {
  const executor = options.tx ?? db();
  const rows = await executor
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toIntegrationConnection(row);
}

export type GetIntegrationConnectionByIdFn = typeof getIntegrationConnectionById;

export interface GetIntegrationConnectionBySlugParams {
  workspaceId: string;
  slug: string;
}

export async function getIntegrationConnectionBySlug(
  params: GetIntegrationConnectionBySlugParams,
): Promise<IntegrationConnection | undefined> {
  const rows = await db()
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.workspaceId, params.workspaceId),
        eq(integrationConnections.slug, params.slug),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toIntegrationConnection(row);
}

export type GetIntegrationConnectionBySlugFn = typeof getIntegrationConnectionBySlug;

export interface UpdateIntegrationConnectionLifecycleStatusParams {
  id: string;
  lifecycleStatus: IntegrationConnectionLifecycleStatus;
  capabilities?: IntegrationCapability[] | undefined;
}

export async function updateIntegrationConnectionLifecycleStatus(
  params: UpdateIntegrationConnectionLifecycleStatusParams,
  options: {tx?: IntegrationDb | IntegrationTx | undefined} = {},
): Promise<IntegrationConnection | undefined> {
  if (options.tx === undefined) {
    return await db().transaction((tx) => updateIntegrationConnectionLifecycleStatus(params, {tx}));
  }

  const executor = options.tx;
  const [existing] = await executor
    .select({lifecycleStatus: integrationConnections.lifecycleStatus})
    .from(integrationConnections)
    .where(eq(integrationConnections.id, params.id))
    .limit(1)
    .for('update');
  if (!existing) return undefined;

  const [row] = await executor
    .update(integrationConnections)
    .set({lifecycleStatus: params.lifecycleStatus, updatedAt: new Date()})
    .where(eq(integrationConnections.id, params.id))
    .returning();
  if (!row) return undefined;
  const connection = toIntegrationConnection(row);
  if (existing.lifecycleStatus !== 'active' && connection.lifecycleStatus === 'active') {
    await writeConnectionAvailableEvent(executor, connection, params.capabilities);
  }
  return connection;
}

export type UpdateIntegrationConnectionLifecycleStatusFn =
  typeof updateIntegrationConnectionLifecycleStatus;

async function writeConnectionAvailableEvent(
  executor: IntegrationDb | IntegrationTx,
  connection: IntegrationConnection,
  capabilities: IntegrationCapability[] | undefined,
): Promise<void> {
  await writeOutboxEvent<IntegrationsEventMap>(executor, integrationsOutbox, {
    type: INTEGRATION_CONNECTION_AVAILABLE,
    payload: {
      provider: connection.provider,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      slug: connection.slug,
      capabilities: capabilities ?? [],
    },
  });
}

export async function deleteIntegrationConnection(
  params: {id: string},
  options: {tx?: IntegrationDb | IntegrationTx | undefined} = {},
): Promise<boolean> {
  const executor = options.tx ?? db();
  const result = await executor
    .delete(integrationConnections)
    .where(eq(integrationConnections.id, params.id));
  return (result.rowCount ?? 0) > 0;
}

export type DeleteIntegrationConnectionFn = typeof deleteIntegrationConnection;

export interface ListIntegrationConnectionsParams {
  workspaceId: string;
}

export async function listIntegrationConnections(
  params: ListIntegrationConnectionsParams,
): Promise<IntegrationConnection[]> {
  const rows = await db()
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.workspaceId, params.workspaceId))
    .orderBy(integrationConnections.createdAt, integrationConnections.id);

  const connections = rows.map(toIntegrationConnection);
  return connections;
}

export interface ListIntegrationConnectionsByProviderParams {
  provider: IntegrationProviderKind;
}

export async function listIntegrationConnectionsByProvider(
  params: ListIntegrationConnectionsByProviderParams,
): Promise<IntegrationConnection[]> {
  const rows = await db()
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.provider, params.provider))
    .orderBy(integrationConnections.createdAt, integrationConnections.id);

  return rows.map(toIntegrationConnection);
}
