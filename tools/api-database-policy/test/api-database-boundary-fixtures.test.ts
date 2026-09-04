import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {
  auditApiDatabaseBoundaries,
  type DatabaseBoundaryFinding,
} from '../src/api-database-boundaries.js';
import type {ApiDatabaseRegistry} from '../src/api-database-registry.js';

const fixtureRegistry: ApiDatabaseRegistry = {
  owners: [
    {id: 'alpha', packagePath: 'libs/api/alpha'},
    {id: 'beta', packagePath: 'libs/api/beta'},
    {id: 'integrations', packagePath: 'libs/api/integrations/core'},
    {id: 'missing', packagePath: 'libs/api/missing'},
  ],
  migrationUnits: [
    {
      id: 'alpha',
      ownerId: 'alpha',
      namespace: 'alpha',
      packagePath: 'libs/api/alpha',
      drizzleConfigPath: 'libs/api/alpha/drizzle.config.ts',
      migrationsPath: 'libs/api/alpha/drizzle',
    },
    {
      id: 'beta',
      ownerId: 'beta',
      namespace: 'beta',
      packagePath: 'libs/api/beta',
      drizzleConfigPath: 'libs/api/beta/drizzle.config.ts',
      migrationsPath: 'libs/api/beta/drizzle',
    },
    {
      id: 'integrations-core',
      ownerId: 'integrations',
      namespace: 'integrations',
      packagePath: 'libs/api/integrations/core',
      drizzleConfigPath: 'libs/api/integrations/core/drizzle.config.ts',
      migrationsPath: 'libs/api/integrations/core/drizzle',
    },
    {
      id: 'integrations-provider',
      ownerId: 'integrations',
      namespace: 'integrations_provider',
      packagePath: 'libs/api/integrations/provider',
      drizzleConfigPath: 'libs/api/integrations/provider/drizzle.config.ts',
      migrationsPath: 'libs/api/integrations/provider/drizzle',
    },
  ],
  delegates: [],
};
const emptyObjectRegistry: ApiDatabaseRegistry = {
  owners: fixtureRegistry.owners.slice(0, 1),
  migrationUnits: fixtureRegistry.migrationUnits.slice(0, 1),
  delegates: [],
};
const nonEmptyOutputPattern = /./u;

