import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  parseCatalogCliArgs,
  resolveCurrentMigrationHistoryName,
} from '../src/api-database-catalog.js';
import {
  type ApiDatabaseRegistry,
  apiDatabaseRegistry,
  type DatabaseMigrationUnit,
} from '../src/api-database-registry.js';
import {
  auditPostgresCatalog,
  type CatalogAuditReport,
  type CatalogConstraint,
  type CatalogMigrationUnitReport,
  type CatalogRelation,
  dedupeExpectedObjects,
  type ExpectedCatalogObject,
  expectedHistoryForUnit,
  expectedObjectsAfterMigrations,
  formatCatalogJsonReport,
  migrationHistoryName,
  type PostgresCatalog,
  parseMigrationChanges,
  parseMigrationSql,
} from '../src/catalog.js';

const unknownOptionExpression = /Unknown catalog option/;
const invalidDatabaseNameExpression = /Invalid PostgreSQL database name: invalid-name/;

const agentUnit: DatabaseMigrationUnit = {
  id: 'agent',
  ownerId: 'agent',
  namespace: 'agent',
  packagePath: 'libs/api/agent',
  drizzleConfigPath: 'libs/api/agent/drizzle.config.ts',
  migrationsPath: 'libs/api/agent/drizzle',
};
const workspacesUnit: DatabaseMigrationUnit = {
  id: 'workspaces',
  ownerId: 'workspaces',
  namespace: 'workspaces',
  packagePath: 'libs/api/workspaces',
  drizzleConfigPath: 'libs/api/workspaces/drizzle.config.ts',
  migrationsPath: 'libs/api/workspaces/drizzle',
};

const registry: ApiDatabaseRegistry = {
  owners: [
    {id: 'agent', packagePath: agentUnit.packagePath},
    {id: 'workspaces', packagePath: workspacesUnit.packagePath},
  ],
  migrationUnits: [agentUnit, workspacesUnit],
  delegates: [],
};

function relation(name: string, schemaName = 'public'): CatalogRelation {
  return {oid: `${schemaName}-${name}`, schemaName, name, relkind: 'r'};
}

function expectedTable(unit: DatabaseMigrationUnit, name: string): ExpectedCatalogObject {
  return {
    kind: 'table',
    schemaName: 'public',
    name,
    ownerId: unit.ownerId,
    migrationUnitId: unit.id,
    namespace: unit.namespace,
    sourcePath: `${unit.migrationsPath}/0000_test.sql`,
    line: 1,
  };
}

function expectedConstraint(
  unit: DatabaseMigrationUnit,
  name: string,
  relationName = 'agent_jobs',
): ExpectedCatalogObject {
  return {
    kind: 'constraint',
    schemaName: 'public',
    name,
    ownerId: unit.ownerId,
    migrationUnitId: unit.id,
    namespace: unit.namespace,
    relationName,
    sourcePath: `${unit.migrationsPath}/0000_test.sql`,
    line: 1,
  };
}

function unitReport(unit: DatabaseMigrationUnit): CatalogMigrationUnitReport {
  return {
    id: unit.id,
    ownerId: unit.ownerId,
    namespace: unit.namespace,
    migrations: 1,
    runtimeMigrationHistoryName: migrationHistoryName(unit.namespace),
    canonicalMigrationHistoryName: migrationHistoryName(unit.namespace),
  };
}

function catalog(
  relations: readonly CatalogRelation[] = [],
  constraints: readonly CatalogConstraint[] = [],
): PostgresCatalog {
  return {
    namespaces: [
      {oid: 'public', name: 'public'},
      {oid: 'drizzle', name: 'drizzle'},
    ],
    relations: [...relations, relation(migrationHistoryName('agent'), 'drizzle')],
    enums: [],
    constraints,
    triggers: [],
  };
}

function audit(
  expectedObjects: readonly ExpectedCatalogObject[],
  postgresCatalog: PostgresCatalog,
  expectedHistories = [expectedHistoryForUnit(agentUnit, migrationHistoryName('agent'))],
): CatalogAuditReport {
  return auditPostgresCatalog({
    catalog: postgresCatalog,
    expectedObjects,
    expectedHistories,
    migrationUnits: [unitReport(agentUnit)],
    registry,
  });
}

