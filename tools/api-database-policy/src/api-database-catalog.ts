import {randomUUID} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {drizzle, runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient, type Pool} from '@shipfox/node-postgres';
import {
  type ApiDatabaseRegistry,
  apiDatabaseRegistry,
  auditApiDatabaseRegistry,
  type DatabaseMigrationUnit,
} from './api-database-registry.js';
import {
  auditPostgresCatalog,
  type CatalogAuditReport,
  type CatalogConstraint,
  type CatalogEnum,
  type CatalogMigrationUnitReport,
  type CatalogNamespace,
  type CatalogRelation,
  type CatalogTrigger,
  type ExpectedCatalogObject,
  type ExpectedMigrationHistory,
  expectedHistoryForUnit,
  expectedObjectsAfterMigrations,
  formatCatalogJsonReport,
  formatCatalogReport,
  migrationHistoryName,
  type PostgresCatalog,
  parseMigrationChanges,
} from './catalog.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const databaseNameExpression = /^[a-z][a-z0-9_]{0,62}$/;
const catalogExecutionErrorExitCode = 2;

interface MigrationSource {
  path: string;
  source: string;
}

interface PreparedMigrationUnit {
  unit: DatabaseMigrationUnit;
  sources: readonly MigrationSource[];
  runtimeHistoryName: string;
}

export interface VerifyCatalogOptions {
  databaseName?: string;
  registry?: ApiDatabaseRegistry;
  repositoryRoot?: string;
}

