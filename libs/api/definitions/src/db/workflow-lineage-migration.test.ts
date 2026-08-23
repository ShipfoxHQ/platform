import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import {migrationsPath} from '#db/index.js';

const ADMIN_DATABASE = process.env.POSTGRES_DATABASE ?? 'api_test';

function connectTo(database: string): Promise<pg.Client> {
  const client = new pg.Client({
    host: process.env.POSTGRES_DIRECT_HOST ?? process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database,
    user: process.env.POSTGRES_USERNAME ?? 'shipfox',
    password: process.env.POSTGRES_PASSWORD ?? 'password',
  });
  return client.connect().then(() => client);
}

async function applyMigration(client: pg.Client, fileName: string): Promise<void> {
  const source = await readFile(path.join(migrationsPath, fileName), 'utf8');
  const statements = source
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await client.query(statement);
  }
}

async function insertDefinition(
  client: pg.Client,
  params: {
    id: string;
    projectId: string;
    configPath?: string | null;
    source?: 'manual' | 'vcs';
    ref?: string | null;
    deleted?: boolean;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO "definitions_workflow_definitions"
       ("id", "project_id", "config_path", "source", "ref", "name", "definition", "deleted_at")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.id,
      params.projectId,
      params.configPath ?? null,
      params.source ?? 'manual',
      params.ref ?? null,
      `Workflow ${params.id.slice(0, 8)}`,
      JSON.stringify({document: {name: 'x'}, model: {}}),
      params.deleted ? new Date().toISOString() : null,
    ],
  );
}

describe('workflow lineage backfill migration (0003)', () => {
  test('creates one lineage per (project_id, config_path) and backfills workflow_id', async () => {
    const scratch = `api_test_lineage_${randomUUID().replaceAll('-', '')}`;
    const admin = await connectTo(ADMIN_DATABASE);
    let target: pg.Client | undefined;
    try {
      await admin.query(`CREATE DATABASE "${scratch}"`);
      target = await connectTo(scratch);

      await applyMigration(target, '0000_initial.sql');
      await applyMigration(target, '0001_definition_list_pagination.sql');
      await applyMigration(target, '0002_lumpy_ben_parker.sql');

      const projectA = randomUUID();
      const projectB = randomUUID();
      const rowA = randomUUID();
      const rowManual = randomUUID();
      const rowVcs = randomUUID();
      const rowBranchMain = randomUUID();
      const rowBranchDev = randomUUID();
      const rowGone = randomUUID();
      const rowNoPath = randomUUID();
      const rowNoPathSecond = randomUUID();

      await insertDefinition(target, {
        id: rowA,
        projectId: projectA,
        configPath: 'a.yml',
        source: 'vcs',
        ref: 'main',
      });
      await insertDefinition(target, {
        id: rowManual,
        projectId: projectA,
        configPath: 'shared.yml',
      });
      await insertDefinition(target, {
        id: rowVcs,
        projectId: projectA,
        configPath: 'shared.yml',
        source: 'vcs',
        ref: 'main',
      });
      await insertDefinition(target, {
        id: rowBranchMain,
        projectId: projectA,
        configPath: 'branches.yml',
        source: 'vcs',
        ref: 'main',
      });
      await insertDefinition(target, {
        id: rowBranchDev,
        projectId: projectA,
        configPath: 'branches.yml',
        source: 'vcs',
        ref: 'dev',
      });
      await insertDefinition(target, {
        id: rowGone,
        projectId: projectA,
        configPath: 'gone.yml',
        source: 'vcs',
        ref: 'main',
        deleted: true,
      });
      await insertDefinition(target, {id: rowNoPath, projectId: projectB});
      await insertDefinition(target, {id: rowNoPathSecond, projectId: projectB});

      await applyMigration(target, '0003_nebulous_nemesis.sql');

      const rows = (
        await target.query<{id: string; workflow_id: string; config_path: string | null}>(
          `SELECT "id", "workflow_id", "config_path"
           FROM "definitions_workflow_definitions" ORDER BY "id"`,
        )
      ).rows;
      const workflows = (
        await target.query<{id: string; config_path: string | null}>(
          `SELECT "id", "config_path" FROM "definitions_workflows" ORDER BY "id"`,
        )
      ).rows;

      expect(rows).toHaveLength(8);
      expect(workflows).toHaveLength(5);

      const workflowIdByRow = new Map(rows.map((row) => [row.id, row.workflow_id]));
      // The ref IS NOT NULL row wins when several rows share a path.
      expect(workflowIdByRow.get(rowA)).toBe(rowA);
      expect(workflowIdByRow.get(rowVcs)).toBe(rowVcs);
      expect(workflowIdByRow.get(rowManual)).toBe(rowVcs);
      // Ties between ref rows break on the smallest row id.
      const branchWinner = rowBranchMain < rowBranchDev ? rowBranchMain : rowBranchDev;
      expect(workflowIdByRow.get(rowBranchMain)).toBe(branchWinner);
      expect(workflowIdByRow.get(rowBranchDev)).toBe(branchWinner);
      // Soft-deleted rows keep their lineage.
      expect(workflowIdByRow.get(rowGone)).toBe(rowGone);
      // Rows without a config path share one project-scoped lineage.
      const noPathWorkflowId = workflowIdByRow.get(rowNoPath);
      expect(noPathWorkflowId).toBeDefined();
      expect(workflowIdByRow.get(rowNoPathSecond)).toBe(noPathWorkflowId);

      const lineageIds = new Set(workflows.map((workflow) => workflow.id));
      for (const row of rows) {
        expect(lineageIds.has(row.workflow_id)).toBe(true);
      }
      const noPathLineage = workflows.find((workflow) => workflow.id === noPathWorkflowId);
      expect(noPathLineage).toBeDefined();
      expect(workflows.find((workflow) => workflow.id === rowVcs)?.config_path).toBe('shared.yml');
      expect(workflows.find((workflow) => workflow.id === rowGone)?.config_path).toBe('gone.yml');

      // The unique (project_id, config_path) constraint accepts a second project
      // with the same path.
      await target.query(
        `INSERT INTO "definitions_workflows" ("id", "project_id", "config_path")
         VALUES ($1, $2, 'a.yml')`,
        [randomUUID(), projectB],
      );
    } finally {
      await target?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
      await admin.end();
    }
  });
});
