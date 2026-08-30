import {
  DEFINITION_DELETED,
  DEFINITION_RESOLVED,
  type DefinitionsEventMap,
} from '@shipfox/api-definitions-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import type {WorkflowDocument} from '@shipfox/workflow-document';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type {
  WorkflowDefinition,
  WorkflowDefinitionPayload,
  WorkflowSourceSnapshot,
} from '#core/entities/workflow-definition.js';
import type {WorkflowModel} from '#core/entities/workflow-model.js';
import {db} from './db.js';
import {definitionTriggersFor} from './definition-triggers.js';
import {type DefinitionDb, toDefinition, workflowDefinitions} from './schema/definitions.js';
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
          isNotNull(workflowDefinitions.workflowId),
        ),
      )
      .orderBy(asc(workflowDefinitions.createdAt), asc(workflowDefinitions.id))
      .limit(1);
    const existingRow = existing[0];
    if (existingRow?.workflowId) return existingRow.workflowId;

    const inserted = await tx
      .insert(workflowWorkflows)
      .values({projectId: params.projectId, configPath: null})
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
          isNull(workflowWorkflows.configPath),
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
  const configPaths = [...new Set(params.configPaths)].sort((left, right) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
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
  const workflowIds = new Map<string, string>();
  for (const row of rows) {
    if (row.configPath !== null) workflowIds.set(row.configPath, row.id);
  }
  for (const configPath of configPaths) {
    if (!workflowIds.has(configPath)) {
      throw new Error(
        `Workflow lineage upsert returned no row for project ${params.projectId} and config path ${configPath}`,
      );
    }
  }
  return workflowIds;
}

async function ensureWorkflowId(
  tx: Tx,
  row: Pick<DefinitionDb, 'id' | 'projectId' | 'configPath' | 'workflowId'>,
): Promise<string> {
  if (row.workflowId !== null) return row.workflowId;

  const workflowId = await findOrCreateWorkflow(tx, {
    projectId: row.projectId,
    configPath: row.configPath,
  });
  const updated = await tx
    .update(workflowDefinitions)
    .set({workflowId})
    .where(and(eq(workflowDefinitions.id, row.id), isNull(workflowDefinitions.workflowId)))
    .returning({workflowId: workflowDefinitions.workflowId});
  const updatedRow = updated[0];
  if (updatedRow?.workflowId) return updatedRow.workflowId;

  const current = await tx
    .select({workflowId: workflowDefinitions.workflowId})
    .from(workflowDefinitions)
    .where(eq(workflowDefinitions.id, row.id))
    .limit(1);
  const currentRow = current[0];
  if (!currentRow?.workflowId) {
    throw new Error(`Definition ${row.id} still has no workflow lineage after reconciliation`);
  }
  return currentRow.workflowId;
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

/**
 * Finds or creates the workflow lineage for (projectId, configPath) outside a
 * sync. A dev definition uses the lineage for run numbering without ever
 * persisting a definition row or publishing a resolution event.
 */
export async function findOrCreateWorkflowLineage(params: {
  projectId: string;
  configPath: string;
}): Promise<string> {
  return await db().transaction(async (tx) => {
    return await findOrCreateWorkflow(tx, params);
  });
}

export async function getDefinitionById(id: string): Promise<WorkflowDefinition | undefined> {
  return await db().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), isNull(workflowDefinitions.deletedAt)))
      .limit(1);
    const row = rows[0];

    if (row) {
      const workflowId = await ensureWorkflowId(tx, row);
      return toDefinition({...row, workflowId});
    }

    return undefined;
  });
}

export async function getWorkflowLineageById(
  id: string,
): Promise<{id: string; projectId: string} | undefined> {
  const rows = await db()
    .select({id: workflowWorkflows.id, projectId: workflowWorkflows.projectId})
    .from(workflowWorkflows)
    .where(eq(workflowWorkflows.id, id))
    .limit(1);

  return rows[0];
}

export async function getDefinitionByWorkflowId(params: {
  workflowId: string;
  ref: string;
}): Promise<WorkflowDefinition | undefined> {
  const rows = await db()
    .select()
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.workflowId, params.workflowId),
        eq(workflowDefinitions.ref, params.ref),
        isNull(workflowDefinitions.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];

  return row ? toDefinition({...row, workflowId: params.workflowId}) : undefined;
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
  return await db().transaction(async (tx) => {
    const conditions = [
      eq(workflowDefinitions.projectId, params.projectId),
      isNull(workflowDefinitions.deletedAt),
    ];
    const cursorCondition = cursorWhere(params.cursor);
    if (cursorCondition) conditions.push(cursorCondition);

    const rows = await tx
      .select()
      .from(workflowDefinitions)
      .where(and(...conditions))
      .orderBy(asc(workflowDefinitions.name), asc(workflowDefinitions.id))
      .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
    const last = pageRows.at(-1);
    const definitions: WorkflowDefinition[] = [];
    for (const row of pageRows) {
      const workflowId = await ensureWorkflowId(tx, row);
      definitions.push(toDefinition({...row, workflowId}));
    }

    return {
      definitions,
      nextCursor: hasMore && last ? {value: last.name, id: last.id} : null,
    };
  });
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

interface PreparedVcsDefinition {
  item: ApplyVcsDefinitionsBatchParams['upserts'][number];
  unchanged: boolean;
  workflowId: string | null | undefined;
}

async function prepareVcsDefinition(
  tx: Tx,
  params: ApplyVcsDefinitionsBatchParams,
  item: ApplyVcsDefinitionsBatchParams['upserts'][number],
): Promise<PreparedVcsDefinition> {
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
  return {item, unchanged, workflowId: previous?.workflowId};
}

async function applyPreparedVcsDefinition(
  tx: Tx,
  params: ApplyVcsDefinitionsBatchParams,
  prepared: PreparedVcsDefinition,
  workflowIds: ReadonlyMap<string, string>,
): Promise<boolean> {
  let workflowId = workflowIds.get(prepared.item.configPath);
  if (prepared.unchanged) {
    workflowId =
      prepared.workflowId ??
      (await findOrCreateWorkflow(tx, {
        projectId: params.projectId,
        configPath: prepared.item.configPath,
      }));
  }
  if (!workflowId) {
    throw new Error(
      `Workflow lineage missing for project ${params.projectId} and config path ${prepared.item.configPath}`,
    );
  }
  const rows = await buildUpsertQuery(tx, {
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    workflowId,
    configPath: prepared.item.configPath,
    source: 'vcs',
    ref: params.ref,
    name: prepared.item.name,
    document: prepared.item.document,
    model: prepared.item.model,
    sourceSnapshot: prepared.item.sourceSnapshot ?? null,
    contentHash: prepared.item.contentHash,
  });
  const row = rows[0];
  if (!row) throw new Error('Upsert returned no rows');
  if (prepared.unchanged) return false;
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
  return true;
}

export async function applyVcsDefinitionsBatch(
  params: ApplyVcsDefinitionsBatchParams,
): Promise<ApplyVcsDefinitionsBatchResult> {
  return await db().transaction(async (tx) => {
    let appliedCount = 0;
    const prepared: PreparedVcsDefinition[] = [];
    for (const item of params.upserts) {
      prepared.push(await prepareVcsDefinition(tx, params, item));
    }

    const workflowIds = await findOrCreateWorkflows(tx, {
      projectId: params.projectId,
      configPaths: prepared.filter(({unchanged}) => !unchanged).map(({item}) => item.configPath),
    });

    for (const item of prepared) {
      if (await applyPreparedVcsDefinition(tx, params, item, workflowIds)) appliedCount += 1;
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