async function writeFixture(
  rootDirectory: string,
  relativePath: string,
  source: string,
): Promise<void> {
  const absolutePath = join(rootDirectory, relativePath);
  await mkdir(dirname(absolutePath), {recursive: true});
  await writeFile(absolutePath, source);
}
async function createFixtureRepository(rootDirectory: string): Promise<void> {
  const packageManifests: ReadonlyArray<readonly [string, string]> = [
    ['libs/api/alpha/package.json', '@fixture/alpha'],
    ['libs/api/beta/package.json', '@fixture/beta'],
    ['libs/api/integrations/core/package.json', '@fixture/integrations-core'],
    ['libs/api/integrations/provider/package.json', '@fixture/integrations-provider'],
  ];
  for (const [relativePath, name] of packageManifests) {
    await writeFixture(rootDirectory, relativePath, JSON.stringify({name}));
  }
  for (const unit of fixtureRegistry.migrationUnits) {
    await writeFixture(rootDirectory, unit.drizzleConfigPath, 'export default {}');
  }
  await writeFixture(
    rootDirectory,
    'libs/api/alpha/drizzle/0000_legacy.sql',
    [
      'CREATE TABLE "alpha_owned" ("id" text PRIMARY KEY);',
      'CREATE TABLE "legacy_table" ("id" text PRIMARY KEY);',
      'ALTER TABLE "beta_owned" ADD COLUMN "foreign_column" text;',
      'DROP TABLE "beta_owned";',
    ].join('\n'),
  );
  await writeFixture(
    rootDirectory,
    'libs/api/beta/drizzle/0000_owned.sql',
    'CREATE TABLE "beta_owned" ("id" text PRIMARY KEY);\n',
  );
  await writeFixture(
    rootDirectory,
    'libs/api/beta/src/db/schema/common.ts',
    [
      "import {pgTableCreator} from 'drizzle-orm/pg-core';",
      `export const pgTable = pgTableCreator((name) => name === 'root' ? name : \`beta_\${name}\`);`,
    ].join('\n'),
  );
  await writeFixture(
    rootDirectory,
    'libs/api/beta/src/accepted-root.ts',
    [
      "import {pgTable} from './db/schema/common.js';",
      "export const rootTable = pgTable('root', {});",
    ].join('\n'),
  );
  await writeFixture(
    rootDirectory,
    'libs/api/integrations/core/drizzle/0000_core.sql',
    'CREATE TABLE "integrations_core_owned" ("id" text PRIMARY KEY);\n',
  );
  await writeFixture(
    rootDirectory,
    'libs/api/integrations/provider/drizzle/0000_provider.sql',
    'CREATE TABLE "integrations_provider_owned" ("id" text PRIMARY KEY);\n',
  );
  await writeFixture(
    rootDirectory,
    'libs/api/alpha/src/db/schema/common.ts',
    [
      "import {pgTableCreator} from 'drizzle-orm/pg-core';",
      `export const pgTable = pgTableCreator((name) => \`alpha_\${name}\`);`,
    ].join('\n'),
  );
  await writeFixture(
    rootDirectory,
    'libs/api/alpha/src/db/schema/local.ts',
    [
      "import {pgTable} from './common.js';",
      "export const localTable = pgTable('local', {});",
    ].join('\n'),
  );
  await writeFixture(
    rootDirectory,
    'libs/api/alpha/src/violations.ts',
    [
      "import {pgEnum, pgTable, pgTableCreator, text} from 'drizzle-orm/pg-core';",
      "import {ownedTable} from '@fixture/beta';",
      "import {betaModule} from '@fixture/beta';",
      "import {sql} from 'drizzle-orm';",
      "export const unprefixedKind = pgEnum('kind', ['one']);",
      "export const foreignTable = pgTable('beta_owned', {});",
      "export const localTable = pgTable('alpha_declared', {});",
      `const foreignTableCreator = pgTableCreator((name) => \`beta_\${name}\`);`,
      "export const copiedTable = foreignTableCreator('copied');",
      "export const crossOwnerReference = pgTable('alpha_reference', {",
      "  foreignId: text('foreign_id').references(() => ownedTable.id),",
      '});',
      'betaModule.database;',
      'const tableName = betaModule.name;',
      'const selected = sql`SELECT * FROM beta_owned JOIN beta_owned ON true`;',
      'const truncated = sql`TRUNCATE beta_owned`;',
      'const locked = sql`LOCK TABLE beta_owned`;',
      `const dynamic = sql\`SELECT * FROM \${tableName}\`;`,
      'void [selected, truncated, locked, dynamic];',
    ].join('\n'),
  );
  await writeFixture(
    rootDirectory,
    'libs/api/alpha/src/raw-sql.ts',
    [
      "import {sql} from 'drizzle-orm';",
      "export const selected = sql.raw('SELECT * FROM beta_owned');",
    ].join('\n'),
  );
  await writeFixture(
    rootDirectory,
    'libs/api/integrations/provider/src/db/schema/common.ts',
    [
      "import {pgTableCreator} from 'drizzle-orm/pg-core';",
      `export const pgTable = pgTableCreator((name) => \`integrations_provider_\${name}\`);`,
    ].join('\n'),
  );
  await writeFixture(
    rootDirectory,
    'libs/api/integrations/provider/src/accepted.ts',
    [
      "import {pgTable} from './db/schema/common.js';",
      "import {sql} from 'drizzle-orm';",
      "export const providerTable = pgTable('local', {});",
      'export const sharedQuery = sql`SELECT * FROM integrations_core_owned`;',
      "export const sharedRawQuery = sql.raw('SELECT * FROM integrations_core_owned');",
      'export const registeredQuery = sql`SELECT * FROM $' + '{providerTable}`;',
    ].join('\n'),
  );
  await writeFixture(
    rootDirectory,
    'libs/api/alpha/drizzle/meta/0000_snapshot.json',
    '{malformed snapshot',
  );
  await writeFixture(
    rootDirectory,
    'libs/shared/node/drizzle/src/registered-runner.ts',
    [
      "import {runMigrations} from '@fixture/migration-runner';",
      "runMigrations('alpha', '__drizzle_migrations_alpha');",
    ].join('\n'),
  );
  await writeFixture(
    rootDirectory,
    'libs/shared/node/module/src/initialize.ts',
    [
      'const moduleMigrationTableName = "__drizzle_migrations_module";',
      'const migrationsTableName = database.migrationsTableName ?? moduleMigrationTableName;',
      'void migrationsTableName;',
    ].join('\n'),
  );
  await writeFixture(
    rootDirectory,
    'libs/api/alpha/extra/drizzle.config.ts',
    'export default {};\n',
  );
}
function rulesByName(findings: readonly DatabaseBoundaryFinding[]): Set<string> {
  return new Set(findings.map((finding) => finding.rule));
}
describe('database boundary verifier fixtures', () => {
  test('rejects the required ownership and naming violations while accepting registered boundaries', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'shipfox-api-database-fixtures-'));
    try {
      await createFixtureRepository(rootDirectory);
      const findings = await auditApiDatabaseBoundaries({
        registry: fixtureRegistry,
        rootDirectory,
      });
      const rules = rulesByName(findings);
      for (const rule of [
        'direct-table-declaration',
        'dynamic-sql-identifier',
        'foreign-database-access',
        'foreign-key',
        'foreign-migration',
        'foreign-raw-sql',
        'foreign-table-declaration',
        'migration-history-instability',
        'unprefixed-enum',
        'unprefixed-table',
        'unregistered-migration-unit',
      ]) {
        assert.ok(rules.has(rule), `fixture did not produce ${rule}`);
      }
      assert.ok(
        findings.some(
          (finding) =>
            finding.file === 'libs/api/alpha/src/violations.ts' &&
            finding.object === 'ownedTable.references' &&
            finding.rule === 'foreign-key',
        ),
      );
      assert.ok(
        findings.some(
          (finding) =>
            finding.file === 'libs/api/alpha/src/raw-sql.ts' &&
            finding.object === 'beta_owned' &&
            finding.rule === 'foreign-raw-sql',
        ),
      );
      assert.doesNotMatch(
        findings
          .filter((finding) => finding.file.includes('/accepted.ts'))
          .map((finding) => finding.rule)
          .join(','),
        nonEmptyOutputPattern,
      );
      assert.doesNotMatch(
        findings
          .filter((finding) => finding.file === 'libs/api/beta/src/accepted-root.ts')
          .map((finding) => finding.rule)
          .join(','),
        nonEmptyOutputPattern,
      );
      assert.doesNotMatch(
        findings
          .filter((finding) => finding.file.includes('registered-runner.ts'))
          .map((finding) => finding.rule)
          .join(','),
        nonEmptyOutputPattern,
      );
    } finally {
      await rm(rootDirectory, {force: true, recursive: true});
    }
  });

  test('skips static SQL auditing when the registry has no database objects', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'shipfox-api-database-empty-'));
    try {
      await writeFixture(rootDirectory, 'libs/api/alpha/package.json', '{"name":"@fixture/alpha"}');
      await writeFixture(rootDirectory, 'libs/api/alpha/drizzle.config.ts', 'export default {}');
      await writeFixture(
        rootDirectory,
        'libs/api/alpha/src/query.ts',
        [
          "import {sql} from 'drizzle-orm';",
          'export const query = sql`SELECT * FROM beta_owned`;',
        ].join('\n'),
      );

      assert.deepEqual(
        await auditApiDatabaseBoundaries({
          registry: emptyObjectRegistry,
          rootDirectory,
        }),
        [],
      );
    } finally {
      await rm(rootDirectory, {force: true, recursive: true});
    }
  });
});
