import {DEFINITION_RESOLVED} from '@shipfox/api-definitions-dto';
import {
  type DrainedEvent,
  drainAll,
  markDispatched,
  registerPublisher,
  resetPublishers,
} from '@shipfox/node-module';
import {sql} from 'drizzle-orm';
import type {WorkflowSpec} from '#core/entities/definition.js';
import {db} from './db.js';
import {
  getDefinitionById,
  invalidateCache,
  listDefinitionsByProject,
  upsertDefinition,
} from './definitions.js';
import {definitionsOutbox} from './schema/outbox.js';

function spec(name = 'Test Workflow'): WorkflowSpec {
  return {
    name,
    jobs: {build: {steps: [{run: 'echo hello'}]}},
  };
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

describe('definition queries', () => {
  let projectId: string;

  beforeEach(() => {
    projectId = crypto.randomUUID();
  });

  describe('upsertDefinition', () => {
    test('inserts a new definition and returns entity with id and timestamps', async () => {
      const definition = await upsertDefinition({
        projectId,
        configPath: '.shipfox/workflows/test.yml',
        name: 'Test',
        definition: spec(),
      });

      expect(definition.id).toBeDefined();
      expect(definition.projectId).toBe(projectId);
      expect(definition.configPath).toBe('.shipfox/workflows/test.yml');
      expect(definition.name).toBe('Test');
      expect(definition.definition).toEqual(spec());
      expect(definition.sha).toBeNull();
      expect(definition.ref).toBeNull();
      expect(definition.fetchedAt).toBeInstanceOf(Date);
      expect(definition.createdAt).toBeInstanceOf(Date);
      expect(definition.updatedAt).toBeInstanceOf(Date);
    });

    test('updates existing definition on conflict (same project_id + config_path)', async () => {
      const first = await upsertDefinition({
        projectId,
        configPath: '.shipfox/workflows/deploy.yml',
        name: 'Deploy v1',
        definition: spec('Deploy v1'),
      });

      const second = await upsertDefinition({
        projectId,
        configPath: '.shipfox/workflows/deploy.yml',
        name: 'Deploy v2',
        definition: spec('Deploy v2'),
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('Deploy v2');
      expect(second.definition.name).toBe('Deploy v2');
      expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
      expect(second.updatedAt).not.toEqual(first.updatedAt);
    });

    test('with sha inserts SHA-pinned definition', async () => {
      const definition = await upsertDefinition({
        projectId,
        configPath: 'ci.yml',
        name: 'CI',
        definition: spec('CI'),
        sha: 'abc123',
      });

      expect(definition.sha).toBe('abc123');
      expect(definition.ref).toBeNull();
    });

    test('with sha updates on conflict (same projectId + sha + configPath)', async () => {
      const first = await upsertDefinition({
        projectId,
        configPath: 'ci.yml',
        name: 'CI v1',
        definition: spec('CI v1'),
        sha: 'abc123',
      });

      const second = await upsertDefinition({
        projectId,
        configPath: 'ci.yml',
        name: 'CI v2',
        definition: spec('CI v2'),
        sha: 'abc123',
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('CI v2');
    });

    test('with ref inserts ref-based definition', async () => {
      const definition = await upsertDefinition({
        projectId,
        configPath: 'ci.yml',
        name: 'CI',
        definition: spec('CI'),
        ref: 'main',
      });

      expect(definition.ref).toBe('main');
      expect(definition.sha).toBeNull();
    });

    test('with ref updates on conflict (same projectId + ref + configPath)', async () => {
      const first = await upsertDefinition({
        projectId,
        configPath: 'ci.yml',
        name: 'CI v1',
        definition: spec('CI v1'),
        ref: 'main',
      });

      const second = await upsertDefinition({
        projectId,
        configPath: 'ci.yml',
        name: 'CI v2',
        definition: spec('CI v2'),
        ref: 'main',
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('CI v2');
    });

    test('with neither sha nor ref uses base constraint', async () => {
      const first = await upsertDefinition({
        projectId,
        configPath: 'ci.yml',
        name: 'CI v1',
        definition: spec('CI v1'),
      });

      const second = await upsertDefinition({
        projectId,
        configPath: 'ci.yml',
        name: 'CI v2',
        definition: spec('CI v2'),
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('CI v2');
    });

    test('sets fetchedAt on insert', async () => {
      const definition = await upsertDefinition({
        projectId,
        configPath: 'ci.yml',
        name: 'CI',
        definition: spec('CI'),
      });

      expect(definition.fetchedAt).toBeInstanceOf(Date);
    });

    test('updates fetchedAt on conflict update', async () => {
      const first = await upsertDefinition({
        projectId,
        configPath: 'ci.yml',
        name: 'CI v1',
        definition: spec('CI v1'),
      });

      const second = await upsertDefinition({
        projectId,
        configPath: 'ci.yml',
        name: 'CI v2',
        definition: spec('CI v2'),
      });

      expect(second.fetchedAt.getTime()).toBeGreaterThanOrEqual(first.fetchedAt.getTime());
    });
  });

  describe('getDefinitionById', () => {
    test('returns the definition when found', async () => {
      const created = await upsertDefinition({
        projectId,
        configPath: '.shipfox/workflows/ci.yml',
        name: 'CI',
        definition: spec('CI'),
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
        configPath: 'z.yml',
        name: 'Zulu',
        definition: spec('Zulu'),
      });
      await upsertDefinition({
        projectId,
        configPath: 'a.yml',
        name: 'Alpha',
        definition: spec('Alpha'),
      });
      await upsertDefinition({
        projectId,
        configPath: 'm.yml',
        name: 'Mike',
        definition: spec('Mike'),
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

  describe('invalidateCache', () => {
    test('deletes ref-based entries for matching project and ref', async () => {
      const definition = await upsertDefinition({
        projectId,
        configPath: 'ci.yml',
        name: 'CI',
        definition: spec('CI'),
        ref: 'main',
      });

      await invalidateCache({projectId, ref: 'main'});

      const found = await getDefinitionById(definition.id);
      expect(found).toBeUndefined();
    });

    test('does not delete SHA-pinned entries', async () => {
      const definition = await upsertDefinition({
        projectId,
        configPath: 'ci.yml',
        name: 'CI',
        definition: spec('CI'),
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
    beforeEach(async () => {
      await db().execute(sql`TRUNCATE definitions_outbox CASCADE`);
    });

    test('writes a definitions.definition.resolved event to the outbox', async () => {
      const definition = await upsertDefinition({
        projectId,
        configPath: '.shipfox/workflows/test.yml',
        name: 'Test',
        definition: spec(),
      });

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]?.eventType).toBe(DEFINITION_RESOLVED);
      expect(outboxRows[0]?.payload).toEqual({
        definitionId: definition.id,
        projectId: definition.projectId,
        configPath: definition.configPath,
      });
      expect(outboxRows[0]?.dispatchedAt).toBeNull();
    });

    test('writes one outbox event per upsert call', async () => {
      await upsertDefinition({
        projectId,
        configPath: '.shipfox/workflows/test.yml',
        name: 'Test v1',
        definition: spec('v1'),
      });

      await upsertDefinition({
        projectId,
        configPath: '.shipfox/workflows/test.yml',
        name: 'Test v2',
        definition: spec('v2'),
      });

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(2);
    });

    test('rolls back the outbox event when the transaction fails', async () => {
      try {
        await db().transaction(async (tx) => {
          await tx.insert(definitionsOutbox).values({
            eventType: DEFINITION_RESOLVED,
            payload: {definitionId: 'test', projectId, configPath: 'test'},
          });
          throw new Error('Simulated failure');
        });
      } catch {
        // expected
      }

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(0);
    });
  });

  describe('publisher registry (drainAll + markDispatched)', () => {
    beforeEach(async () => {
      resetPublishers();
      await db().execute(sql`TRUNCATE definitions_outbox CASCADE`);
      registerPublisher({
        name: 'definitions',
        table: definitionsOutbox,
        db: () => db(),
      });
    });

    afterEach(() => {
      resetPublishers();
    });

    test('drainAll returns undispatched outbox events', async () => {
      await upsertDefinition({
        projectId,
        configPath: 'test.yml',
        name: 'Test',
        definition: spec(),
      });

      const events = await drainAll();
      const projectEvents = eventsForProject(events, projectId);

      expect(projectEvents).toHaveLength(1);
      expect(projectEvents[0]?.source).toBe('definitions');
      expect(projectEvents[0]?.event.type).toBe(DEFINITION_RESOLVED);
    });

    test('markDispatched sets dispatchedAt for a single event', async () => {
      await upsertDefinition({
        projectId,
        configPath: 'test.yml',
        name: 'Test',
        definition: spec(),
      });
      const events = eventsForProject(await drainAll(), projectId);

      await markDispatched('definitions', [events[0]?.id as string]);

      const rows = await listOutboxRowsForProject(projectId);
      const dispatched = rows.filter((row) => row.dispatchedAt !== null);
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]?.id).toBe(events[0]?.id);
    });

    test('markDispatched sets dispatchedAt for multiple events', async () => {
      await upsertDefinition({
        projectId,
        configPath: 'a.yml',
        name: 'A',
        definition: spec('A'),
      });
      await upsertDefinition({
        projectId,
        configPath: 'b.yml',
        name: 'B',
        definition: spec('B'),
      });
      const events = eventsForProject(await drainAll(), projectId);
      const ids = events.map((e) => e.id);

      await markDispatched('definitions', ids);

      const rows = await listOutboxRowsForProject(projectId);
      const pending = rows.filter((row) => row.dispatchedAt === null);
      expect(pending).toHaveLength(0);
    });

    test('drainAll skips already-dispatched events', async () => {
      await upsertDefinition({
        projectId,
        configPath: 'test.yml',
        name: 'Test',
        definition: spec(),
      });
      const events = eventsForProject(await drainAll(), projectId);
      await markDispatched('definitions', [events[0]?.id as string]);

      const secondDrain = eventsForProject(await drainAll(), projectId);

      expect(secondDrain).toHaveLength(0);
    });
  });
});
