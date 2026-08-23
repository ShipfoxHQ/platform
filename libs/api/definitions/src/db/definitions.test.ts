import {DEFINITION_RESOLVED} from '@shipfox/api-definitions-dto';
import {
  BATCH_SIZE,
  countPendingOutboxRows as countPendingOutboxRowsFromRegistry,
  createOutboxRegistry,
  type DrainedEvent,
  drainAll as drainFromRegistry,
  type ModulePublisher,
  markDispatched as markDispatchedFromRegistry,
  type OutboxDispatchClaim,
  type OutboxDispatchFailure,
  type PruneDispatchedOutboxRowsOptions,
  pruneDispatchedOutboxRows as pruneFromRegistry,
  recordDispatchFailure as recordFailureFromRegistry,
  registerPublisher as registerInRegistry,
  renewDispatchClaim as renewFromRegistry,
} from '@shipfox/node-module';
import {eq, sql} from 'drizzle-orm';
import type {WorkflowDefinitionPayload} from '#core/entities/workflow-definition.js';
import {normalizeWorkflowDocument} from '#core/workflow-model/index.js';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {db} from './db.js';
import {
  applyVcsDefinitionsBatch,
  getDefinitionById,
  invalidateCache,
  listDefinitionsByProject,
  softDeleteVcsDefinitionsNotIn,
  upsertDefinition,
} from './definitions.js';
import {workflowDefinitions} from './schema/definitions.js';
import {definitionsOutbox} from './schema/outbox.js';
import {workflowWorkflows} from './schema/workflows.js';

const MS_PER_DAY = 24 * 60 * 60 * 1_000;
let outboxRegistry = createOutboxRegistry();

function resetPublishers(): void {
  outboxRegistry = createOutboxRegistry();
}

function registerPublisher(publisher: ModulePublisher): void {
  registerInRegistry(outboxRegistry, publisher);
}

function drainAll(options?: {partition?: {workerIndex: number; workerCount: number}}) {
  return drainFromRegistry(outboxRegistry, options);
}

function countPendingOutboxRows() {
  return countPendingOutboxRowsFromRegistry(outboxRegistry);
}

function markDispatched(source: string, claims: string[] | OutboxDispatchClaim[]) {
  return markDispatchedFromRegistry(outboxRegistry, source, claims);
}

function renewDispatchClaim(source: string, claim: OutboxDispatchClaim) {
  return renewFromRegistry(outboxRegistry, source, claim);
}

function recordDispatchFailure(
  source: string,
  id: string,
  failure: OutboxDispatchFailure,
  claimExpiresAt?: Date,
) {
  return recordFailureFromRegistry(outboxRegistry, source, id, failure, claimExpiresAt);
}

function pruneDispatchedOutboxRows(options: PruneDispatchedOutboxRowsOptions) {
  return pruneFromRegistry(outboxRegistry, options);
}

function definitionFields(name = 'Test Workflow'): WorkflowDefinitionPayload {
  const document = {
    name,
    runner: 'ubuntu-latest',
    jobs: {build: {steps: [{run: 'echo hello'}]}},
  };
  return definitionFieldsForDocument(document);
}

function definitionFieldsForDocument(
  document: WorkflowDefinitionPayload['document'],
): WorkflowDefinitionPayload {
  return {document, model: normalizeWorkflowDocument(document, {agentValidationCatalog})};
}

async function listOutboxRowsForProject(projectId: string) {
  return await db()
    .select()
    .from(definitionsOutbox)
    .where(sql`${definitionsOutbox.payload}->>'projectId' = ${projectId}`);
}

function eventsForProject(events: DrainedEvent[], projectId: string) {
  return events.filter((event) => {
    const payload = event.event.payload as {projectId?: unknown};
    return payload.projectId === projectId;
  });
}

async function insertOutboxRow(params: {
  projectId: string;
  marker: string;
  orderingKey?: string | null;
  createdAt?: Date;
  nextDispatchAt?: Date;
  dispatchedAt?: Date | null;
  deadLetteredAt?: Date | null;
}) {
  const id = crypto.randomUUID();
  await db()
    .insert(definitionsOutbox)
    .values({
      id,
      eventType: DEFINITION_RESOLVED,
      orderingKey: params.orderingKey ?? null,
      payload: {projectId: params.projectId, marker: params.marker},
      createdAt: params.createdAt,
      nextDispatchAt: params.nextDispatchAt,
      dispatchedAt: params.dispatchedAt ?? null,
      deadLetteredAt: params.deadLetteredAt ?? null,
    });
  return id;
}

