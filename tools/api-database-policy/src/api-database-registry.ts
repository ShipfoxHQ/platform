import {readdir, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {architecturePackages} = require('../../../api-contexts.cjs') as {
  architecturePackages: ArchitecturePackages;
};
const {databaseRegistry} = require('../../../api-databases.cjs') as {
  databaseRegistry: ApiDatabaseRegistry;
};
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const namespaceExpression = /^[a-z][a-z0-9_]*$/;
const expectedDelegates = [
  {
    id: 'migration-runner',
    packagePath: 'libs/shared/node/drizzle',
    capability: 'migration-runner',
  },
  {
    id: 'schema-table-factory',
    packagePath: 'libs/shared/node/outbox',
    capability: 'schema-table-factory',
  },
  {
    id: 'owner-local-outbox-writer',
    packagePath: 'libs/shared/node/outbox',
    capability: 'owner-local-outbox-writer',
  },
  {
    id: 'registered-outbox-dispatcher',
    packagePath: 'libs/shared/node/module',
    capability: 'registered-outbox-dispatcher',
  },
] as const;

export interface DatabaseOwner {
  id: string;
  packagePath: string;
}

export interface DatabaseMigrationUnit {
  id: string;
  ownerId: string;
  namespace: string;
  packagePath: string;
  drizzleConfigPath: string;
  migrationsPath: string;
}

export interface DatabaseDelegate {
  id: string;
  packagePath: string;
  capability: string;
}

export interface ApiDatabaseRegistry {
  owners: readonly DatabaseOwner[];
  migrationUnits: readonly DatabaseMigrationUnit[];
  delegates: readonly DatabaseDelegate[];
}

interface ArchitecturePackages {
  [classification: string]: {
    [context: string]: string[];
  };
}

interface ClassifiedPath {
  classification: string;
  context: string;
}

export interface ValidateApiDatabaseRegistryOptions {
  architecturePackages?: ArchitecturePackages;
  discoveredDrizzleConfigPaths?: ReadonlySet<string>;
  existingPaths?: ReadonlySet<string>;
}

export const apiDatabaseRegistry = databaseRegistry;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function classifiedPaths(packages: ArchitecturePackages): Map<string, ClassifiedPath> {
  const result = new Map<string, ClassifiedPath>();

  for (const [classification, contexts] of Object.entries(packages)) {
    for (const [context, packagePaths] of Object.entries(contexts)) {
      for (const packagePath of packagePaths) {
        result.set(packagePath, {classification, context});
      }
    }
  }

  return result;
}

function addMissingPathError(
  errors: string[],
  existingPaths: ReadonlySet<string> | undefined,
  registeredPath: string,
): void {
  if (existingPaths && !existingPaths.has(registeredPath)) {
    errors.push(`Missing registered path: ${registeredPath}`);
  }
}

function addUniqueIdentifierError(errors: string[], kind: string, values: readonly string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) errors.push(`Duplicate ${kind}: ${value}`);
    seen.add(value);
  }
}

function isNestedPath(parentPath: string, childPath: string): boolean {
  const relativePath = path.posix.relative(parentPath, childPath);
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith('../') &&
    !path.posix.isAbsolute(relativePath)
  );
}

function validateExpectedDelegates(errors: string[], delegates: readonly DatabaseDelegate[]): void {
  const delegatesById = new Map(delegates.map((delegate) => [delegate.id, delegate]));
  for (const expectedDelegate of expectedDelegates) {
    const delegate = delegatesById.get(expectedDelegate.id);
    if (!delegate) {
      errors.push(`Missing database delegate: ${expectedDelegate.id}`);
      continue;
    }
    if (
      delegate.packagePath !== expectedDelegate.packagePath ||
      delegate.capability !== expectedDelegate.capability
    ) {
      errors.push(`Database delegate definition mismatch: ${expectedDelegate.id}`);
    }
  }
  for (const delegate of delegates) {
    if (!expectedDelegates.some((expected) => expected.id === delegate.id)) {
      errors.push(`Unexpected database delegate: ${delegate.id}`);
    }
  }
}

