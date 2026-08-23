import {
  DEFINITION_DELETED,
  DEFINITION_RESOLVED,
  type DefinitionsEventMap,
} from '@shipfox/api-definitions-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import type {WorkflowDocument} from '@shipfox/workflow-document';
import {and, asc, eq, gt, inArray, isNull, notInArray, or, type SQL, sql} from 'drizzle-orm';
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

// Reserved in the lineage table for manual definitions without a config path.
const PATHLESS_WORKFLOW_CONFIG_PATH = '__shipfox_internal_pathless__';

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
 * its id. Pathless manual definitions share a project-scoped lineage because
 * their request has no more specific stable key.
 */
async function findOrCreateWorkflow(
  tx: Tx,
  params: {projectId: string; configPath: string | null},
): Promise<string> {
  if (params.configPath === null) {
    // Serialize the first pathless definition for a project so concurrent saves
    // cannot create multiple project-scoped lineages.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${params.projectId}, 0))`);
    const existing = await tx
      .select({workflowId: workflowDefinitions.workflowId})
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.projectId, params.projectId),
          isNull(workflowDefinitions.configPath),
          eq(workflowDefinitions.source, 'manual'),
        ),
      )
      .orderBy(asc(workflowDefinitions.createdAt), asc(workflowDefinitions.id))
      .limit(1);
    const existingRow = existing[0];
    if (existingRow) return existingRow.workflowId;

    const inserted = await tx
      .insert(workflowWorkflows)
      .values({projectId: params.projectId, configPath: PATHLESS_WORKFLOW_CONFIG_PATH})
      .onConflictDoNothing()
      .returning({id: workflowWorkflows.id});
    const insertedRow = inserted[0];
    if (insertedRow) return insertedRow.id;

    const existingLineage = await tx
      .select({id: workflowWorkflows.id})
      .from(workflowWorkflows)
      .where(
        and(
          eq(workflowWorkflows.projectId, params.projectId),
          eq(workflowWorkflows.configPath, PATHLESS_WORKFLOW_CONFIG_PATH),
        ),
      )
      .limit(1);
    const existingLineageRow = existingLineage[0];
    if (!existingLineageRow) {
      throw new Error(`Pathless workflow lineage missing for project ${params.projectId}`);
    }
    return existingLineageRow.id;
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
  if (!existingRow) {
    throw new Error(
      `Workflow lineage upsert returned no row for project ${params.projectId} and config path ${params.configPath}`,
    );
  }
  return existingRow.id;
}

async function findOrCreateWorkflows(
  tx: Tx,
  params: {projectId: string; configPaths: string[]},
): Promise<Map<string, string>> {
  const configPaths = [...new Set(params.configPaths)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (configPaths.length === 0) return new Map();

  await tx
    .insert(workflowWorkflows)
    .values(configPaths.map((configPath) => ({projectId: params.projectId, configPath})))
    .onConflictDoNothing();

  const rows = await tx
    .select({id: workflowWorkflows.id, configPath: workflowWorkflows.configPath})
    .from(workflowWorkflows)
    .where(
      and(
        eq(workflowWorkflows.projectId, params.projectId),
        inArray(workflowWorkflows.configPath, configPaths),
      ),
    );
  const workflowIds = new Map(rows.map((row) => [row.configPath, row.id]));
  for (const configPath of configPaths) {
    if (!workflowIds.has(configPath)) {
      throw new Error(
        `Workflow lineage upsert returned no row for project ${params.projectId} and config path ${configPath}`,
      );
    }
  }
  return workflowIds;
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
    workflowId: params.workflowId,
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
    const prepared: Array<{
      item: (typeof params.upserts)[number];
      unchanged: boolean;
      workflowId: string | undefined;
    }> = [];
    for (const item of params.upserts) {
      const existing = await tx
        .select({
          contentHash: workflowDefinitions.contentHash,
          deletedAt: workflowDefinitions.deletedAt,
          workflowId: workflowDefinitions.workflowId,
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

      prepared.push({item, unchanged, workflowId: previous?.workflowId});
    }

    const workflowIds = await findOrCreateWorkflows(tx, {
      projectId: params.projectId,
      configPaths: prepared.filter(({unchanged}) => !unchanged).map(({item}) => item.configPath),
    });

    for (const {item, unchanged, workflowId: previousWorkflowId} of prepared) {
      const workflowId = unchanged ? previousWorkflowId : workflowIds.get(item.configPath);
      if (!workflowId) {
        throw new Error(
          `Workflow lineage missing for project ${params.projectId} and config path ${item.configPath}`,
        );
      }
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