describe('definition queries', () => {
  let projectId: string;
  let workspaceId: string;

  beforeEach(() => {
    projectId = crypto.randomUUID();
    workspaceId = crypto.randomUUID();
  });

  describe('upsertDefinition', () => {
    test('inserts a new definition and returns entity with id and timestamps', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/test.yml',
        name: 'Test',
        ...definitionFields(),
      });

      expect(definition.id).toBeDefined();
      expect(definition.projectId).toBe(projectId);
      expect(definition.configPath).toBe('.shipfox/workflows/test.yml');
      expect(definition.name).toBe('Test');
      expect({document: definition.document, model: definition.model}).toEqual(definitionFields());
      expect(definition.sha).toBeNull();
      expect(definition.ref).toBeNull();
      expect(definition.fetchedAt).toBeInstanceOf(Date);
      expect(definition.createdAt).toBeInstanceOf(Date);
      expect(definition.updatedAt).toBeInstanceOf(Date);
    });

    test('updates existing definition on conflict (same project_id + config_path)', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/deploy.yml',
        name: 'Deploy v1',
        ...definitionFields('Deploy v1'),
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/deploy.yml',
        name: 'Deploy v2',
        ...definitionFields('Deploy v2'),
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('Deploy v2');
      expect(second.document.name).toBe('Deploy v2');
      expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
      expect(second.updatedAt).not.toEqual(first.updatedAt);
    });

    test('with sha inserts SHA-pinned definition', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
        source: 'vcs',
        sha: 'abc123',
      });

      expect(definition.sha).toBe('abc123');
      expect(definition.ref).toBeNull();
    });

    test('with sha updates on conflict (same projectId + sha + configPath)', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v1',
        ...definitionFields('CI v1'),
        source: 'vcs',
        sha: 'abc123',
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v2',
        ...definitionFields('CI v2'),
        source: 'vcs',
        sha: 'abc123',
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('CI v2');
    });

    test('with ref inserts ref-based definition', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
        source: 'vcs',
        ref: 'main',
      });

      expect(definition.ref).toBe('main');
      expect(definition.sha).toBeNull();
    });

    test('with ref updates on conflict (same projectId + ref + configPath)', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v1',
        ...definitionFields('CI v1'),
        source: 'vcs',
        ref: 'main',
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v2',
        ...definitionFields('CI v2'),
        source: 'vcs',
        ref: 'main',
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('CI v2');
    });

    test('manual and VCS definitions coexist at the same config_path (ENG-659)', async () => {
      const manual = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI (manual)',
        ...definitionFields('CI (manual)'),
        source: 'manual',
      });

      const vcs = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI (vcs)',
        ...definitionFields('CI (vcs)'),
        source: 'vcs',
        ref: 'main',
      });

      expect(vcs.id).not.toBe(manual.id);
      expect(manual.source).toBe('manual');
      expect(vcs.source).toBe('vcs');
    });

    test('VCS definitions on two branches coexist at the same config_path', async () => {
      const main = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI main',
        ...definitionFields('CI main'),
        source: 'vcs',
        ref: 'main',
      });

      const dev = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI dev',
        ...definitionFields('CI dev'),
        source: 'vcs',
        ref: 'dev',
      });

      expect(dev.id).not.toBe(main.id);
    });

    test('rejects a vcs definition with neither ref nor sha', async () => {
      const upsert = upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
        source: 'vcs',
      });

      await expect(upsert).rejects.toThrow();
    });

    test('rejects a manual definition that sets a sha', async () => {
      const upsert = upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
        source: 'manual',
        sha: 'abc123',
      });

      await expect(upsert).rejects.toThrow();
    });

    test('with neither sha nor ref uses base constraint', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v1',
        ...definitionFields('CI v1'),
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v2',
        ...definitionFields('CI v2'),
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('CI v2');
    });

    test('sets fetchedAt on insert', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
      });

      expect(definition.fetchedAt).toBeInstanceOf(Date);
    });

    test('updates fetchedAt on conflict update', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v1',
        ...definitionFields('CI v1'),
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v2',
        ...definitionFields('CI v2'),
      });

      expect(second.fetchedAt.getTime()).toBeGreaterThanOrEqual(first.fetchedAt.getTime());
    });
  });

  describe('workflow lineage', () => {
    test('upsertDefinition creates a lineage and returns its workflowId', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/lineage.yml',
        name: 'Lineage',
        ...definitionFields('Lineage'),
        source: 'vcs',
        ref: 'main',
      });

      expect(definition.workflowId).toBeDefined();
      const lineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(lineages).toHaveLength(1);
      expect(lineages[0]?.id).toBe(definition.workflowId);
      expect(lineages[0]?.configPath).toBe('.shipfox/workflows/lineage.yml');
    });

    test('re-syncing the same config path reuses the lineage', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'a.yml',
        name: 'A v1',
        ...definitionFields('A v1'),
        source: 'vcs',
        ref: 'main',
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'a.yml',
        name: 'A v2',
        ...definitionFields('A v2'),
        source: 'vcs',
        ref: 'main',
      });

      expect(second.workflowId).toBe(first.workflowId);
      const lineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(lineages).toHaveLength(1);
    });

    test('manual and VCS rows at the same config path share one lineage', async () => {
      const manual = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'shared.yml',
        name: 'Shared manual',
        ...definitionFields('Shared manual'),
      });
      const vcs = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'shared.yml',
        name: 'Shared vcs',
        ...definitionFields('Shared vcs'),
        source: 'vcs',
        ref: 'main',
      });

      expect(vcs.workflowId).toBe(manual.workflowId);
    });

    test('applyVcsDefinitionsBatch creates the lineage and reuses it across syncs', async () => {
      await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {
            configPath: 'batch.yml',
            name: 'Batch',
            ...definitionFields('Batch'),
            contentHash: 'h-1',
          },
        ],
      });
      const firstLineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(firstLineages).toHaveLength(1);

      await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {
            configPath: 'batch.yml',
            name: 'Batch v2',
            ...definitionFields('Batch v2'),
            contentHash: 'h-2',
          },
        ],
      });
      const secondLineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(secondLineages).toHaveLength(1);
      expect(secondLineages[0]?.id).toBe(firstLineages[0]?.id);
    });

    test('soft-deleting a synced row keeps the lineage', async () => {
      await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {configPath: 'gone.yml', name: 'Gone', ...definitionFields('Gone'), contentHash: 'h-1'},
        ],
      });

      const deletedCount = await softDeleteVcsDefinitionsNotIn({
        projectId,
        workspaceId,
        ref: 'main',
        keepConfigPaths: [],
      });

      expect(deletedCount).toBe(1);
      const lineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(lineages).toHaveLength(1);
      expect(lineages[0]?.configPath).toBe('gone.yml');
    });

    test('pathless manual definitions reuse the project lineage across saves', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        name: 'No path',
        ...definitionFields('No path'),
      });
      const second = await upsertDefinition({
        projectId,
        workspaceId,
        name: 'No path updated',
        ...definitionFields('No path updated'),
      });

      const lineage = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.id, first.workflowId));
      expect(lineage).toHaveLength(1);
      expect(lineage[0]?.projectId).toBe(projectId);
      expect(lineage[0]?.configPath).toBe(first.workflowId);
      expect(second.workflowId).toBe(first.workflowId);

      const projectLineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(projectLineages).toHaveLength(1);
    });

    test('getDefinitionById returns the workflowId', async () => {
      const created = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'found.yml',
        name: 'Found',
        ...definitionFields('Found'),
      });

      const found = await getDefinitionById(created.id);

      expect(found?.workflowId).toBe(created.workflowId);
    });
  });

  describe('getDefinitionById', () => {
    test('returns the definition when found', async () => {
      const created = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
      });

      const found = await getDefinitionById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('CI');
    });

    test('returns undefined when not found', async () => {
      const found = await getDefinitionById(crypto.randomUUID());

      expect(found).toBeUndefined();
    });
  });

  describe('listDefinitionsByProject', () => {
    test('returns definitions ordered by name', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'z.yml',
        name: 'Zulu',
        ...definitionFields('Zulu'),
      });
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'a.yml',
        name: 'Alpha',
        ...definitionFields('Alpha'),
      });
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'm.yml',
        name: 'Mike',
        ...definitionFields('Mike'),
      });

      const definitions = await listDefinitionsByProject(projectId);

      expect(definitions).toHaveLength(3);
      expect(definitions[0]?.name).toBe('Alpha');
      expect(definitions[1]?.name).toBe('Mike');
      expect(definitions[2]?.name).toBe('Zulu');
    });

    test('returns empty array for project with no definitions', async () => {
      const definitions = await listDefinitionsByProject(crypto.randomUUID());

      expect(definitions).toEqual([]);
    });
  });

  describe('soft-delete + restore', () => {
    test('soft-deletes VCS definitions for a ref that are not in the keep set', async () => {
      const stale = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'old.yml',
        name: 'Old',
        ...definitionFields('Old'),
        ref: 'main',
        source: 'vcs',
      });
      const kept = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'kept.yml',
        name: 'Kept',
        ...definitionFields('Kept'),
        ref: 'main',
        source: 'vcs',
      });

      const deletedCount = await softDeleteVcsDefinitionsNotIn({
        projectId,
        workspaceId,
        ref: 'main',
        keepConfigPaths: ['kept.yml'],
      });

      expect(deletedCount).toBe(1);
      const after = await listDefinitionsByProject(projectId);
      expect(after.map((definition) => definition.id)).toEqual([kept.id]);
      const staleRow = await db()
        .select()
        .from(workflowDefinitions)
        .where(sql`${workflowDefinitions.id} = ${stale.id}`);
      expect(staleRow[0]?.deletedAt).not.toBeNull();
    });

    test('reactivates a previously soft-deleted definition by clearing deleted_at on next upsert', async () => {
      const original = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'recovered.yml',
        name: 'Recovered v1',
        ...definitionFields('Recovered v1'),
        ref: 'main',
        source: 'vcs',
      });
      await softDeleteVcsDefinitionsNotIn({
        projectId,
        workspaceId,
        ref: 'main',
        keepConfigPaths: [],
      });

      const restored = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'recovered.yml',
        name: 'Recovered v2',
        ...definitionFields('Recovered v2'),
        ref: 'main',
        source: 'vcs',
      });

      expect(restored.id).toBe(original.id);
      expect(restored.workflowId).toBe(original.workflowId);
      expect(restored.name).toBe('Recovered v2');
      expect(restored.deletedAt).toBeNull();
      const visible = await listDefinitionsByProject(projectId);
      expect(visible.map((definition) => definition.id)).toEqual([restored.id]);
    });

    test('applyVcsDefinitionsBatch upserts and soft-deletes in a single transaction', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'orphaned.yml',
        name: 'Orphan',
        ...definitionFields('Orphan'),
        ref: 'main',
        source: 'vcs',
      });

      const result = await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {
            configPath: 'kept.yml',
            name: 'Kept',
            ...definitionFields('Kept'),
            contentHash: 'h-kept',
          },
          {configPath: 'new.yml', name: 'New', ...definitionFields('New'), contentHash: 'h-new'},
        ],
      });

      expect(result).toEqual({appliedCount: 2, deletedCount: 1});
      const visible = await listDefinitionsByProject(projectId);
      expect(visible.map((definition) => definition.configPath).sort()).toEqual([
        'kept.yml',
        'new.yml',
      ]);
    });

    test('applyVcsDefinitionsBatch skips outbox events for unchanged content hashes', async () => {
      const first = await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {configPath: 'a.yml', name: 'A', ...definitionFields('A'), contentHash: 'h-a-v1'},
          {configPath: 'b.yml', name: 'B', ...definitionFields('B'), contentHash: 'h-b-v1'},
        ],
      });

      expect(first.appliedCount).toBe(2);
      expect(await listOutboxRowsForProject(projectId)).toHaveLength(2);

      const second = await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {configPath: 'a.yml', name: 'A', ...definitionFields('A'), contentHash: 'h-a-v1'},
          {configPath: 'b.yml', name: 'B v2', ...definitionFields('B v2'), contentHash: 'h-b-v2'},
        ],
      });

      expect(second.appliedCount).toBe(1);
      expect(await listOutboxRowsForProject(projectId)).toHaveLength(3);
    });

    test('softDeleteVcsDefinitionsNotIn writes a DEFINITION_DELETED event per pruned row', async () => {
      const pruned = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'orphan.yml',
        name: 'Orphan',
        ...definitionFields('Orphan'),
        ref: 'main',
        source: 'vcs',
      });

      const deletedCount = await softDeleteVcsDefinitionsNotIn({
        projectId,
        workspaceId,
        ref: 'main',
        keepConfigPaths: [],
      });

      expect(deletedCount).toBe(1);
      const outboxRows = await listOutboxRowsForProject(projectId);
      const deletedEvents = outboxRows.filter(
        (row) => row.eventType === 'definitions.definition.deleted',
      );
      expect(deletedEvents).toHaveLength(1);
      expect(deletedEvents[0]?.payload).toEqual({
        definitionId: pruned.id,
        projectId,
        workspaceId,
      });
    });
  });

  describe('invalidateCache', () => {
    test('deletes ref-based entries for matching project and ref', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
        source: 'vcs',
        ref: 'main',
      });

      await invalidateCache({projectId, ref: 'main'});

      const found = await getDefinitionById(definition.id);
      expect(found).toBeUndefined();
    });

    test('does not delete SHA-pinned entries', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
        source: 'vcs',
        sha: 'abc123',
      });

      await invalidateCache({projectId, ref: 'main'});

      const found = await getDefinitionById(definition.id);
      expect(found).toBeDefined();
    });

    test('is a no-op when no matching entries exist', async () => {
      await invalidateCache({projectId: crypto.randomUUID(), ref: 'main'});
    });
  });

  describe('outbox integration', () => {
    test('writes a definitions.definition.resolved event to the outbox', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/test.yml',
        name: 'Test',
        ...definitionFields(),
      });

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]?.eventType).toBe(DEFINITION_RESOLVED);
      expect(outboxRows[0]?.payload).toEqual({
        definitionId: definition.id,
        projectId: definition.projectId,
        workspaceId,
        configPath: definition.configPath,
        triggers: {},
      });
      expect(outboxRows[0]?.dispatchedAt).toBeNull();
    });

    test('writes normalized trigger config to the resolved outbox event', async () => {
      const fields = definitionFieldsForDocument({
        name: 'Nightly',
        runner: 'ubuntu-latest',
        triggers: {
          nightly: {
            source: 'cron',
            event: 'tick',
            config: {schedule: '0 2 * * *'},
          },
        },
        jobs: {build: {steps: [{run: 'echo hello'}]}},
      });
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/nightly.yml',
        name: 'Nightly',
        ...fields,
      });

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]?.payload).toMatchObject({
        definitionId: definition.id,
        triggers: {
          nightly: {
            source: 'cron',
            event: 'tick',
            config: {
              schedule: '0 2 * * *',
              timezone: 'UTC',
            },
          },
        },
      });
    });

    test('writes one outbox event per upsert call', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/test.yml',
        name: 'Test v1',
        ...definitionFields('v1'),
      });

      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/test.yml',
        name: 'Test v2',
        ...definitionFields('v2'),
      });

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(2);
    });

    test('rolls back the outbox event when the transaction fails', async () => {
      const transaction = db().transaction(async (tx) => {
        await tx.insert(definitionsOutbox).values({
          eventType: DEFINITION_RESOLVED,
          payload: {definitionId: 'test', projectId, configPath: 'test'},
        });
        throw new Error('Simulated failure');
      });

      await expect(transaction).rejects.toThrow('Simulated failure');

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(0);
    });
  });

  describe('publisher registry (drainAll + markDispatched)', () => {
    beforeEach(async () => {
      await db()
        .update(definitionsOutbox)
        .set({dispatchedAt: sql`COALESCE(${definitionsOutbox.dispatchedAt}, now())`})
        .where(sql`${definitionsOutbox.dispatchedAt} IS NULL`);
      resetPublishers();
      registerPublisher({
        name: 'definitions',
        table: definitionsOutbox,
        db: () => db(),
      });
    });

    afterEach(async () => {
      resetPublishers();
      await db()
        .update(definitionsOutbox)
        .set({dispatchedAt: sql`COALESCE(${definitionsOutbox.dispatchedAt}, now())`})
        .where(sql`${definitionsOutbox.payload}->>'projectId' = ${projectId}`);
    });

    test('countPendingOutboxRows counts pending rows but excludes dispatched and dead-lettered rows', async () => {
      await insertOutboxRow({projectId, marker: 'pending'});
      await insertOutboxRow({projectId, marker: 'dispatched', dispatchedAt: new Date()});
      await insertOutboxRow({projectId, marker: 'dead-lettered', deadLetteredAt: new Date()});

      const pendingRows = await countPendingOutboxRows();

      expect(pendingRows).toBe(1);
    });

    test('countPendingOutboxRows sums pending rows across every registered publisher', async () => {
      registerPublisher({name: 'definitions-second', table: definitionsOutbox, db: () => db()});
      await insertOutboxRow({projectId, marker: 'pending'});

      const pendingRows = await countPendingOutboxRows();

      expect(pendingRows).toBe(2);
    });

    test('drainAll returns undispatched outbox events', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'test.yml',
        name: 'Test',
        ...definitionFields(),
      });

      const events = (await drainAll()).events;
      const projectEvents = eventsForProject(events, projectId);

      expect(projectEvents).toHaveLength(1);
      expect(projectEvents[0]?.source).toBe('definitions');
      expect(projectEvents[0]?.orderingKey).toBe('definitions');
      expect(projectEvents[0]?.event.type).toBe(DEFINITION_RESOLVED);
    });

    test('drainAll resolves orderingKey from the column', async () => {
      await insertOutboxRow({projectId, marker: 'keyed', orderingKey: 'run-1'});

      const projectEvents = eventsForProject((await drainAll()).events, projectId);

      expect(projectEvents).toHaveLength(1);
      expect(projectEvents[0]?.orderingKey).toBe('run-1');
    });

    test('drainAll blocks later same-key rows while an earlier row waits for retry', async () => {
      const base = new Date(Date.now() - 60_000);
      const retry = await insertOutboxRow({
        projectId,
        marker: 'retry',
        orderingKey: 'run-1',
        createdAt: base,
        nextDispatchAt: new Date(Date.now() + 60 * 60_000),
      });
      await insertOutboxRow({
        projectId,
        marker: 'later-same-key',
        orderingKey: 'run-1',
        createdAt: new Date(base.getTime() + 1_000),
      });
      await insertOutboxRow({
        projectId,
        marker: 'other-key',
        orderingKey: 'run-2',
        createdAt: new Date(base.getTime() + 2_000),
      });

      try {
        const projectEvents = eventsForProject((await drainAll()).events, projectId);

        expect(projectEvents.map((event) => event.id)).not.toContain(retry);
        expect(projectEvents.map((event) => event.event.payload)).toEqual([
          {projectId, marker: 'other-key'},
        ]);
      } finally {
        await db()
          .update(definitionsOutbox)
          .set({dispatchedAt: sql`now()`})
          .where(sql`${definitionsOutbox.payload}->>'projectId' = ${projectId}`);
      }
    });

    test('drainAll reports hasMore when a source returns a full batch', async () => {
      const rows = Array.from({length: BATCH_SIZE}, (_, index) => ({
        id: crypto.randomUUID(),
        eventType: DEFINITION_RESOLVED,
        payload: {projectId, marker: `batch-${index}`},
      }));
      await db().insert(definitionsOutbox).values(rows);

      const drain = await drainAll();

      try {
        expect(drain.events).toHaveLength(BATCH_SIZE);
        expect(drain.hasMore).toBe(true);
      } finally {
        await markDispatched(
          'definitions',
          drain.events.map((event) => event.id),
        );
        await db()
          .update(definitionsOutbox)
          .set({dispatchedAt: sql`now()`})
          .where(sql`${definitionsOutbox.payload}->>'projectId' = ${projectId}`);
      }
    });

    test('concurrent drainAll calls claim each row at most once', async () => {
      await insertOutboxRow({projectId, marker: 'first', orderingKey: 'run-1'});
      await insertOutboxRow({projectId, marker: 'second', orderingKey: 'run-2'});

      const [firstDrain, secondDrain] = await Promise.all([drainAll(), drainAll()]);

      const firstEvents = eventsForProject(firstDrain.events, projectId);
      const secondEvents = eventsForProject(secondDrain.events, projectId);
      const firstIds = new Set(firstEvents.map((event) => event.id));
      const duplicateIds = secondEvents
        .map((event) => event.id)
        .filter((eventId) => firstIds.has(eventId));
      expect(firstEvents.length + secondEvents.length).toBe(2);
      expect(duplicateIds).toEqual([]);
    });

    test('drainAll leases claimed rows so a crashed worker redelivers after the lease expires', async () => {
      const id = await insertOutboxRow({projectId, marker: 'leased', orderingKey: 'run-1'});

      const firstDrain = eventsForProject((await drainAll()).events, projectId);
      const secondDrain = eventsForProject((await drainAll()).events, projectId);
      await db()
        .update(definitionsOutbox)
        .set({nextDispatchAt: sql`now() - interval '1 second'`})
        .where(sql`${definitionsOutbox.id} = ${id}`);
      const redeliveryDrain = eventsForProject((await drainAll()).events, projectId);

      expect(firstDrain.map((event) => event.id)).toEqual([id]);
      expect(secondDrain).toHaveLength(0);
      expect(redeliveryDrain.map((event) => event.id)).toEqual([id]);
    });

    test('renewDispatchClaim extends only the currently owned claim', async () => {
      await insertOutboxRow({projectId, marker: 'renewed', orderingKey: 'run-1'});
      const [event] = eventsForProject((await drainAll()).events, projectId);

      const renewedClaimExpiresAt = await renewDispatchClaim('definitions', {
        id: event?.id as string,
        claimExpiresAt: event?.claimExpiresAt as Date,
      });
      const staleRenewal = await renewDispatchClaim('definitions', {
        id: event?.id as string,
        claimExpiresAt: event?.claimExpiresAt as Date,
      });

      expect(renewedClaimExpiresAt).toBeInstanceOf(Date);
      expect(renewedClaimExpiresAt?.getTime()).toBeGreaterThanOrEqual(
        (event?.claimExpiresAt as Date).getTime(),
      );
      expect(staleRenewal).toBeUndefined();
    });

    test('markDispatched ignores stale claims that have already been renewed', async () => {
      await insertOutboxRow({projectId, marker: 'stale-success', orderingKey: 'run-1'});
      const [event] = eventsForProject((await drainAll()).events, projectId);
      await renewDispatchClaim('definitions', {
        id: event?.id as string,
        claimExpiresAt: event?.claimExpiresAt as Date,
      });

      await markDispatched('definitions', [
        {id: event?.id as string, claimExpiresAt: event?.claimExpiresAt as Date},
      ]);

      const rows = await listOutboxRowsForProject(projectId);
      expect(rows[0]?.dispatchedAt).toBeNull();
    });

    test('recordDispatchFailure ignores stale claims that have already been renewed', async () => {
      const failure: OutboxDispatchFailure = {
        kind: 'handler',
        eventType: DEFINITION_RESOLVED,
        eventId: crypto.randomUUID(),
        errorName: 'Error',
        errorMessage: 'subscriber failed',
      };
      await insertOutboxRow({projectId, marker: 'stale-failure', orderingKey: 'run-1'});
      const [event] = eventsForProject((await drainAll()).events, projectId);
      await renewDispatchClaim('definitions', {
        id: event?.id as string,
        claimExpiresAt: event?.claimExpiresAt as Date,
      });

      await recordDispatchFailure(
        'definitions',
        event?.id as string,
        failure,
        event?.claimExpiresAt as Date,
      );

      const rows = await listOutboxRowsForProject(projectId);
      expect(rows[0]?.dispatchAttempts).toBe(0);
      expect(rows[0]?.lastDispatchError).toBeNull();
    });

    test('partitioned drainAll assigns the same ordering key to one worker', async () => {
      await insertOutboxRow({projectId, marker: 'shared-1', orderingKey: 'run-shared'});
      await insertOutboxRow({projectId, marker: 'shared-2', orderingKey: 'run-shared'});
      await insertOutboxRow({projectId, marker: 'other-1', orderingKey: 'run-other-1'});
      await insertOutboxRow({projectId, marker: 'other-2', orderingKey: 'run-other-2'});
      const workerCount = 4;

      const drains = await Promise.all(
        Array.from({length: workerCount}, (_, workerIndex) =>
          drainAll({partition: {workerIndex, workerCount}}),
        ),
      );

      const partitionsByKey = new Map<string, Set<number>>();
      const projectEvents = drains.flatMap((drain, workerIndex) =>
        eventsForProject(drain.events, projectId).map((event) => ({...event, workerIndex})),
      );
      for (const event of projectEvents) {
        const workers = partitionsByKey.get(event.orderingKey) ?? new Set<number>();
        workers.add(event.workerIndex);
        partitionsByKey.set(event.orderingKey, workers);
      }
      const sharedEvents = projectEvents.filter((event) => event.orderingKey === 'run-shared');
      expect(projectEvents).toHaveLength(4);
      expect(sharedEvents).toHaveLength(2);
      expect(partitionsByKey.get('run-shared')?.size).toBe(1);
    });

    test('markDispatched sets dispatchedAt for a single event', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'test.yml',
        name: 'Test',
        ...definitionFields(),
      });
      const events = eventsForProject((await drainAll()).events, projectId);

      await markDispatched('definitions', [events[0]?.id as string]);

      const rows = await listOutboxRowsForProject(projectId);
      const dispatched = rows.filter((row) => row.dispatchedAt !== null);
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]?.id).toBe(events[0]?.id);
    });

    test('markDispatched sets dispatchedAt for multiple events', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'a.yml',
        name: 'A',
        ...definitionFields('A'),
      });
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'b.yml',
        name: 'B',
        ...definitionFields('B'),
      });
      const events = eventsForProject((await drainAll()).events, projectId);
      const ids = events.map((e) => e.id);

      await markDispatched('definitions', ids);

      const rows = await listOutboxRowsForProject(projectId);
      const pending = rows.filter((row) => row.dispatchedAt === null);
      expect(pending).toHaveLength(0);
    });

    test('drainAll skips already-dispatched events', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'test.yml',
        name: 'Test',
        ...definitionFields(),
      });
      const events = eventsForProject((await drainAll()).events, projectId);
      await markDispatched('definitions', [events[0]?.id as string]);

      const secondDrain = eventsForProject((await drainAll()).events, projectId);

      expect(secondDrain).toHaveLength(0);
    });

    test('drainAll skips rows scheduled for a future retry', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'retry.yml',
        name: 'Retry',
        ...definitionFields(),
      });
      const events = eventsForProject((await drainAll()).events, projectId);
      await db()
        .update(definitionsOutbox)
        .set({nextDispatchAt: sql`now() + interval '1 hour'`})
        .where(sql`${definitionsOutbox.id} = ${events[0]?.id as string}`);

      const secondDrain = eventsForProject((await drainAll()).events, projectId);

      expect(secondDrain).toHaveLength(0);
    });

    test('recordDispatchFailure increments attempts, stores sanitized error metadata, and delays retry', async () => {
      const failure: OutboxDispatchFailure = {
        kind: 'validation',
        eventType: DEFINITION_RESOLVED,
        eventId: crypto.randomUUID(),
        issues: [{path: ['definitionId'], code: 'invalid_type', message: 'expected string'}],
      };
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'failure.yml',
        name: 'Failure',
        ...definitionFields(),
      });
      const before = new Date();
      const events = eventsForProject((await drainAll()).events, projectId);

      await recordDispatchFailure('definitions', events[0]?.id as string, failure);

      const after = new Date();
      const rows = await listOutboxRowsForProject(projectId);
      const secondDrain = eventsForProject((await drainAll()).events, projectId);
      expect(rows[0]?.dispatchAttempts).toBe(1);
      expect(rows[0]?.lastDispatchError).toEqual(failure);
      expect(rows[0]?.lastDispatchFailedAt).toBeInstanceOf(Date);
      expect(rows[0]?.nextDispatchAt.getTime()).toBeGreaterThanOrEqual(before.getTime() + 9_000);
      expect(rows[0]?.nextDispatchAt.getTime()).toBeLessThanOrEqual(after.getTime() + 11_000);
      expect(rows[0]?.deadLetteredAt).toBeNull();
      expect(rows[0]?.dispatchedAt).toBeNull();
      expect(secondDrain).toHaveLength(0);
    });

    test('recordDispatchFailure dead-letters on the fifth failed attempt and excludes the row from future drains', async () => {
      const failure: OutboxDispatchFailure = {
        kind: 'handler',
        eventType: DEFINITION_RESOLVED,
        eventId: crypto.randomUUID(),
        errorName: 'Error',
        errorMessage: 'subscriber failed',
      };
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'poison.yml',
        name: 'Poison',
        ...definitionFields(),
      });
      const events = eventsForProject((await drainAll()).events, projectId);
      await db()
        .update(definitionsOutbox)
        .set({dispatchAttempts: 4})
        .where(sql`${definitionsOutbox.id} = ${events[0]?.id as string}`);

      await recordDispatchFailure('definitions', events[0]?.id as string, failure);

      const rows = await listOutboxRowsForProject(projectId);
      const secondDrain = eventsForProject((await drainAll()).events, projectId);
      expect(rows[0]?.dispatchAttempts).toBe(5);
      expect(rows[0]?.lastDispatchError).toEqual(failure);
      expect(rows[0]?.deadLetteredAt).toBeInstanceOf(Date);
      expect(rows[0]?.dispatchedAt).toBeNull();
      expect(secondDrain).toHaveLength(0);
    });

    test('markDispatched leaves dead-lettered rows inspectable as undispatched', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'dead.yml',
        name: 'Dead',
        ...definitionFields(),
      });
      const events = eventsForProject((await drainAll()).events, projectId);
      await db()
        .update(definitionsOutbox)
        .set({deadLetteredAt: sql`now()`})
        .where(sql`${definitionsOutbox.id} = ${events[0]?.id as string}`);

      await markDispatched('definitions', [events[0]?.id as string]);

      const rows = await listOutboxRowsForProject(projectId);
      expect(rows[0]?.dispatchedAt).toBeNull();
      expect(rows[0]?.deadLetteredAt).toBeInstanceOf(Date);
    });

    test('recordDispatchFailure does not mutate already-dispatched rows', async () => {
      const failure: OutboxDispatchFailure = {
        kind: 'handler',
        eventType: DEFINITION_RESOLVED,
        eventId: crypto.randomUUID(),
        errorName: 'Error',
        errorMessage: 'subscriber failed',
      };
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'dispatched.yml',
        name: 'Dispatched',
        ...definitionFields(),
      });
      const events = eventsForProject((await drainAll()).events, projectId);
      await markDispatched('definitions', [events[0]?.id as string]);

      await recordDispatchFailure('definitions', events[0]?.id as string, failure);

      const rows = await listOutboxRowsForProject(projectId);
      expect(rows[0]?.dispatchAttempts).toBe(0);
      expect(rows[0]?.lastDispatchError).toBeNull();
      expect(rows[0]?.dispatchedAt).toBeInstanceOf(Date);
    });

    test.each([
      {priorAttempts: 1, delaySeconds: 60},
      {priorAttempts: 2, delaySeconds: 300},
      {priorAttempts: 3, delaySeconds: 1800},
    ])('recordDispatchFailure backs off retry by ~$delaySeconds s after $priorAttempts prior attempts', async ({
      priorAttempts,
      delaySeconds,
    }) => {
      const failure: OutboxDispatchFailure = {
        kind: 'handler',
        eventType: DEFINITION_RESOLVED,
        eventId: crypto.randomUUID(),
        errorName: 'Error',
        errorMessage: 'subscriber failed',
      };
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: `backoff-${priorAttempts}.yml`,
        name: `Backoff ${priorAttempts}`,
        ...definitionFields(),
      });
      const events = eventsForProject((await drainAll()).events, projectId);
      await db()
        .update(definitionsOutbox)
        .set({dispatchAttempts: priorAttempts})
        .where(sql`${definitionsOutbox.id} = ${events[0]?.id as string}`);
      const before = new Date();

      await recordDispatchFailure('definitions', events[0]?.id as string, failure);

      const after = new Date();
      const rows = await listOutboxRowsForProject(projectId);
      const delayMs = delaySeconds * 1_000;
      expect(rows[0]?.dispatchAttempts).toBe(priorAttempts + 1);
      expect(rows[0]?.deadLetteredAt).toBeNull();
      expect(rows[0]?.nextDispatchAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime() + delayMs - 1_000,
      );
      expect(rows[0]?.nextDispatchAt.getTime()).toBeLessThanOrEqual(
        after.getTime() + delayMs + 1_000,
      );
    });

    test('redrains a failed row once its retry delay passes, then dispatches it', async () => {
      const failure: OutboxDispatchFailure = {
        kind: 'handler',
        eventType: DEFINITION_RESOLVED,
        eventId: crypto.randomUUID(),
        errorName: 'Error',
        errorMessage: 'subscriber failed',
      };
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'recover.yml',
        name: 'Recover',
        ...definitionFields(),
      });
      const events = eventsForProject((await drainAll()).events, projectId);
      await recordDispatchFailure('definitions', events[0]?.id as string, failure);
      await db()
        .update(definitionsOutbox)
        .set({nextDispatchAt: sql`now() - interval '1 second'`})
        .where(sql`${definitionsOutbox.id} = ${events[0]?.id as string}`);

      const retryDrain = eventsForProject((await drainAll()).events, projectId);
      await markDispatched(
        'definitions',
        retryDrain.map((event) => event.id),
      );

      const rows = await listOutboxRowsForProject(projectId);
      const finalDrain = eventsForProject((await drainAll()).events, projectId);
      expect(retryDrain).toHaveLength(1);
      expect(retryDrain[0]?.id).toBe(events[0]?.id);
      expect(rows[0]?.dispatchAttempts).toBe(1);
      expect(rows[0]?.dispatchedAt).toBeInstanceOf(Date);
      expect(finalDrain).toHaveLength(0);
    });

    test('pruneDispatchedOutboxRows deletes only dispatched rows older than retention', async () => {
      const oldDispatchedAt = new Date(Date.now() - 8 * MS_PER_DAY);
      const recentDispatchedAt = new Date(Date.now() - 6 * MS_PER_DAY);
      await insertOutboxRow({projectId, marker: 'old-dispatched', dispatchedAt: oldDispatchedAt});
      await insertOutboxRow({
        projectId,
        marker: 'recent-dispatched',
        dispatchedAt: recentDispatchedAt,
      });
      await insertOutboxRow({projectId, marker: 'old-pending'});
      await insertOutboxRow({
        projectId,
        marker: 'dead-lettered',
        deadLetteredAt: oldDispatchedAt,
      });

      const result = await pruneDispatchedOutboxRows({
        retentionDays: 7,
        batchSize: 10,
        maxBatchesPerSource: 2,
      });

      const remaining = await listOutboxRowsForProject(projectId);
      const markers = remaining.map((row) => (row.payload as {marker: string}).marker).sort();
      expect(result).toEqual([{source: 'definitions', deleted: 1, capped: false}]);
      expect(markers).toEqual(['dead-lettered', 'old-pending', 'recent-dispatched']);
    });

    test('pruneDispatchedOutboxRows continues across batches', async () => {
      const oldDispatchedAt = new Date(Date.now() - 8 * MS_PER_DAY);
      await insertOutboxRow({projectId, marker: 'old-1', dispatchedAt: oldDispatchedAt});
      await insertOutboxRow({projectId, marker: 'old-2', dispatchedAt: oldDispatchedAt});
      await insertOutboxRow({projectId, marker: 'old-3', dispatchedAt: oldDispatchedAt});

      const result = await pruneDispatchedOutboxRows({
        retentionDays: 7,
        batchSize: 2,
        maxBatchesPerSource: 2,
      });

      const remaining = await listOutboxRowsForProject(projectId);
      expect(result).toEqual([{source: 'definitions', deleted: 3, capped: false}]);
      expect(remaining).toHaveLength(0);
    });

    test('pruneDispatchedOutboxRows reports capped sources', async () => {
      const oldDispatchedAt = new Date(Date.now() - 8 * MS_PER_DAY);
      await insertOutboxRow({projectId, marker: 'old-1', dispatchedAt: oldDispatchedAt});
      await insertOutboxRow({projectId, marker: 'old-2', dispatchedAt: oldDispatchedAt});
      await insertOutboxRow({projectId, marker: 'old-3', dispatchedAt: oldDispatchedAt});

      const result = await pruneDispatchedOutboxRows({
        retentionDays: 7,
        batchSize: 2,
        maxBatchesPerSource: 1,
      });

      const remaining = await listOutboxRowsForProject(projectId);
      expect(result).toEqual([{source: 'definitions', deleted: 2, capped: true}]);
      expect(remaining).toHaveLength(1);
      await db()
        .update(definitionsOutbox)
        .set({dispatchedAt: new Date()})
        .where(sql`${definitionsOutbox.payload}->>'projectId' = ${projectId}`);
    });

    test('pruneDispatchedOutboxRows returns zero when no rows are eligible', async () => {
      await insertOutboxRow({
        projectId,
        marker: 'recent-dispatched',
        dispatchedAt: new Date(Date.now() - 6 * MS_PER_DAY),
      });

      const result = await pruneDispatchedOutboxRows({
        retentionDays: 7,
        batchSize: 10,
        maxBatchesPerSource: 2,
      });

      const remaining = await listOutboxRowsForProject(projectId);
      expect(result).toEqual([{source: 'definitions', deleted: 0, capped: false}]);
      expect(remaining).toHaveLength(1);
    });
  });
});