export function validateApiDatabaseRegistry(
  registry: ApiDatabaseRegistry = databaseRegistry,
  options: ValidateApiDatabaseRegistryOptions = {},
): string[] {
  const packages = classifiedPaths(options.architecturePackages ?? architecturePackages);
  const errors: string[] = [];
  const ownerById = new Map<string, DatabaseOwner>();
  const ownerClassificationById = new Map<string, ClassifiedPath>();
  validateUniqueRegistryIdentifiers(registry, errors);

  for (const owner of registry.owners) {
    ownerById.set(owner.id, owner);
    validateRegistryOwner(owner, packages, options.existingPaths, errors, ownerClassificationById);
  }

  const namespacesByOwner = new Map<string, number>();
  for (const unit of registry.migrationUnits) {
    validateMigrationUnit(
      unit,
      packages,
      options.existingPaths,
      ownerById,
      ownerClassificationById,
      namespacesByOwner,
      errors,
    );
  }

  for (const owner of registry.owners) {
    if (!namespacesByOwner.has(owner.id)) {
      errors.push(`Database owner has no namespace: ${owner.id}`);
    }
  }

  for (const delegate of registry.delegates) {
    validateRegistryDelegate(delegate, packages, options.existingPaths, errors);
  }

  validateExpectedDelegates(errors, registry.delegates);

  validateDiscoveredDrizzleConfigs(registry, options.discoveredDrizzleConfigPaths, errors);

  return errors.sort(compareText);
}

function validateUniqueRegistryIdentifiers(registry: ApiDatabaseRegistry, errors: string[]): void {
  const identifiers: Array<[string, readonly string[]]> = [
    ['database owner ID', registry.owners.map((owner) => owner.id)],
    ['migration unit ID', registry.migrationUnits.map((unit) => unit.id)],
    ['database namespace', registry.migrationUnits.map((unit) => unit.namespace)],
    ['migration unit package path', registry.migrationUnits.map((unit) => unit.packagePath)],
    [
      'migration unit Drizzle config path',
      registry.migrationUnits.map((unit) => unit.drizzleConfigPath),
    ],
    ['migration unit migrations path', registry.migrationUnits.map((unit) => unit.migrationsPath)],
    ['database delegate ID', registry.delegates.map((delegate) => delegate.id)],
  ];
  for (const [kind, values] of identifiers) addUniqueIdentifierError(errors, kind, values);
}

function validateRegistryOwner(
  owner: DatabaseOwner,
  packages: ReadonlyMap<string, ClassifiedPath>,
  existingPaths: ReadonlySet<string> | undefined,
  errors: string[],
  classifications: Map<string, ClassifiedPath>,
): void {
  addMissingPathError(errors, existingPaths, owner.packagePath);
  const classification = packages.get(owner.packagePath);
  if (!classification) {
    errors.push(`Database owner package is not classified: ${owner.packagePath}`);
    return;
  }
  if (
    classification.classification !== 'implementations' &&
    classification.classification !== 'shared-infrastructure'
  ) {
    errors.push(`Database owner package has an incompatible classification: ${owner.packagePath}`);
    return;
  }
  if (classification.classification === 'implementations' && classification.context !== owner.id) {
    errors.push(
      `Database owner ID does not match API context: ${owner.id} (${classification.context})`,
    );
  }
  if (
    classification.classification === 'shared-infrastructure' &&
    path.posix.basename(owner.packagePath) !== owner.id
  ) {
    errors.push(`Database owner ID does not match package path: ${owner.id}`);
  }
  classifications.set(owner.id, classification);
}

function validateMigrationUnit(
  unit: ApiDatabaseRegistry['migrationUnits'][number],
  packages: ReadonlyMap<string, ClassifiedPath>,
  existingPaths: ReadonlySet<string> | undefined,
  owners: ReadonlyMap<string, DatabaseOwner>,
  ownerClassifications: ReadonlyMap<string, ClassifiedPath>,
  namespacesByOwner: Map<string, number>,
  errors: string[],
): void {
  if (!owners.has(unit.ownerId)) errors.push(`Unknown database owner: ${unit.ownerId}`);
  if (!namespaceExpression.test(unit.namespace)) {
    errors.push(`Invalid database namespace: ${unit.namespace}`);
  }
  namespacesByOwner.set(unit.ownerId, (namespacesByOwner.get(unit.ownerId) ?? 0) + 1);
  for (const registeredPath of [unit.packagePath, unit.drizzleConfigPath, unit.migrationsPath]) {
    addMissingPathError(errors, existingPaths, registeredPath);
  }
  if (!isNestedPath(unit.packagePath, unit.drizzleConfigPath)) {
    errors.push(`Drizzle config path is outside migration unit package: ${unit.id}`);
  }
  if (!isNestedPath(unit.packagePath, unit.migrationsPath)) {
    errors.push(`Migrations path is outside migration unit package: ${unit.id}`);
  }
  validateMigrationUnitClassification(unit, packages, ownerClassifications, errors);
}