export interface CatalogCliOptions {
  databaseName?: string;
  format: 'human' | 'json';
  help: boolean;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function quoteIdentifier(value: string): string {
  if (!databaseNameExpression.test(value)) {
    throw new Error(`Invalid PostgreSQL database name: ${value}`);
  }
  return `"${value}"`;
}

function generatedDatabaseName(): string {
  return `shipfox_catalog_${randomUUID().replaceAll('-', '')}`;
}

async function readMigrationSources(
  unit: DatabaseMigrationUnit,
  root: string,
): Promise<readonly MigrationSource[]> {
  const directory = path.join(root, unit.migrationsPath);
  const entries = await readdir(directory, {withFileTypes: true});
  const migrationFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort(compareText);
  return Promise.all(
    migrationFiles.map(async (fileName) => ({
      path: path.posix.join(unit.migrationsPath, fileName),
      source: await readFile(path.join(directory, fileName), 'utf8'),
    })),
  );
}

export function resolveCurrentMigrationHistoryName({
  unit,
}: {
  unit: DatabaseMigrationUnit;
  registry: ApiDatabaseRegistry;
  root?: string;
}): string {
  return migrationHistoryName(unit.namespace);
}

function prepareMigrationUnits(
  registry: ApiDatabaseRegistry,
  root: string,
): Promise<readonly PreparedMigrationUnit[]> {
  return Promise.all(
    registry.migrationUnits.map(async (unit) => ({
      unit,
      sources: await readMigrationSources(unit, root),
      runtimeHistoryName: resolveCurrentMigrationHistoryName({unit, registry, root}),
    })),
  );
}

function expectedObjectsForUnits(
  preparedUnits: readonly PreparedMigrationUnit[],
): ExpectedCatalogObject[] {
  return expectedObjectsAfterMigrations(
    preparedUnits.flatMap(({unit, sources}) =>
      sources.flatMap(({path: sourcePath, source}) =>
        parseMigrationChanges({source, sourcePath, unit}),
      ),
    ),
  );
}

function expectedHistoriesForUnits(
  preparedUnits: readonly PreparedMigrationUnit[],
): ExpectedMigrationHistory[] {
  return preparedUnits.map(({unit, runtimeHistoryName}) =>
    expectedHistoryForUnit(unit, runtimeHistoryName),
  );
}

function migrationUnitReports(
  preparedUnits: readonly PreparedMigrationUnit[],
): CatalogMigrationUnitReport[] {
  return preparedUnits.map(({unit, sources, runtimeHistoryName}) => ({
    id: unit.id,
    ownerId: unit.ownerId,
    namespace: unit.namespace,
    migrations: sources.length,
    runtimeMigrationHistoryName: runtimeHistoryName,
    canonicalMigrationHistoryName: migrationHistoryName(unit.namespace),
  }));
}

async function queryRows<T extends Record<string, string | null>>(
  pool: Pool,
  query: string,
): Promise<T[]> {
  const result = await pool.query<T>(query);
  return result.rows;
}

export async function readPostgresCatalog(pool: Pool): Promise<PostgresCatalog> {
  const [namespaceRows, relationRows, enumRows, constraintRows, triggerRows] = await Promise.all([
    queryRows<CatalogNamespace & Record<string, string | null>>(
      pool,
      `
        SELECT n.oid::text AS oid, n.nspname AS name
        FROM pg_namespace AS n
        WHERE n.nspname IN ('public', 'drizzle')
           OR (n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema')
        ORDER BY n.nspname
      `,
    ),
    queryRows<Record<string, string | null>>(
      pool,
      `
        SELECT
          c.oid::text AS oid,
          n.nspname AS schema_name,
          c.relname AS name,
          c.relkind AS relkind,
          COALESCE(i.indrelid, dependency.refobjid)::text AS relation_oid
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        LEFT JOIN pg_index AS i ON i.indexrelid = c.oid
        LEFT JOIN (
          SELECT objid, min(refobjid) AS refobjid
          FROM pg_depend
          WHERE classid = 'pg_class'::regclass
            AND refclassid = 'pg_class'::regclass
            AND deptype = 'a'
          GROUP BY objid
        ) AS dependency ON dependency.objid = c.oid
        WHERE n.nspname NOT LIKE 'pg_%'
          AND n.nspname <> 'information_schema'
          AND c.relkind IN ('r', 'p', 'f', 'i', 'I', 'S', 'v', 'm')
        ORDER BY n.nspname, c.relname
      `,
    ),
    queryRows<Record<string, string | null>>(
      pool,
      `
        SELECT t.oid::text AS oid, n.nspname AS schema_name, t.typname AS name
        FROM pg_type AS t
        JOIN pg_namespace AS n ON n.oid = t.typnamespace
        WHERE t.typtype = 'e'
          AND n.nspname NOT LIKE 'pg_%'
          AND n.nspname <> 'information_schema'
        ORDER BY n.nspname, t.typname
      `,
    ),
    queryRows<Record<string, string | null>>(
      pool,
      `
        SELECT
          con.oid::text AS oid,
          ns.nspname AS schema_name,
          con.conname AS name,
          con.contype AS type,
          source.oid::text AS relation_oid,
          source_ns.nspname AS relation_schema_name,
          source.relname AS relation_name,
          referenced.oid::text AS referenced_relation_oid,
          referenced_ns.nspname AS referenced_relation_schema_name,
          referenced.relname AS referenced_relation_name
        FROM pg_constraint AS con
        JOIN pg_namespace AS ns ON ns.oid = con.connamespace
        LEFT JOIN pg_class AS source ON source.oid = con.conrelid
        LEFT JOIN pg_namespace AS source_ns ON source_ns.oid = source.relnamespace
        LEFT JOIN pg_class AS referenced ON referenced.oid = con.confrelid
        LEFT JOIN pg_namespace AS referenced_ns ON referenced_ns.oid = referenced.relnamespace
        WHERE ns.nspname NOT LIKE 'pg_%'
          AND ns.nspname <> 'information_schema'
        ORDER BY ns.nspname, con.conname
      `,
    ),
    queryRows<Record<string, string | null>>(
      pool,
      `
        SELECT
          trigger.oid::text AS oid,
          ns.nspname AS schema_name,
          trigger.tgname AS name,
          relation.oid::text AS relation_oid,
          relation.relname AS relation_name
        FROM pg_trigger AS trigger
        JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
        JOIN pg_namespace AS ns ON ns.oid = relation.relnamespace
        WHERE NOT trigger.tgisinternal
          AND ns.nspname NOT LIKE 'pg_%'
          AND ns.nspname <> 'information_schema'
        ORDER BY ns.nspname, trigger.tgname
      `,
    ),
  ]);

  const namespaces: CatalogNamespace[] = namespaceRows.map((row) => ({
    oid: row.oid,
    name: row.name,
  }));
  const relations: CatalogRelation[] = relationRows.map((row) => ({
    oid: row.oid ?? '',
    schemaName: row.schema_name ?? '',
    name: row.name ?? '',
    relkind: row.relkind ?? '',
    relationOid: row.relation_oid ?? null,
  }));
  const enums: CatalogEnum[] = enumRows.map((row) => ({
    oid: row.oid ?? '',
    schemaName: row.schema_name ?? '',
    name: row.name ?? '',
  }));
  const constraints: CatalogConstraint[] = constraintRows.map((row) => ({
    oid: row.oid ?? '',
    schemaName: row.schema_name ?? '',
    name: row.name ?? '',
    type: row.type ?? '',
    relationOid: row.relation_oid ?? null,
    relationSchemaName: row.relation_schema_name ?? null,
    relationName: row.relation_name ?? null,
    referencedRelationOid: row.referenced_relation_oid ?? null,
    referencedRelationSchemaName: row.referenced_relation_schema_name ?? null,
    referencedRelationName: row.referenced_relation_name ?? null,
  }));
  const triggers: CatalogTrigger[] = triggerRows.map((row) => ({
    oid: row.oid ?? '',
    schemaName: row.schema_name ?? '',
    name: row.name ?? '',
    relationOid: row.relation_oid ?? '',
    relationName: row.relation_name ?? '',
  }));
  return {namespaces, relations, enums, constraints, triggers};
}

async function serverVersion(pool: Pool): Promise<{version: string; versionNumber: number}> {
  const result = await pool.query<{version: string; version_number: string}>(
    `SELECT current_setting('server_version') AS version, current_setting('server_version_num') AS version_number`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('PostgreSQL did not return its server version');
  return {version: row.version, versionNumber: Number(row.version_number)};
}

async function databaseExists(pool: Pool, databaseName: string): Promise<boolean> {
  const result = await pool.query<{datname: string}>(
    'SELECT datname FROM pg_database WHERE datname = $1',
    [databaseName],
  );
  return result.rowCount === 1;
}

async function databaseHasUserObjects(pool: Pool): Promise<boolean> {
  const namespaces = await pool.query<{count: string}>(`
    SELECT count(*)::text AS count
    FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%'
      AND nspname <> 'information_schema'
      AND nspname <> 'public'
  `);
  if (Number(namespaces.rows[0]?.count ?? 0) > 0) return true;

  const relations = await pool.query<{count: string}>(`
    SELECT count(*)::text AS count
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r', 'p', 'f', 'i', 'I', 'S', 'v', 'm')
  `);
  if (Number(relations.rows[0]?.count ?? 0) > 0) return true;

  const enums = await pool.query<{count: string}>(`
    SELECT count(*)::text AS count
    FROM pg_type AS t
    JOIN pg_namespace AS n ON n.oid = t.typnamespace
    WHERE t.typtype = 'e'
      AND n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
  `);
  return Number(enums.rows[0]?.count ?? 0) > 0;
}

async function createDatabase(adminPool: Pool, databaseName: string): Promise<void> {
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
}

async function dropDatabase(adminPool: Pool, databaseName: string): Promise<void> {
  await adminPool.query(`DROP DATABASE ${quoteIdentifier(databaseName)} WITH (FORCE)`);
}

async function closePool(): Promise<void> {
  await closePostgresClient();
}

async function cleanupCatalogResources({
  adminDatabaseName,
  databaseName,
  targetCreated,
  adminPool,
  targetPool,
}: {
  adminDatabaseName: string;
  databaseName: string;
  targetCreated: boolean;
  adminPool: Pool | undefined;
  targetPool: Pool | undefined;
}): Promise<void> {
  let cleanupError: unknown;
  try {
    if (targetPool) await closePool();
    else if (adminPool) await closePool();
  } catch (error) {
    cleanupError = error;
  }

  if (targetCreated) {
    // A failed shutdown can leave the shared client occupied; retry before opening the admin client.
    try {
      await closePool();
    } catch (error) {
      if (!cleanupError) cleanupError = error;
    }
    try {
      const cleanupPool = createPostgresClient({database: adminDatabaseName});
      await dropDatabase(cleanupPool, databaseName);
    } catch (error) {
      if (!cleanupError) cleanupError = error;
    }
    try {
      await closePool();
    } catch (error) {
      if (!cleanupError) cleanupError = error;
    }
  }

  if (cleanupError) throw cleanupError;
}

async function verifyRegistry(registry: ApiDatabaseRegistry): Promise<void> {
  const errors = await auditApiDatabaseRegistry(registry);
  if (errors.length > 0) {
    throw new Error(`API database registry failed (${errors.length} errors): ${errors.join('; ')}`);
  }
}

export async function verifyFreshCatalog({
  databaseName: requestedDatabaseName,
  registry = apiDatabaseRegistry,
  repositoryRoot: root = repositoryRoot,
}: VerifyCatalogOptions = {}): Promise<CatalogAuditReport> {
  await verifyRegistry(registry);
  const adminDatabaseName = process.env.POSTGRES_DATABASE || 'api';
  const databaseName = requestedDatabaseName ?? generatedDatabaseName();
  if (databaseName === adminDatabaseName) {
    throw new Error('The catalog target must not be the configured administrative database');
  }
  quoteIdentifier(databaseName);

  const generated = requestedDatabaseName === undefined;
  let targetCreated = false;
  let adminPool: Pool | undefined;
  let targetPool: Pool | undefined;
  let report: CatalogAuditReport | undefined;
  let verificationError: unknown;
  try {
    adminPool = createPostgresClient({database: adminDatabaseName});
    if (await databaseExists(adminPool, databaseName)) {
      if (generated) throw new Error(`Generated catalog database already exists: ${databaseName}`);
      await closePool();
      targetPool = createPostgresClient({database: databaseName});
      if (await databaseHasUserObjects(targetPool)) {
        throw new Error(`Catalog target database is not empty: ${databaseName}`);
      }
      await closePool();
      targetPool = undefined;
    } else {
      if (!generated) throw new Error(`Catalog target database does not exist: ${databaseName}`);
      await createDatabase(adminPool, databaseName);
      targetCreated = true;
      await closePool();
      adminPool = undefined;
    }

    const preparedUnits = await prepareMigrationUnits(registry, root);
    const expectedObjects = expectedObjectsForUnits(preparedUnits);
    const expectedHistories = expectedHistoriesForUnits(preparedUnits);
    const reports = migrationUnitReports(preparedUnits);

    targetPool = createPostgresClient({database: databaseName});
    const version = await serverVersion(targetPool);
    if (Math.floor(version.versionNumber / 10_000) !== 18) {
      throw new Error(`Catalog verification requires PostgreSQL 18, found ${version.version}`);
    }
    const database = drizzle(targetPool);
    for (const prepared of preparedUnits) {
      await runMigrations(
        database,
        path.join(root, prepared.unit.migrationsPath),
        prepared.runtimeHistoryName,
      );
    }
    const catalog = await readPostgresCatalog(targetPool);
    report = auditPostgresCatalog({
      catalog,
      expectedObjects,
      expectedHistories,
      migrationUnits: reports,
      registry,
      databaseName,
      serverVersion: version.version,
    });
  } catch (error) {
    verificationError = error;
  }

  let cleanupError: unknown;
  try {
    await cleanupCatalogResources({
      adminDatabaseName,
      databaseName,
      targetCreated,
      adminPool,
      targetPool,
    });
  } catch (error) {
    cleanupError = error;
  }

  if (verificationError) throw verificationError;
  if (cleanupError) throw cleanupError;
  if (!report) throw new Error('Catalog verification completed without a report');
  return report;
}

export function parseCatalogCliArgs(
  argv: readonly string[] = process.argv.slice(2),
): CatalogCliOptions {
  let databaseName: string | undefined;
  let format: CatalogCliOptions['format'] = 'human';
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
    } else if (argument === '--json' || argument === '--format=json') {
      format = 'json';
    } else if (argument === '--format') {
      const value = argv[index + 1];
      if (value !== 'human' && value !== 'json')
        throw new Error(`Unsupported catalog format: ${value}`);
      format = value;
      index += 1;
    } else if (argument === '--database') {
      databaseName = argv[index + 1];
      if (!databaseName) throw new Error('--database requires a value');
      index += 1;
    } else if (argument?.startsWith('--database=')) {
      databaseName = argument.slice('--database='.length);
      if (!databaseName) throw new Error('--database requires a value');
    } else {
      throw new Error(`Unknown catalog option: ${argument}`);
    }
  }
  return {
    ...(databaseName ? {databaseName} : {}),
    format,
    help,
  };
}

function catalogHelp(): string {
  return [
    'Usage: pnpm --filter=@shipfox/api-database-policy verify:catalog [options]',
    '',
    'Options:',
    '  --database <name>  Audit an existing empty database instead of a generated temporary database',
    '  --json             Emit the complete report as JSON',
    '  --format <format>  Emit human or json output (default: human)',
    '  --help             Show this help',
  ].join('\n');
}

async function main(): Promise<void> {
  const options = parseCatalogCliArgs();
  if (options.help) {
    process.stdout.write(`${catalogHelp()}\n`);
    return;
  }
  const report = await verifyFreshCatalog(
    options.databaseName ? {databaseName: options.databaseName} : {},
  );
  process.stdout.write(
    options.format === 'json' ? formatCatalogJsonReport(report) : formatCatalogReport(report),
  );
  if (report.findings.length > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`API database catalog verification failed: ${message}\n`);
    process.exitCode = catalogExecutionErrorExitCode;
  });
}
