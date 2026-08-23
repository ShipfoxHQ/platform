import {
  DEFINITION_DELETED,
  DEFINITION_RESOLVED,
  type DefinitionsEventMap,
} from '@shipfox/api-definitions-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import type {WorkflowDocument} from '@shipfox/workflow-document';
import {and, asc, eq, gt, isNull, notInArray, or, type SQL, sql} from 'drizzle-orm';
import type {
  WorkflowDefinition,
  WorkflowDefinitionPayload,
  WorkflowSourceSnapshot,
} from '#core/entities/workflow-definition.js';
import type {WorkflowModel} from '#core/entities/workflow-model.js';
import {db} from './db.js';
import {definitionTriggersFor} from './definition-triggers.js';
import {toDefinition, workflowDefinitions} from './schema/definitions.js';
import {definitionsOutbox} from './schema/outbox.js';
import {workflowWorkflows} from './schema/workflows.js';

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

export interface UpsertDefinitionParams {
  projectId: string;
  workspaceId: string;
  configPath?: string | null | undefined;
  source?: 'manual' | 'vcs' | undefined;
  name: string;
  document: WorkflowDocument;
  model: WorkflowModel;
  sourceSnapshot?: WorkflowSourceSnapshot | null | undefined;
  contentHash?: string | null | undefined;
  sha?: string | undefined;
  ref?: string | undefined;
}

/**
 * Finds or creates the workflow lineage for (projectId, configPath) and returns
 * its id. A definition without a config path has no stable key, so it gets its
 * own lineage keyed by the lineage id; such rows have no unique arbiter today
 * and each upsert already inserts a fresh row.
 */
async function findOrCreateWorkflow(
  tx: Tx,
  params: {projectId: string; configPath: string | null},
): Promise<string> {
  if (params.configPath === null) {
    const id = crypto.randomUUID();
    await tx.insert(workflowWorkflows).values({
      id,
      projectId: params.projectId,
      configPath: id,
    });
    return id;
  }

  const inserted = await tx
    .insert(workflowWorkflows)
    .values({projectId: params.projectId, configPath: params.configPath})
    .onConflictDoNothing()
    .returning({id: workflowWorkflows.id});
  const insertedRow = inserted[0];
  if (insertedRow) return insertedRow.id;

  const existing = await tx
    .select({id: workflowWorkflows.id})
    .from(workflowWorkflows)
    .where(
      and(
        eq(workflowWorkflows.projectId, params.projectId),
        eq(workflowWorkflows.configPath, params.configPath),
      ),
    )
    .limit(1);
  const existingRow = existing[0];
  if (!existingRow) throw new Error('Workflow lineage upsert returned no row');
  return existingRow.id;
}

function buildUpsertQuery(tx: Tx, params: UpsertDefinitionParams & {workflowId: string}) {
  const source = params.source ?? 'manual';
  if (source === 'vcs' && !params.configPath) {
    throw new Error('configPath is required for VCS definitions');
  }
  // Keep source aligned with the conflict arbiter (chosen by ref/sha presence):
  // vcs rows are versioned by ref/sha, manual rows have neither.
  const hasRefOrSha = params.ref != null || params.sha != null;
  if ((source === 'vcs') !== hasRefOrSha) {
    throw new Error(
      'Definition source/ref/sha mismatch: vcs requires a ref or sha, manual requires neither',
    );
  }

  const definition: WorkflowDefinitionPayload = {
    document: params.document,
    model: params.model,
    sourceSnapshot: params.sourceSnapshot ?? null,
  };

  const set = {
    name: params.name,
    source,
    definition,
    contentHash: params.contentHash ?? null,
    fetchedAt: sql`now()`,
    updatedAt: sql`now()`,
    deletedAt: null,
  };

  const values = {
    projectId: params.projectId,
    workflowId: params.workflowId,
    configPath: params.configPath ?? null,
    source,
    sha: params.sha ?? null,
    ref: params.ref ?? null,
    name: params.name,
    definition,
    contentHash: params.contentHash ?? null,
  };

  if (params.sha) {
    return tx
      .insert(workflowDefinitions)
      .values(values)
      .onConflictDoUpdate({
        target: [
          workflowDefinitions.projectId,
          workflowDefinitions.sha,
          workflowDefinitions.configPath,
        ],
        targetWhere: sql`"sha" IS NOT NULL`,
        set,
      })
      .returning();
  }

  if (params.ref) {
    return tx
      .insert(workflowDefinitions)
      .values(values)
      .onConflictDoUpdate({
        target: [
          workflowDefinitions.projectId,
          workflowDefinitions.ref,
          workflowDefinitions.configPath,
        ],
        targetWhere: sql`"ref" IS NOT NULL`,
        set,
      })
      .returning();
  }

  return tx
    .insert(workflowDefinitions)
    .values(values)
    .onConflictDoUpdate({
      target: [workflowDefinitions.projectId, workflowDefinitions.configPath],
      targetWhere: sql`"config_path" IS NOT NULL AND "ref" IS NULL AND "sha" IS NULL`,
      set,
    })
    .returning();
}