function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/catalog/${name}`, import.meta.url), 'utf8');
}

describe('PostgreSQL catalog verifier', () => {
  test('parses current migration SQL, including inline constraints', () => {
    const unit = apiDatabaseRegistry.migrationUnits.find((candidate) => candidate.id === 'agent');
    if (!unit) throw new Error('Expected the Agent migration unit');

    const objects = parseMigrationSql({
      source: readFileSync(
        new URL('../../../libs/api/agent/drizzle/0000_daffy_leopardon.sql', import.meta.url),
        'utf8',
      ),
      sourcePath: 'libs/api/agent/drizzle/0000_daffy_leopardon.sql',
      unit,
    });

    assert.deepEqual(
      objects.map(({kind, name}) => `${kind}:${name}`),
      [
        'enum:agent_model_provider_config_kind',
        'table:agent_model_provider_configs',
        'table:agent_workspace_settings',
        'index:agent_model_provider_configs_workspace_provider_unique',
        'constraint:agent_model_provider_configs_custom_required_fields',
      ],
    );
  });

  test('parses ALTER TABLE IF EXISTS constraints against the real relation', () => {
    const objects = parseMigrationSql({
      source:
        'ALTER TABLE IF EXISTS "public"."workspaces_runs" ADD CONSTRAINT "workspaces_runs_check" CHECK (true);',
      sourcePath: 'test/fixtures/catalog/alter-if-exists.sql',
      unit: workspacesUnit,
    });

    assert.deepEqual(
      objects.map(({kind, name, relationName, schemaName}) => ({
        kind,
        name,
        relationName,
        schemaName,
      })),
      [
        {
          kind: 'constraint',
          name: 'workspaces_runs_check',
          relationName: 'workspaces_runs',
          schemaName: 'public',
        },
      ],
    );
  });

  test('removes dropped tables and dependent indexes from catalog expectations', () => {
    const initialChanges = parseMigrationChanges({
      source: `
        CREATE TABLE "agent_jobs" ("id" uuid NOT NULL);
        CREATE TABLE "agent_rate_limits" ("id" uuid NOT NULL);
        CREATE UNIQUE INDEX "agent_rate_limits_window_unique" ON "agent_rate_limits" USING btree ("id");
        CREATE INDEX "agent_rate_limits_expires_at_idx" ON "agent_rate_limits" USING btree ("id");
      `,
      sourcePath: 'test/fixtures/catalog/0000_initial.sql',
      unit: agentUnit,
    });
    const removalChanges = parseMigrationChanges({
      source: 'DROP TABLE IF EXISTS "agent_rate_limits" CASCADE;',
      sourcePath: 'test/fixtures/catalog/0001_remove_rate_limits.sql',
      unit: agentUnit,
    });

    const objects = expectedObjectsAfterMigrations([...initialChanges, ...removalChanges]);

    assert.deepEqual(
      objects.map(({kind, name}) => `${kind}:${name}`),
      ['table:agent_jobs'],
    );
  });

  test('removes foreign keys that cascade with a dropped referenced table', () => {
    const initialChanges = parseMigrationChanges({
      source: `
        CREATE TABLE "agent_workspaces" ("id" uuid NOT NULL);
        CREATE TABLE "agent_jobs" (
          "id" uuid NOT NULL,
          "workspace_id" uuid NOT NULL,
          CONSTRAINT "agent_jobs_workspace_id_fk"
            FOREIGN KEY ("workspace_id") REFERENCES "agent_workspaces" ("id")
        );
      `,
      sourcePath: 'test/fixtures/catalog/0000_initial.sql',
      unit: agentUnit,
    });
    const removalChanges = parseMigrationChanges({
      source: 'DROP TABLE "agent_workspaces" CASCADE;',
      sourcePath: 'test/fixtures/catalog/0001_remove_workspaces.sql',
      unit: agentUnit,
    });

    const objects = expectedObjectsAfterMigrations([...initialChanges, ...removalChanges]);

    assert.deepEqual(
      objects.map(({kind, name}) => `${kind}:${name}`),
      ['table:agent_jobs'],
    );
  });

  test('removes views that cascade with a dropped referenced table', () => {
    const initialChanges = parseMigrationChanges({
      source: `
        CREATE TABLE "agent_workspaces" ("id" uuid NOT NULL);
        CREATE VIEW "agent_workspace_view" AS
          SELECT "id" FROM "agent_workspaces";
      `,
      sourcePath: 'test/fixtures/catalog/0000_initial.sql',
      unit: agentUnit,
    });
    const removalChanges = parseMigrationChanges({
      source: 'DROP TABLE "agent_workspaces" CASCADE;',
      sourcePath: 'test/fixtures/catalog/0001_remove_workspaces.sql',
      unit: agentUnit,
    });

    const objects = expectedObjectsAfterMigrations([...initialChanges, ...removalChanges]);

    assert.deepEqual(objects, []);
  });

  test('applies DROP TYPE and DROP CONSTRAINT IF EXISTS changes', () => {
    const initialChanges = parseMigrationChanges({
      source: `
        CREATE TYPE "agent_status" AS ENUM ('ready');
        CREATE TABLE "agent_jobs" ("id" uuid NOT NULL);
        ALTER TABLE "agent_jobs"
          ADD CONSTRAINT "agent_jobs_check" CHECK (true);
      `,
      sourcePath: 'test/fixtures/catalog/0000_initial.sql',
      unit: agentUnit,
    });
    const removalChanges = parseMigrationChanges({
      source: `
        ALTER TABLE IF EXISTS "agent_jobs"
          DROP CONSTRAINT IF EXISTS "agent_jobs_check";
        DROP TYPE IF EXISTS "agent_status";
      `,
      sourcePath: 'test/fixtures/catalog/0001_remove_status.sql',
      unit: agentUnit,
    });

    const objects = expectedObjectsAfterMigrations([...initialChanges, ...removalChanges]);

    assert.deepEqual(
      objects.map(({kind, name}) => `${kind}:${name}`),
      ['table:agent_jobs'],
    );
  });

  test('ignores DDL-looking text inside dollar-quoted function bodies', () => {
    const objects = parseMigrationSql({
      source: `
        CREATE FUNCTION "agent_fake"() RETURNS trigger
        LANGUAGE plpgsql AS $fn$
        BEGIN
          EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (true)', 'agent_phantom', 'agent_phantom_check');
          RETURN NEW;
        END;
        $fn$;
        CREATE TABLE "agent_jobs" ("id" uuid NOT NULL);
        CREATE TABLE "agent_records" (
          "description" text DEFAULT $$literal;with semicolon$$,
          CONSTRAINT "agent_records_check" CHECK (true)
        );
      `,
      sourcePath: 'test/fixtures/catalog/dollar-quoted.sql',
      unit: agentUnit,
    });

    assert.deepEqual(
      objects.map(({kind, name, relationName}) => ({kind, name, relationName})),
      [
        {kind: 'table', name: 'agent_jobs', relationName: undefined},
        {kind: 'table', name: 'agent_records', relationName: undefined},
        {kind: 'constraint', name: 'agent_records_check', relationName: 'agent_records'},
      ],
    );
  });

  test('classifies a foreign-owner fixture', () => {
    const objects = parseMigrationSql({
      source: readFixture('foreign.sql'),
      sourcePath: 'test/fixtures/catalog/foreign.sql',
      unit: agentUnit,
    });
    const report = audit(objects, catalog([relation('workspaces_runs')]));

    assert.deepEqual(
      report.findings.map(({classification, name}) => ({classification, name})),
      [{classification: 'cross-owner', name: 'workspaces_runs'}],
    );
  });

  test('classifies an unprefixed fixture', () => {
    const objects = parseMigrationSql({
      source: readFixture('unprefixed.sql'),
      sourcePath: 'test/fixtures/catalog/unprefixed.sql',
      unit: agentUnit,
    });
    const report = audit(objects, catalog([relation('jobs')]));

    assert.deepEqual(
      report.findings.map(({classification, name}) => ({classification, name})),
      [{classification: 'misnamed', name: 'jobs'}],
    );
  });

  test('reports a cross-owner foreign key exactly once', () => {
    const foreignKeyName = 'agent_jobs_workspace_id_workspaces_runs_id_fk';
    const constraint: CatalogConstraint = {
      oid: 'constraint-1',
      schemaName: 'public',
      name: foreignKeyName,
      type: 'f',
      relationOid: 'public-agent_jobs',
      relationSchemaName: 'public',
      relationName: 'agent_jobs',
      referencedRelationOid: 'public-workspaces_runs',
      referencedRelationSchemaName: 'public',
      referencedRelationName: 'workspaces_runs',
    };
    const report = audit(
      [
        expectedTable(agentUnit, 'agent_jobs'),
        expectedTable(workspacesUnit, 'workspaces_runs'),
        expectedConstraint(agentUnit, foreignKeyName),
      ],
      catalog([relation('agent_jobs'), relation('workspaces_runs')], [constraint]),
    );

    assert.deepEqual(
      report.findings.map(({classification, name}) => ({classification, name})),
      [{classification: 'cross-owner', name: foreignKeyName}],
    );
  });

  test('matches PostgreSQL-truncated identifiers', () => {
    const longName = `agent_${'long_constraint_name_'.repeat(5)}`;
    const truncatedName = longName.slice(0, 63);
    const report = audit(
      [expectedTable(agentUnit, 'agent_jobs'), expectedConstraint(agentUnit, longName)],
      catalog(
        [relation('agent_jobs')],
        [
          {
            oid: 'constraint-1',
            schemaName: 'public',
            name: truncatedName,
            type: 'c',
            relationOid: 'public-agent_jobs',
            relationSchemaName: 'public',
            relationName: 'agent_jobs',
            referencedRelationOid: null,
            referencedRelationSchemaName: null,
            referencedRelationName: null,
          },
        ],
      ),
    );

    assert.deepEqual(report.findings, []);
  });

  test('reports missing and unknown catalog objects', () => {
    const report = audit(
      [expectedTable(agentUnit, 'agent_jobs')],
      catalog([relation('rogue_table')]),
    );

    assert.deepEqual(
      report.findings.map(({classification, name}) => ({classification, name})),
      [
        {classification: 'missing', name: 'agent_jobs'},
        {classification: 'unknown', name: 'rogue_table'},
      ],
    );
  });

  test('checks the runtime migration-history name against the canonical name', () => {
    const runtimeName = `${migrationHistoryName('agent')}_legacy`;
    const report = audit(
      [expectedTable(agentUnit, 'agent_jobs')],
      {
        ...catalog([relation('agent_jobs')]),
        relations: [relation('agent_jobs'), relation(runtimeName, 'drizzle')],
      },
      [expectedHistoryForUnit(agentUnit, runtimeName)],
    );

    assert.deepEqual(
      report.findings.map(({classification, name}) => ({classification, name})),
      [{classification: 'misnamed', name: runtimeName}],
    );
  });

  test('resolves migration history from the stable database namespace', () => {
    assert.equal(
      resolveCurrentMigrationHistoryName({unit: workspacesUnit, registry}),
      migrationHistoryName(workspacesUnit.namespace),
    );
  });

  test('keeps ownership-conflicting duplicate declarations visible', () => {
    const objects = dedupeExpectedObjects([
      expectedTable(agentUnit, 'agent_shared'),
      expectedTable(workspacesUnit, 'agent_shared'),
    ]);
    assert.equal(objects.length, 2);

    const report = audit(objects, catalog([relation('agent_shared')]));
    assert.deepEqual(
      report.findings.map(({classification, name}) => ({classification, name})),
      [{classification: 'cross-owner', name: 'agent_shared'}],
    );
  });

  test('emits a JSON report without connection details', () => {
    const report = audit([expectedTable(agentUnit, 'jobs')], catalog([relation('jobs')]));
    const json = formatCatalogJsonReport(report);

    assert.equal(json.includes('password'), false);
    assert.equal(json.includes('postgres://'), false);
    assert.equal(JSON.parse(json).findings[0].classification, 'misnamed');
  });

  test('parses catalog CLI formats and rejects unknown options', () => {
    assert.deepEqual(parseCatalogCliArgs(['--database', 'catalog', '--format', 'json']), {
      databaseName: 'catalog',
      format: 'json',
      help: false,
    });
    assert.deepEqual(parseCatalogCliArgs(['--help']), {
      format: 'human',
      help: true,
    });
    assert.throws(() => parseCatalogCliArgs(['--unknown']), unknownOptionExpression);
  });

  test('uses a distinct exit code for catalog execution errors', () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../dist/api-database-catalog.js', import.meta.url)),
        '--database=invalid-name',
      ],
      {encoding: 'utf8'},
    );

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, invalidDatabaseNameExpression);
  });
});