function validateMigrationUnitClassification(
  unit: ApiDatabaseRegistry['migrationUnits'][number],
  packages: ReadonlyMap<string, ClassifiedPath>,
  ownerClassifications: ReadonlyMap<string, ClassifiedPath>,
  errors: string[],
): void {
  const unitClassification = packages.get(unit.packagePath);
  const ownerClassification = ownerClassifications.get(unit.ownerId);
  if (!unitClassification) {
    errors.push(`Database migration unit package is not classified: ${unit.packagePath}`);
    return;
  }
  if (
    ownerClassification &&
    (unitClassification.classification !== ownerClassification.classification ||
      unitClassification.context !== ownerClassification.context)
  ) {
    errors.push(`Database migration unit classification mismatch: ${unit.id}`);
  }
}

function validateRegistryDelegate(
  delegate: DatabaseDelegate,
  packages: ReadonlyMap<string, ClassifiedPath>,
  existingPaths: ReadonlySet<string> | undefined,
  errors: string[],
): void {
  addMissingPathError(errors, existingPaths, delegate.packagePath);
  const classification = packages.get(delegate.packagePath);
  if (!classification) {
    errors.push(`Database delegate package is not classified: ${delegate.packagePath}`);
  } else if (classification.classification !== 'shared-infrastructure') {
    errors.push(`Database delegate is not neutral infrastructure: ${delegate.id}`);
  }
  if (!delegate.capability) errors.push(`Database delegate has no capability: ${delegate.id}`);
}

function validateDiscoveredDrizzleConfigs(
  registry: ApiDatabaseRegistry,
  discoveredPaths: ReadonlySet<string> | undefined,
  errors: string[],
): void {
  if (!discoveredPaths) return;
  const registeredPaths = new Set(registry.migrationUnits.map((unit) => unit.drizzleConfigPath));
  for (const discoveredPath of discoveredPaths) {
    if (!registeredPaths.has(discoveredPath)) {
      errors.push(`Unregistered Drizzle config: ${discoveredPath}`);
    }
  }
  for (const registeredPath of registeredPaths) {
    if (!discoveredPaths.has(registeredPath)) {
      errors.push(`Registered Drizzle config not discovered: ${registeredPath}`);
    }
  }
}

async function findDrizzleConfigPaths(
  directory: string,
  relativeDirectory: string,
): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
      continue;
    }
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await findDrizzleConfigPaths(absolutePath, relativePath)));
    } else if (entry.isFile() && entry.name === 'drizzle.config.ts') {
      paths.push(relativePath);
    }
  }
  return paths;
}

async function repositoryDrizzleConfigPaths(): Promise<Set<string>> {
  const paths = await findDrizzleConfigPaths(path.join(repositoryRoot, 'libs'), 'libs');
  return new Set(paths);
}

async function existingRegistryPaths(registry: ApiDatabaseRegistry): Promise<Set<string>> {
  const registeredPaths = new Set<string>();
  for (const owner of registry.owners) registeredPaths.add(owner.packagePath);
  for (const unit of registry.migrationUnits) {
    registeredPaths.add(unit.packagePath);
    registeredPaths.add(unit.drizzleConfigPath);
    registeredPaths.add(unit.migrationsPath);
  }
  for (const delegate of registry.delegates) registeredPaths.add(delegate.packagePath);

  const existingPaths = new Set<string>();
  await Promise.all(
    [...registeredPaths].map(async (registeredPath) => {
      try {
        await stat(path.join(repositoryRoot, registeredPath));
        existingPaths.add(registeredPath);
      } catch {
        // The validator reports the path after the complete registry is checked.
      }
    }),
  );
  return existingPaths;
}

export async function auditApiDatabaseRegistry(
  registry: ApiDatabaseRegistry = databaseRegistry,
): Promise<string[]> {
  const [paths, discoveredDrizzleConfigPaths] = await Promise.all([
    existingRegistryPaths(registry),
    repositoryDrizzleConfigPaths(),
  ]);
  return validateApiDatabaseRegistry(registry, {
    discoveredDrizzleConfigPaths,
    existingPaths: paths,
  });
}

async function main(): Promise<void> {
  const errors = await auditApiDatabaseRegistry();
  if (errors.length === 0) {
    process.stdout.write('API database registry passed\n');
    return;
  }
  process.stderr.write(`API database registry failed (${errors.length} errors)\n`);
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