export async function upsertDefinition(
  params: UpsertDefinitionParams,
): Promise<WorkflowDefinition> {
  return await db().transaction(async (tx) => {
    const workflowId = await findOrCreateWorkflow(tx, {
      projectId: params.projectId,
      configPath: params.configPath ?? null,
    });
    const rows = await buildUpsertQuery(tx, {...params, workflowId});
    const row = rows[0];
    if (!row) throw new Error('Upsert returned no rows');

    await writeOutboxEvent<DefinitionsEventMap>(tx, definitionsOutbox, {
      type: DEFINITION_RESOLVED,
      payload: {
        definitionId: row.id,
        projectId: row.projectId,
        workspaceId: params.workspaceId,
        configPath: row.configPath,
        triggers: definitionTriggersFor(row.definition.model),
      },
    });

    return toDefinition(row);
  });
}

export async function getDefinitionById(id: string): Promise<WorkflowDefinition | undefined> {
  const rows = await db()
    .select()
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.id, id), isNull(workflowDefinitions.deletedAt)))
    .limit(1);
  const row = rows[0];

  if (!row) return undefined;
  return toDefinition(row);
}

export interface DefinitionCursor {
  value: string;
  id: string;
}

export interface ListDefinitionsParams {
  projectId: string;
  limit: number;
  cursor?: DefinitionCursor | undefined;
}

export interface ListDefinitionsResult {
  definitions: WorkflowDefinition[];
  nextCursor: DefinitionCursor | null;
}

function cursorWhere(cursor: DefinitionCursor | undefined): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    gt(workflowDefinitions.name, cursor.value),
    and(eq(workflowDefinitions.name, cursor.value), gt(workflowDefinitions.id, cursor.id)),
  );
}

export async function listDefinitions(
  params: ListDefinitionsParams,
): Promise<ListDefinitionsResult> {
  const conditions = [
    eq(workflowDefinitions.projectId, params.projectId),
    isNull(workflowDefinitions.deletedAt),
  ];
  const cursorCondition = cursorWhere(params.cursor);
  if (cursorCondition) conditions.push(cursorCondition);

  const rows = await db()
    .select()
    .from(workflowDefinitions)
    .where(and(...conditions))
    .orderBy(asc(workflowDefinitions.name), asc(workflowDefinitions.id))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);

  return {
    definitions: pageRows.map(toDefinition),
    nextCursor: hasMore && last ? {value: last.name, id: last.id} : null,
  };
}

export async function listDefinitionsByProject(projectId: string): Promise<WorkflowDefinition[]> {
  const result = await listDefinitions({projectId, limit: 100});
  return result.definitions;
}

export interface SoftDeleteVcsDefinitionsParams {
  projectId: string;
  workspaceId: string;
  ref: string;
  keepConfigPaths: string[];
}

