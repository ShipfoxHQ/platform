import type {
  AgentThinking,
  CustomAgentModelDto,
  CustomModelProviderHeaderDto,
  ModelProviderApi,
  ModelProviderRef,
} from '@shipfox/api-agent-dto';
import {and, eq, sql} from 'drizzle-orm';
import type {ModelProviderConfig} from '#core/entities/model-provider-config.js';
import {db} from './db.js';
import {agentWorkspaceSettings} from './schema/agent-workspace-settings.js';
import {modelProviderConfigs, toModelProviderConfig} from './schema/model-provider-configs.js';

export interface UpsertModelProviderConfigParams {
  workspaceId: string;
  providerId: ModelProviderRef;
  kind?: 'builtin' | 'custom' | undefined;
  displayName?: string | null | undefined;
  api?: ModelProviderApi | null | undefined;
  baseUrl?: string | null | undefined;
  headers?: CustomModelProviderHeaderDto[] | null | undefined;
  secretHeaderNames?: string[] | null | undefined;
  models?: CustomAgentModelDto[] | null | undefined;
  requiresApiKey?: boolean | undefined;
  defaultModel: string | null;
  defaultThinking: AgentThinking;
  setAsDefault?: boolean | undefined;
}

export type InsertCustomModelProviderConfigParams = Omit<
  UpsertModelProviderConfigParams,
  'kind' | 'requiresApiKey'
> & {kind: 'custom'; requiresApiKey: boolean};

type ModelProviderConfigValues = Pick<
  typeof modelProviderConfigs.$inferInsert,
  | 'api'
  | 'baseUrl'
  | 'defaultModel'
  | 'defaultThinking'
  | 'displayName'
  | 'headers'
  | 'kind'
  | 'models'
  | 'requiresApiKey'
  | 'secretHeaderNames'
>;

function modelProviderConfigValues(
  params: UpsertModelProviderConfigParams,
): ModelProviderConfigValues {
  const values: ModelProviderConfigValues = {
    defaultModel: params.defaultModel,
    defaultThinking: params.defaultThinking,
  };
  if (params.kind !== undefined) values.kind = params.kind;
  if (params.displayName !== undefined) values.displayName = params.displayName;
  if (params.api !== undefined) values.api = params.api;
  if (params.baseUrl !== undefined) values.baseUrl = params.baseUrl;
  if (params.headers !== undefined) values.headers = params.headers;
  if (params.secretHeaderNames !== undefined) values.secretHeaderNames = params.secretHeaderNames;
  if (params.models !== undefined) values.models = params.models;
  if (params.requiresApiKey !== undefined) values.requiresApiKey = params.requiresApiKey;
  return values;
}

export async function insertCustomModelProviderConfig(
  params: InsertCustomModelProviderConfigParams,
): Promise<ModelProviderConfig | undefined> {
  return await db().transaction(async (tx) => {
    const rows = await tx
      .insert(modelProviderConfigs)
      .values({
        workspaceId: params.workspaceId,
        providerId: params.providerId,
        kind: params.kind,
        displayName: params.displayName,
        api: params.api,
        baseUrl: params.baseUrl,
        headers: params.headers,
        secretHeaderNames: params.secretHeaderNames,
        models: params.models,
        requiresApiKey: params.requiresApiKey,
        defaultModel: params.defaultModel,
        defaultThinking: params.defaultThinking,
      })
      .onConflictDoNothing({
        target: [modelProviderConfigs.workspaceId, modelProviderConfigs.providerId],
      })
      .returning();

    const row = rows[0];
    if (!row) return undefined;

    if (params.setAsDefault) {
      await tx
        .insert(agentWorkspaceSettings)
        .values({
          workspaceId: params.workspaceId,
          defaultProviderId: params.providerId,
        })
        .onConflictDoUpdate({
          target: agentWorkspaceSettings.workspaceId,
          set: {
            defaultProviderId: params.providerId,
            updatedAt: sql`NOW()`,
          },
        });
    }

    return toModelProviderConfig(row);
  });
}

export async function upsertModelProviderConfig(
  params: UpsertModelProviderConfigParams,
): Promise<ModelProviderConfig> {
  return await db().transaction(async (tx) => {
    const values = modelProviderConfigValues(params);
    const rows = await tx
      .insert(modelProviderConfigs)
      .values({
        workspaceId: params.workspaceId,
        providerId: params.providerId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [modelProviderConfigs.workspaceId, modelProviderConfigs.providerId],
        set: {
          ...values,
          updatedAt: sql`NOW()`,
        },
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('Upsert returned no rows');

    if (params.setAsDefault) {
      await tx
        .insert(agentWorkspaceSettings)
        .values({
          workspaceId: params.workspaceId,
          defaultProviderId: params.providerId,
        })
        .onConflictDoUpdate({
          target: agentWorkspaceSettings.workspaceId,
          set: {
            defaultProviderId: params.providerId,
            updatedAt: sql`NOW()`,
          },
        });
    }

    return toModelProviderConfig(row);
  });
}

export async function getModelProviderConfig(params: {
  workspaceId: string;
  providerId: ModelProviderRef;
}): Promise<ModelProviderConfig | undefined> {
  const rows = await db()
    .select()
    .from(modelProviderConfigs)
    .where(
      and(
        eq(modelProviderConfigs.workspaceId, params.workspaceId),
        eq(modelProviderConfigs.providerId, params.providerId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toModelProviderConfig(row);
}

export async function updateModelProviderDefaultModel(params: {
  workspaceId: string;
  providerId: ModelProviderRef;
  defaultModel: string | null;
}): Promise<ModelProviderConfig | undefined> {
  const rows = await db()
    .update(modelProviderConfigs)
    .set({defaultModel: params.defaultModel, updatedAt: sql`NOW()`})
    .where(
      and(
        eq(modelProviderConfigs.workspaceId, params.workspaceId),
        eq(modelProviderConfigs.providerId, params.providerId),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toModelProviderConfig(row);
}

export async function listModelProviderConfigs(
  workspaceId: string,
): Promise<ModelProviderConfig[]> {
  const rows = await db()
    .select()
    .from(modelProviderConfigs)
    .where(eq(modelProviderConfigs.workspaceId, workspaceId))
    .orderBy(modelProviderConfigs.providerId);

  return rows.map(toModelProviderConfig);
}

export async function deleteModelProviderConfig(params: {
  workspaceId: string;
  providerId: ModelProviderRef;
}): Promise<boolean> {
  return await db().transaction(async (tx) => {
    const deleted = await tx
      .delete(modelProviderConfigs)
      .where(
        and(
          eq(modelProviderConfigs.workspaceId, params.workspaceId),
          eq(modelProviderConfigs.providerId, params.providerId),
        ),
      )
      .returning({id: modelProviderConfigs.id});

    if (deleted.length === 0) return false;

    await tx
      .update(agentWorkspaceSettings)
      .set({defaultProviderId: null, updatedAt: sql`NOW()`})
      .where(
        and(
          eq(agentWorkspaceSettings.workspaceId, params.workspaceId),
          eq(agentWorkspaceSettings.defaultProviderId, params.providerId),
        ),
      );

    return true;
  });
}