async function softDeleteVcsDefinitionsNotInTx(
  tx: Tx,
  params: SoftDeleteVcsDefinitionsParams,
): Promise<number> {
  const now = sql`now()`;
  const baseWhere = and(
    eq(workflowDefinitions.projectId, params.projectId),
    eq(workflowDefinitions.source, 'vcs'),
    eq(workflowDefinitions.ref, params.ref),
    isNull(workflowDefinitions.deletedAt),
  );
  const where =
    params.keepConfigPaths.length > 0
      ? and(baseWhere, notInArray(workflowDefinitions.configPath, params.keepConfigPaths))
      : baseWhere;

  const rows = await tx
    .update(workflowDefinitions)
    .set({deletedAt: now, updatedAt: now})
    .where(where)
    .returning({id: workflowDefinitions.id});

  for (const row of rows) {
    await writeOutboxEvent<DefinitionsEventMap>(tx, definitionsOutbox, {
      type: DEFINITION_DELETED,
      payload: {
        definitionId: row.id,
        projectId: params.projectId,
        workspaceId: params.workspaceId,
      },
    });
  }

  return rows.length;
}

export async function softDeleteVcsDefinitionsNotIn(
  params: SoftDeleteVcsDefinitionsParams,
): Promise<number> {
  return await db().transaction((tx) => softDeleteVcsDefinitionsNotInTx(tx, params));
}

export interface ApplyVcsDefinitionsBatchParams {
  projectId: string;
  workspaceId: string;
  ref: string;
  upserts: Array<{
    configPath: string;
    name: string;
    document: WorkflowDocument;
    model: WorkflowModel;
    sourceSnapshot?: WorkflowSourceSnapshot | null | undefined;
    contentHash: string;
  }>;
}

export interface ApplyVcsDefinitionsBatchResult {
  appliedCount: number;
  deletedCount: number;
}

export async function applyVcsDefinitionsBatch(
  params: ApplyVcsDefinitionsBatchParams,
): Promise<ApplyVcsDefinitionsBatchResult> {
  return await db().transaction(async (tx) => {
    let appliedCount = 0;
    for (const item of params.upserts) {
      const existing = await tx
        .select({
          contentHash: workflowDefinitions.contentHash,
          deletedAt: workflowDefinitions.deletedAt,
        })
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.projectId, params.projectId),
            eq(workflowDefinitions.ref, params.ref),
            eq(workflowDefinitions.configPath, item.configPath),
          ),
        )
        .limit(1);

      const previous = existing[0];
      const unchanged =
        previous !== undefined &&
        previous.deletedAt === null &&
        previous.contentHash === item.contentHash;

      const workflowId = await findOrCreateWorkflow(tx, {
        projectId: params.projectId,
        configPath: item.configPath,
      });
      const rows = await buildUpsertQuery(tx, {
        projectId: params.projectId,
        workspaceId: params.workspaceId,
        workflowId,
        configPath: item.configPath,
        source: 'vcs',
        ref: params.ref,
        name: item.name,
        document: item.document,
        model: item.model,
        sourceSnapshot: item.sourceSnapshot ?? null,
        contentHash: item.contentHash,
      });
      const row = rows[0];
      if (!row) throw new Error('Upsert returned no rows');

      if (!unchanged) {
        await writeOutboxEvent<DefinitionsEventMap>(tx, definitionsOutbox, {
          type: DEFINITION_RESOLVED,
          payload: {
            definitionId: row.id,
            projectId: row.projectId,
            workspaceId: params.workspaceId,
            configPath: row.configPath,
            triggers: definitionTriggersFor(row.definition.model),
          },
        });
        appliedCount += 1;
      }
    }

    const keepConfigPaths = params.upserts.map((upsert) => upsert.configPath);
    const deletedCount = await softDeleteVcsDefinitionsNotInTx(tx, {
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      ref: params.ref,
      keepConfigPaths,
    });

    return {appliedCount, deletedCount};
  });
}

export async function invalidateCache(params: {projectId: string; ref: string}): Promise<void> {
  await db()
    .delete(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.projectId, params.projectId),
        eq(workflowDefinitions.ref, params.ref),
      ),
    );
}
