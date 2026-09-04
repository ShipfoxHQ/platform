import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {
  type ApiDatabaseRegistry,
  apiDatabaseRegistry,
  auditApiDatabaseRegistry,
  type DatabaseMigrationUnit,
} from './api-database-registry.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sourceFileExpression = /\.(?:[cm]?[jt]sx?)$/u;
const migrationFileExpression = /\.sql$/u;
const snapshotFileExpression = /_snapshot\.json$/u;
const ignoredDirectoryNames = new Set(['coverage', 'dist', 'node_modules']);
const factoryBodyLookaheadLength = 240;
const sqlReferenceLookbehindLength = 180;
const namespaceExpression = /^[a-z][a-z0-9_]*$/u;
const identifierExpression = '(?:"([^"]+)"|([A-Za-z_][\\w$]*))';
const packageImportExpression = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/gu;
const namedImportExpression = /\{([^}]+)\}/u;
const factoryExpression = /pgTableCreator\s*\(\s*\(\s*name\s*\)\s*=>\s*([\s\S]*?)\)\s*;?/u;
const templateFactoryPrefixExpression = /`([^`]*)\$\{\s*name\s*\}/u;
const stringFactoryPrefixExpression = /["']([^"']*)["']\s*\+\s*name/u;
const unprefixedFactoryNameExpression = /name\s*===\s*["']([^"']+)["']\s*\?/gu;
const importAliasExpression = /\s+as\s+/u;
const firstCallArgumentExpression = /^\s*\(\s*(["'])([^"']+)\1/u;
const registeredFactoryExpression = /export\s+const\s+pgTable\s*=\s*pgTableCreator/u;
const inlineFactoryPrefixExpression = /=>\s*`([^`]*)\$\{\s*name\s*\}/u;
const trailingUnderscoreExpression = /_+$/u;
const declarationReferenceExpression = /\b(?:pgTable|pgEnum|index|uniqueIndex|check)\s*\([^\n]*$/u;
const sqlTemplateExpression = /\bsql(?:\.raw)?\s*`[^`]*$/su;
const sqlCallExpression = /\bsql(?:\.raw)?\s*\([^\n]*$/u;
const sqlKeywordExpression =
  /\b(?:SELECT\s+.+\s+FROM|TRUNCATE\s+(?:TABLE\s+)?[A-Za-z_"']|INSERT\s+INTO|UPDATE\s+[A-Za-z_"']+\s+SET|DELETE\s+FROM|(?:ALTER|DROP|CREATE)\s+(?:TABLE|TYPE|INDEX|VIEW|SEQUENCE|TRIGGER)|LOCK\s+TABLE)\b/iu;
// Keep these openers aligned with the sqlTemplateExpression and sqlCallExpression acceptance checks.
const sqlTagOrCallExpression = /\bsql(?:\.raw)?\s*(?:`|\()/u;
const staticSqlCandidateExpression = new RegExp(
  `(?:${sqlTagOrCallExpression.source}|${sqlKeywordExpression.source})`,
  'iu',
);
const migrationSqlKeywordExpression = /\b(?:ALTER|DROP|CREATE)\b/iu;
const referencesKeywordExpression = /\bREFERENCES\b/iu;
const dynamicSqlKeywordExpression =
  /\b(?:FROM|JOIN|INTO|UPDATE|TABLE|TRUNCATE|ALTER|DROP|CREATE)\s+\$\{/giu;
const dynamicRawSqlExpression = /\bsql\.raw\s*\([^\n]*\$\{/gu;
const tableBindingImportExpression =
  /import\s+\{([^}]+)\}\s+from\s+["'][^"']+\/(?:schema|runner-lease-table)[^"']*["']/gu;
const objectBindingExpression =
  /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:pgTable|pgEnum)\b/gu;
const migrationHistoryExpression = /__drizzle_migrations_([a-z][a-z0-9_]*)/gu;
const fallbackHistoryExpression = /migrationsTableName\s*\?\?\s*moduleMigrationTableName/u;
const optionalHistoryExpression = /migrationsTableName\?/u;
const dynamicIdentifierExpression = /\$\{[^}]+\}/gu;
const interpolationPresenceExpression = /\$\{/u;
const interpolationBodyExpression = /^[^}]+/u;
const plainIdentifierExpression = /^[A-Za-z_$][\w$]*$/u;
const namespaceImportExpression = /\*\s+as\s+([A-Za-z_$][\w$]*)/u;
const defaultImportExpression = /^\s*([A-Za-z_$][\w$]*)/u;
const dynamicSqlRawKeywordExpression =
  /\b(?:FROM|JOIN|INTO|UPDATE|TABLE|TRUNCATE|ALTER|DROP|CREATE)\b/iu;

export type DatabaseBoundaryRule =
  | 'direct-table-declaration'
  | 'dynamic-sql-identifier'
  | 'foreign-database-access'
  | 'foreign-enum-declaration'
  | 'foreign-key'
  | 'foreign-migration'
  | 'foreign-raw-sql'
  | 'foreign-support-object'
  | 'foreign-table-declaration'
  | 'migration-history-instability'
  | 'unprefixed-enum'
  | 'unprefixed-support-object'
  | 'unprefixed-table'
  | 'unregistered-migration-unit';

export interface DatabaseBoundaryFinding {
  owner: string;
  namespace: string;
  file: string;
  line: number;
  object: string;
  rule: DatabaseBoundaryRule;
  suggestedBoundary: string;
}

export interface DatabaseBoundaryAuditOptions {
  registry?: ApiDatabaseRegistry;
  rootDirectory?: string;
}

export interface DatabaseBoundaryVerificationResult {
  findings: DatabaseBoundaryFinding[];
  registryErrors: string[];
}

interface DatabaseObject {
  kind: DatabaseObjectKind;
  name: string;
  namespace: string;
  owner: string;
}

type DatabaseObjectKind =
  | 'constraint'
  | 'enum'
  | 'index'
  | 'sequence'
  | 'table'
  | 'trigger'
  | 'view';

interface AuditFile {
  path: string;
  source: string;
}

interface FactoryInfo {
  prefix: string;
  unprefixedNames: ReadonlySet<string>;
}

interface FileOwnerContext {
  owner: string;
  namespace: string;
  unit?: DatabaseMigrationUnit;
}

interface AuditContext {
  registry: ApiDatabaseRegistry;
  rootDirectory: string;
  units: DatabaseMigrationUnit[];
  objects: Map<string, DatabaseObject>;
  sortedNamespaces: readonly string[];
  sqlObjectReferenceExpression: RegExp | undefined;
  namespaceOwners: Map<string, string>;
  ownerNamespaces: Map<string, Set<string>>;
  factories: Map<string, FactoryInfo>;
  packageOwners: Map<string, string>;
  ownerPackages: Map<string, string>;
}

interface ObjectReference {
  name: string;
  index: number;
  kind: DatabaseObjectKind;
}

const namespaceSuggestion = (owner: string, namespace: string): string =>
  `Use the ${owner} owner's ${namespace} schema factory and producer-owned boundary.`;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareFindings(left: DatabaseBoundaryFinding, right: DatabaseBoundaryFinding): number {
  return [
    left.owner,
    left.namespace,
    left.file,
    String(left.line).padStart(8, '0'),
    left.object,
    left.rule,
    left.suggestedBoundary,
  ]
    .join('\u0000')
    .localeCompare(
      [
        right.owner,
        right.namespace,
        right.file,
        String(right.line).padStart(8, '0'),
        right.object,
        right.rule,
        right.suggestedBoundary,
      ].join('\u0000'),
    );
}

function findingKey(finding: Pick<DatabaseBoundaryFinding, keyof DatabaseBoundaryFinding>): string {
  return [
    finding.owner,
    finding.namespace,
    finding.file,
    finding.line,
    finding.object,
    finding.rule,
    finding.suggestedBoundary,
  ].join('\u0000');
}

function toRepositoryPath(rootDirectory: string, absolutePath: string): string {
  return path.relative(rootDirectory, absolutePath).split(path.sep).join('/');
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === '\n') line += 1;
  }
  return line;
}

function lineTextAt(source: string, index: number): string {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  const lineEnd = source.indexOf('\n', index) === -1 ? source.length : source.indexOf('\n', index);
  return source.slice(lineStart, lineEnd);
}

function unquoteIdentifier(value: string): string {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replaceAll('""', '"')
    : value;
}

function identifierFromMatch(match: RegExpExecArray): string | undefined {
  for (let index = match.length - 1; index >= 1; index -= 1) {
    const value = match[index];
    if (value) return unquoteIdentifier(value);
  }
  return undefined;
}

function addObject(
  objects: Map<string, DatabaseObject>,
  name: string,
  kind: DatabaseObjectKind,
  unit: DatabaseMigrationUnit,
): void {
  if (!name || name.startsWith('__drizzle_migrations_')) return;
  const existing = objects.get(name);
  if (existing) return;
  objects.set(name, {kind, name, namespace: unit.namespace, owner: unit.ownerId});
}

function migrationObjectPatterns(
  tableOperationExpression: string,
): Array<[DatabaseObjectKind, RegExp]> {
  return [
    [
      'enum',
      new RegExp(
        `\\bCREATE\\s+TYPE\\s+(?:${identifierExpression}\\.)?${identifierExpression}`,
        'giu',
      ),
    ],
    [
      'table',
      new RegExp(
        `\\b${tableOperationExpression}(?:${identifierExpression}\\.)?${identifierExpression}`,
        'giu',
      ),
    ],
    [
      'index',
      new RegExp(
        `\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifierExpression}`,
        'giu',
      ),
    ],
    [
      'view',
      new RegExp(
        `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+(?:${identifierExpression}\\.)?${identifierExpression}`,
        'giu',
      ),
    ],
    [
      'sequence',
      new RegExp(
        `\\bCREATE\\s+SEQUENCE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:${identifierExpression}\\.)?${identifierExpression}`,
        'giu',
      ),
    ],
    ['trigger', new RegExp(`\\bCREATE\\s+TRIGGER\\s+${identifierExpression}`, 'giu')],
    ['constraint', new RegExp(`\\b(?:ADD\\s+)?CONSTRAINT\\s+${identifierExpression}`, 'giu')],
  ];
}

function addMigrationObjects(
  objects: Map<string, DatabaseObject>,
  file: AuditFile,
  unit: DatabaseMigrationUnit,
): void {
  for (const [kind, expression] of migrationObjectPatterns(
    'CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?',
  )) {
    for (const match of file.source.matchAll(expression)) {
      const name = identifierFromMatch(match);
      if (name) addObject(objects, name, kind, unit);
    }
  }
}

function addSnapshotObjects(
  objects: Map<string, DatabaseObject>,
  file: AuditFile,
  unit: DatabaseMigrationUnit,
): void {
  let snapshot: {
    tables?: Record<string, SnapshotTable>;
    enums?: Record<string, SnapshotEnum>;
    sequences?: Record<string, SnapshotNamedObject>;
    views?: Record<string, SnapshotNamedObject>;
  };
  try {
    snapshot = JSON.parse(file.source) as typeof snapshot;
  } catch {
    return;
  }

  for (const [qualifiedName, table] of Object.entries(snapshot.tables ?? {})) {
    addSnapshotTableObjects(objects, qualifiedName, table, unit);
  }
  for (const [qualifiedName, enumValue] of Object.entries(snapshot.enums ?? {})) {
    addObject(objects, enumValue.name || lastIdentifier(qualifiedName), 'enum', unit);
  }
  for (const [qualifiedName, sequence] of Object.entries(snapshot.sequences ?? {})) {
    addObject(objects, sequence.name || lastIdentifier(qualifiedName), 'sequence', unit);
  }
  for (const [qualifiedName, view] of Object.entries(snapshot.views ?? {})) {
    addObject(objects, view.name || lastIdentifier(qualifiedName), 'view', unit);
  }
}

function addSnapshotTableObjects(
  objects: Map<string, DatabaseObject>,
  qualifiedName: string,
  table: SnapshotTable,
  unit: DatabaseMigrationUnit,
): void {
  addObject(objects, table.name || lastIdentifier(qualifiedName), 'table', unit);
  addSnapshotNamedObjects(objects, Object.values(table.indexes ?? {}), 'index', unit);
  addSnapshotNamedObjects(
    objects,
    Object.values(table.uniqueConstraints ?? {}),
    'constraint',
    unit,
  );
  addSnapshotNamedObjects(objects, Object.values(table.checkConstraints ?? {}), 'constraint', unit);
}

function addSnapshotNamedObjects(
  objects: Map<string, DatabaseObject>,
  values: readonly SnapshotNamedObject[],
  kind: DatabaseObject['kind'],
  unit: DatabaseMigrationUnit,
): void {
  for (const value of values) {
    if (value.name) addObject(objects, value.name, kind, unit);
  }
}

interface SnapshotNamedObject {
  name?: string;
}

interface SnapshotEnum extends SnapshotNamedObject {}

interface SnapshotTable extends SnapshotNamedObject {
  indexes?: Record<string, SnapshotNamedObject>;
  uniqueConstraints?: Record<string, SnapshotNamedObject>;
  checkConstraints?: Record<string, SnapshotNamedObject>;
}

function lastIdentifier(value: string): string {
  return value.split('.').at(-1) ?? value;
}

function collectFactoryInfo(source: string): FactoryInfo | undefined {
  const factoryMatch = source.match(factoryExpression);
  if (!factoryMatch) return undefined;
  const body = factoryMatch[1] ?? '';
  const templatePrefix = body.match(templateFactoryPrefixExpression)?.[1];
  const stringPrefix = body.match(stringFactoryPrefixExpression)?.[1];
  const prefix = templatePrefix ?? stringPrefix ?? '';
  const unprefixedNames = new Set<string>();
  for (const match of body.matchAll(unprefixedFactoryNameExpression)) {
    if (match[1]) unprefixedNames.add(match[1]);
  }
  return {prefix, unprefixedNames};
}

function factoryPhysicalName(
  factory: FactoryInfo | undefined,
  namespace: string,
  logicalName: string,
): string {
  if (factory?.unprefixedNames.has(logicalName)) return logicalName;
  if (factory?.prefix) return `${factory.prefix}${logicalName}`;
  return `${namespace}_${logicalName}`;
}

async function walkFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true}).catch(() => undefined);
  if (!entries) return [];
  const files: string[] = [];
  for (const entry of entries) {
    if (ignoredDirectoryNames.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(absolutePath)));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files.sort(compareText);
}

async function readAuditFiles(paths: readonly string[]): Promise<AuditFile[]> {
  const files = await Promise.all(
    paths.map(async (filePath) => ({path: filePath, source: await readFile(filePath, 'utf8')})),
  );
  return files.sort((left, right) => compareText(left.path, right.path));
}

async function packageNames(
  rootDirectory: string,
  registry: ApiDatabaseRegistry,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const paths = new Map<string, string>();
  for (const owner of registry.owners) paths.set(owner.packagePath, owner.id);
  for (const unit of registry.migrationUnits) paths.set(unit.packagePath, unit.ownerId);
  for (const [packagePath, owner] of paths) {
    try {
      const manifest = JSON.parse(
        await readFile(path.join(rootDirectory, packagePath, 'package.json'), 'utf8'),
      ) as {name?: string};
      if (manifest.name) result.set(manifest.name, owner);
    } catch {
      // Registry validation reports missing package paths separately.
    }
  }
  return result;
}

function createAuditContext(
  options: Required<Pick<DatabaseBoundaryAuditOptions, 'registry' | 'rootDirectory'>>,
  migrationFiles: readonly AuditFile[],
  snapshotFiles: readonly AuditFile[],
  sourceFiles: readonly AuditFile[],
): AuditContext {
  const units = [...options.registry.migrationUnits].sort(
    (left, right) => right.packagePath.length - left.packagePath.length,
  );
  const objects = new Map<string, DatabaseObject>();
  for (const file of migrationFiles) {
    const unit = units.find((candidate) =>
      isPathInside(path.join(options.rootDirectory, candidate.migrationsPath), file.path),
    );
    if (unit) addMigrationObjects(objects, file, unit);
  }
  for (const file of snapshotFiles) {
    const unit = units.find((candidate) =>
      isPathInside(path.join(options.rootDirectory, candidate.migrationsPath), file.path),
    );
    if (unit) addSnapshotObjects(objects, file, unit);
  }

  const namespaceOwners = new Map<string, string>();
  const ownerNamespaces = new Map<string, Set<string>>();
  for (const unit of options.registry.migrationUnits) {
    namespaceOwners.set(unit.namespace, unit.ownerId);
    const namespaces = ownerNamespaces.get(unit.ownerId) ?? new Set<string>();
    namespaces.add(unit.namespace);
    ownerNamespaces.set(unit.ownerId, namespaces);
  }
  const ownerPackages = new Map<string, string>();
  for (const owner of options.registry.owners) ownerPackages.set(owner.id, owner.packagePath);
  for (const unit of options.registry.migrationUnits) {
    ownerPackages.set(`unit:${unit.id}`, unit.packagePath);
  }
  const factories = new Map<string, FactoryInfo>();
  for (const file of sourceFiles) {
    if (!file.path.endsWith('/schema/common.ts')) continue;
    const factory = collectFactoryInfo(file.source);
    const packagePath = toRepositoryPath(
      options.rootDirectory,
      path.dirname(path.dirname(path.dirname(path.dirname(file.path)))),
    );
    if (factory) factories.set(packagePath, factory);
  }

  const sortedNamespaces = [...namespaceOwners.keys()].sort(
    (left, right) => right.length - left.length || compareText(left, right),
  );
  const sqlObjectReferenceExpression = buildSqlObjectReferenceExpression(objects);

  return {
    registry: options.registry,
    rootDirectory: options.rootDirectory,
    units,
    objects,
    sortedNamespaces,
    sqlObjectReferenceExpression,
    namespaceOwners,
    ownerNamespaces,
    factories,
    packageOwners: new Map(),
    ownerPackages,
  };
}

function buildSqlObjectReferenceExpression(
  objects: ReadonlyMap<string, DatabaseObject>,
): RegExp | undefined {
  const names = [...objects.keys()].sort(
    (left, right) => right.length - left.length || compareText(left, right),
  );
  if (names.length === 0) return undefined;
  return new RegExp(
    `(?<![A-Za-z0-9_$])(?:${names.map(escapeRegExp).join('|')})(?![A-Za-z0-9_$])`,
    'gu',
  );
}

function ownerContextForPath(
  context: AuditContext,
  absolutePath: string,
): FileOwnerContext | undefined {
  const repositoryPath = toRepositoryPath(context.rootDirectory, absolutePath);
  const unit = context.units.find(
    (candidate) =>
      repositoryPath === candidate.packagePath ||
      repositoryPath.startsWith(`${candidate.packagePath}/`),
  );
  if (unit) return {owner: unit.ownerId, namespace: unit.namespace, unit};
  if (repositoryPath.startsWith('libs/shared/node/')) {
    return {owner: 'neutral-infrastructure', namespace: 'neutral'};
  }
  return undefined;
}

function ownerPackagePathForContext(context: AuditContext, filePath: string): string | undefined {
  const repositoryPath = toRepositoryPath(context.rootDirectory, filePath);
  const candidates = [...context.ownerPackages.entries()]
    .filter(
      ([, packagePath]) =>
        repositoryPath === packagePath || repositoryPath.startsWith(`${packagePath}/`),
    )
    .sort((left, right) => right[1].length - left[1].length);
  return candidates[0]?.[1];
}

function objectByNamespace(context: AuditContext, name: string): DatabaseObject | undefined {
  const exact = context.objects.get(name);
  if (exact) return exact;
  for (const namespace of context.sortedNamespaces) {
    if (name.startsWith(`${namespace}_`)) {
      return {
        kind: 'table',
        name,
        namespace,
        owner: context.namespaceOwners.get(namespace) ?? 'unknown',
      };
    }
  }
  return undefined;
}

function objectRule(kind: DatabaseObjectKind): DatabaseBoundaryRule {
  if (kind === 'table') return 'unprefixed-table';
  if (kind === 'enum') return 'unprefixed-enum';
  return 'unprefixed-support-object';
}

function foreignObjectRule(kind: DatabaseObjectKind, migration: boolean): DatabaseBoundaryRule {
  if (migration) return 'foreign-migration';
  if (kind === 'table') return 'foreign-table-declaration';
  if (kind === 'enum') return 'foreign-enum-declaration';
  return 'foreign-support-object';
}

function addFinding(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  filePath: string,
  source: string,
  index: number,
  object: string,
  rule: DatabaseBoundaryRule,
  suggestedBoundary: string,
  fileContextOverride?: FileOwnerContext,
  ownerOverride?: string,
  namespaceOverride?: string,
): void {
  const fileOwner = fileContextOverride ?? ownerContextForPath(context, filePath);
  findings.push({
    owner: ownerOverride ?? fileOwner?.owner ?? 'unknown',
    namespace: namespaceOverride ?? fileOwner?.namespace ?? 'unknown',
    file: toRepositoryPath(context.rootDirectory, filePath),
    line: lineAt(source, index),
    object,
    rule,
    suggestedBoundary,
  });
}

function hasAllowedNamespacePrefix(context: AuditContext, owner: string, name: string): boolean {
  return [...(context.ownerNamespaces.get(owner) ?? [])].some((namespace) =>
    name.startsWith(`${namespace}_`),
  );
}

function validateObjectReference(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  reference: ObjectReference,
  migration: boolean,
): void {
  const fileContext = ownerContextForPath(context, file.path);
  if (!fileContext || fileContext.owner === 'neutral-infrastructure') return;
  const target = objectByNamespace(context, reference.name);
  const targetOwner = target?.owner;
  if (targetOwner && targetOwner !== fileContext.owner) {
    addFinding(
      findings,
      context,
      file.path,
      file.source,
      reference.index,
      reference.name,
      foreignObjectRule(reference.kind, migration),
      namespaceSuggestion(targetOwner, target?.namespace ?? 'unknown'),
      fileContext,
    );
    return;
  }
  if (
    targetOwner === fileContext.owner &&
    hasAllowedNamespacePrefix(context, targetOwner, reference.name)
  ) {
    return;
  }
  if (targetOwner === fileContext.owner || !namespaceExpression.test(reference.name)) {
    addFinding(
      findings,
      context,
      file.path,
      file.source,
      reference.index,
      reference.name,
      objectRule(reference.kind),
      namespaceSuggestion(fileContext.owner, fileContext.namespace),
      fileContext,
    );
    return;
  }
  if (!hasAllowedNamespacePrefix(context, fileContext.owner, reference.name)) {
    addFinding(
      findings,
      context,
      file.path,
      file.source,
      reference.index,
      reference.name,
      objectRule(reference.kind),
      namespaceSuggestion(fileContext.owner, fileContext.namespace),
      fileContext,
    );
  }
}

function parseSourceImports(source: string): {
  directTableFunctions: Set<string>;
  directTableCreatorFunctions: Set<string>;
  localTableFunctions: Set<string>;
} {
  const directTableFunctions = new Set<string>();
  const directTableCreatorFunctions = new Set<string>();
  const localTableFunctions = new Set<string>();
  for (const match of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/gu)) {
    addSourceImportBindings(
      match[1] ?? '',
      match[2] ?? '',
      directTableFunctions,
      directTableCreatorFunctions,
      localTableFunctions,
    );
  }
  if (registeredFactoryExpression.test(source)) localTableFunctions.add('pgTable');
  return {directTableFunctions, directTableCreatorFunctions, localTableFunctions};
}

function addSourceImportBindings(
  imports: string,
  moduleName: string,
  directTableFunctions: Set<string>,
  directTableCreatorFunctions: Set<string>,
  localTableFunctions: Set<string>,
): void {
  for (const item of imports.split(',')) {
    const [originalValue, localValue] = item.trim().split(importAliasExpression);
    const original = originalValue?.trim();
    const local = localValue?.trim() || original;
    if (!original || !local) continue;
    if (moduleName === 'drizzle-orm/pg-core' && original === 'pgTable') {
      directTableFunctions.add(local);
    } else if (moduleName === 'drizzle-orm/pg-core' && original === 'pgTableCreator') {
      directTableCreatorFunctions.add(local);
    } else if (moduleName.endsWith('/common.js') && original === 'pgTable') {
      localTableFunctions.add(local);
    }
  }
}

function firstCallString(
  source: string,
  index: number,
): {value: string; index: number} | undefined {
  const tail = source.slice(index);
  const match = tail.match(firstCallArgumentExpression);
  if (!match || match.index === undefined) return undefined;
  return {value: match[2] ?? '', index: index + match.index + match[0].indexOf(match[2] ?? '')};
}

function factoryForFile(context: AuditContext, filePath: string): FactoryInfo | undefined {
  const packagePath = ownerPackagePathForContext(context, filePath);
  return packagePath ? context.factories.get(packagePath) : undefined;
}

function factoryRuleAndBoundary(
  fileContext: FileOwnerContext,
  foreignOwner: string | undefined,
  namespace: string,
): {
  rule: 'direct-table-declaration' | 'foreign-table-declaration';
  suggestedBoundary: string;
} {
  if (foreignOwner && foreignOwner !== fileContext.owner) {
    return {
      rule: 'foreign-table-declaration',
      suggestedBoundary: namespaceSuggestion(foreignOwner, namespace),
    };
  }
  return {
    rule: 'direct-table-declaration',
    suggestedBoundary: `Declare tables through the registered ${fileContext.namespace} schema factory.`,
  };
}

function auditFactories(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
): void {
  const fileContext = ownerContextForPath(context, file.path);
  if (!fileContext || fileContext.owner === 'neutral-infrastructure') return;
  const {directTableCreatorFunctions} = parseSourceImports(file.source);
  for (const functionName of directTableCreatorFunctions) {
    for (const match of file.source.matchAll(
      new RegExp(`\\b${escapeRegExp(functionName)}\\s*\\(`, 'gu'),
    )) {
      auditFactoryCall(findings, context, file, fileContext, functionName, match);
    }
  }
}

function auditFactoryCall(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  fileContext: FileOwnerContext,
  functionName: string,
  match: RegExpMatchArray,
): void {
  const callIndex = match.index ?? 0;
  const isRegisteredFactory =
    file.path.endsWith('/schema/common.ts') && registeredFactoryExpression.test(file.source);
  if (isRegisteredFactory) return;
  const body = file.source.slice(callIndex, callIndex + factoryBodyLookaheadLength);
  const prefix = body.match(inlineFactoryPrefixExpression)?.[1] ?? '';
  const namespace = prefix.replace(trailingUnderscoreExpression, '');
  const foreignOwner = namespace ? context.namespaceOwners.get(namespace) : undefined;
  const factoryBoundary = factoryRuleAndBoundary(fileContext, foreignOwner, namespace);
  addFinding(
    findings,
    context,
    file.path,
    file.source,
    callIndex,
    functionName,
    factoryBoundary.rule,
    factoryBoundary.suggestedBoundary,
    fileContext,
  );
  const tableBinding = factoryTableBinding(file.source, functionName, callIndex);
  if (tableBinding && prefix) {
    auditFactoryTableCalls(
      findings,
      context,
      file,
      fileContext,
      tableBinding,
      callIndex,
      prefix,
      factoryBoundary,
    );
  }
}

function factoryTableBinding(
  source: string,
  functionName: string,
  callIndex: number,
): string | undefined {
  const expression = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${escapeRegExp(functionName)}\\s*\\(`,
    'gu',
  );
  return [...source.matchAll(expression)].find((binding) => (binding.index ?? 0) <= callIndex)?.[1];
}

function auditFactoryTableCalls(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  fileContext: FileOwnerContext,
  tableBinding: string,
  factoryCallIndex: number,
  prefix: string,
  factoryBoundary: ReturnType<typeof factoryRuleAndBoundary>,
): void {
  const tableExpression = new RegExp(`\\b${escapeRegExp(tableBinding)}\\s*\\(`, 'gu');
  for (const tableMatch of file.source.matchAll(tableExpression)) {
    const tableIndex = tableMatch.index ?? 0;
    if (tableIndex <= factoryCallIndex) continue;
    const firstArgument = firstCallString(file.source, tableIndex + tableMatch[0].length - 1);
    if (!firstArgument) continue;
    addFinding(
      findings,
      context,
      file.path,
      file.source,
      firstArgument.index,
      `${prefix}${firstArgument.value}`,
      factoryBoundary.rule,
      factoryBoundary.suggestedBoundary,
      fileContext,
    );
  }
}

function auditSourceDeclarations(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
): void {
  const fileContext = ownerContextForPath(context, file.path);
  if (!fileContext || fileContext.owner === 'neutral-infrastructure') return;
  const imports = parseSourceImports(file.source);
  const factory = factoryForFile(context, file.path);
  const tableFunctions = new Set([
    'pgTable',
    ...imports.directTableFunctions,
    ...imports.localTableFunctions,
  ]);

  for (const functionName of tableFunctions) {
    auditTableFunctionCalls(
      findings,
      context,
      file,
      fileContext,
      functionName,
      imports.directTableFunctions.has(functionName),
      factory,
    );
  }

  auditNamedSourceCalls(findings, context, file, /\bpgEnum\s*\(/gu, 'enum');
  auditNamedSourceCalls(
    findings,
    context,
    file,
    /\b(?:uniqueIndex|index|check|primaryKey)\s*\(/gu,
    'constraint',
  );
}

function auditTableFunctionCalls(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  fileContext: FileOwnerContext,
  functionName: string,
  isDirect: boolean,
  factory: FactoryInfo | undefined,
): void {
  if (functionName === 'pgTableCreator') return;
  const expression = new RegExp(`\\b${escapeRegExp(functionName)}\\s*\\(`, 'gu');
  for (const match of file.source.matchAll(expression)) {
    const callIndex = match.index ?? 0;
    const firstArgument = firstCallString(file.source, callIndex + match[0].length - 1);
    if (!firstArgument) continue;
    const physicalName = isDirect
      ? firstArgument.value
      : factoryPhysicalName(factory, fileContext.namespace, firstArgument.value);
    const target = objectByNamespace(context, physicalName);
    const allowedUnprefixedName =
      !isDirect &&
      factory?.unprefixedNames.has(firstArgument.value) &&
      (!target?.owner || target.owner === fileContext.owner);
    if (allowedUnprefixedName) continue;
    if (!isDirect || (target?.owner && target.owner !== fileContext.owner)) {
      validateObjectReference(
        findings,
        context,
        file,
        {kind: 'table', name: physicalName, index: firstArgument.index},
        false,
      );
      continue;
    }
    addFinding(
      findings,
      context,
      file.path,
      file.source,
      firstArgument.index,
      physicalName,
      'direct-table-declaration',
      `Declare tables through the registered ${fileContext.namespace} schema factory.`,
      fileContext,
    );
  }
}

function auditNamedSourceCalls(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  expression: RegExp,
  kind: DatabaseObjectKind,
): void {
  for (const match of file.source.matchAll(expression)) {
    const firstArgument = firstCallString(file.source, (match.index ?? 0) + match[0].length - 1);
    if (!firstArgument) continue;
    validateObjectReference(
      findings,
      context,
      file,
      {kind, name: firstArgument.value, index: firstArgument.index},
      false,
    );
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function isSqlLikeReference(source: string, index: number): boolean {
  const before = source.slice(Math.max(0, index - sqlReferenceLookbehindLength), index);
  const line = lineTextAt(source, index);
  if (declarationReferenceExpression.test(before)) return false;
  const hasSqlTag = sqlTemplateExpression.test(before) || sqlCallExpression.test(before);
  const hasSqlKeyword = sqlKeywordExpression.test(line);
  if (!hasSqlTag && !hasSqlKeyword) return false;
  return hasSqlTag || hasSqlKeyword;
}

function sqlRuleForObject(source: string, index: number): DatabaseBoundaryRule {
  const line = lineTextAt(source, index);
  if (referencesKeywordExpression.test(line)) return 'foreign-key';
  return migrationSqlKeywordExpression.test(line) ? 'foreign-migration' : 'foreign-raw-sql';
}

function registeredTableBindings(source: string): Set<string> {
  const bindings = new Set<string>();
  for (const match of source.matchAll(tableBindingImportExpression)) {
    const imports = match[1] ?? '';
    for (const item of imports.split(',')) {
      const [originalValue, localValue] = item.trim().split(importAliasExpression);
      const local = localValue?.trim() || originalValue?.trim();
      if (local) bindings.add(local);
    }
  }
  for (const match of source.matchAll(objectBindingExpression)) {
    if (match[1]) bindings.add(match[1]);
  }
  return bindings;
}

function isRegisteredSqlInterpolation(source: string, interpolationStart: number): boolean {
  const expression =
    source
      .slice(interpolationStart + 2)
      .match(interpolationBodyExpression)?.[0]
      ?.trim() ?? '';
  const identifier = expression.match(plainIdentifierExpression)?.[0] ?? expression.split('.')[0];
  return identifier ? registeredTableBindings(source).has(identifier) : false;
}

function auditRawSql(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
): void {
  const fileContext = ownerContextForPath(context, file.path);
  if (!fileContext || fileContext.owner === 'neutral-infrastructure') return;
  auditStaticRawSql(findings, context, file, fileContext);
  auditDynamicSqlExpression(
    findings,
    context,
    file,
    fileContext,
    dynamicSqlKeywordExpression,
    false,
  );
  auditDynamicSqlExpression(findings, context, file, fileContext, dynamicRawSqlExpression, true);
}

function auditStaticRawSql(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  fileContext: FileOwnerContext,
): void {
  const expression = context.sqlObjectReferenceExpression;
  if (!expression || !staticSqlCandidateExpression.test(file.source)) return;
  expression.lastIndex = 0;
  for (const match of file.source.matchAll(expression)) {
    const name = match[0];
    const offset = match.index ?? 0;
    if (isSqlLikeReference(file.source, offset)) {
      const reference = {kind: context.objects.get(name)?.kind ?? 'table', name, index: offset};
      const target = objectByNamespace(context, name);
      if (target?.owner && target.owner !== fileContext.owner) {
        addFinding(
          findings,
          context,
          file.path,
          file.source,
          offset,
          name,
          sqlRuleForObject(file.source, offset),
          namespaceSuggestion(target.owner, target.namespace),
          fileContext,
        );
      } else {
        validateObjectReference(findings, context, file, reference, false);
      }
    }
  }
}

function auditDynamicSqlExpression(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  fileContext: FileOwnerContext,
  expression: RegExp,
  requireRawKeyword: boolean,
): void {
  for (const match of file.source.matchAll(expression)) {
    if (requireRawKeyword && !dynamicSqlRawKeywordExpression.test(match[0])) continue;
    const interpolationStart = (match.index ?? 0) + match[0].lastIndexOf('${');
    if (isRegisteredSqlInterpolation(file.source, interpolationStart)) continue;
    addFinding(
      findings,
      context,
      file.path,
      file.source,
      match.index ?? 0,
      '<dynamic identifier>',
      'dynamic-sql-identifier',
      `Use a registered ${fileContext.namespace} table or an owner operation instead of a dynamic SQL identifier.`,
      fileContext,
    );
  }
}

function parseImportBindings(importClause: string): string[] {
  const names: string[] = [];
  const named = importClause.match(namedImportExpression)?.[1];
  if (named) {
    for (const item of named.split(',')) {
      const [originalValue, localValue] = item.trim().split(importAliasExpression);
      const local = localValue?.trim() || originalValue?.trim();
      if (local) names.push(local);
    }
  }
  const namespace = importClause.match(namespaceImportExpression)?.[1];
  if (namespace) names.push(namespace);
  const defaultImport = importClause.match(defaultImportExpression)?.[1];
  if (defaultImport) names.push(defaultImport);
  return names;
}

function ownerForImportedPackage(
  context: AuditContext,
  importedPackage: string,
): string | undefined {
  const exact = context.packageOwners.get(importedPackage);
  if (exact) return exact;
  return [...context.packageOwners.entries()]
    .filter(([packageName]) => importedPackage.startsWith(`${packageName}/`))
    .sort((left, right) => right[0].length - left[0].length)[0]?.[1];
}
function auditForeignDatabaseAccess(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
): void {
  const fileContext = ownerContextForPath(context, file.path);
  if (!fileContext || fileContext.owner === 'neutral-infrastructure') return;
  for (const match of file.source.matchAll(packageImportExpression)) {
    auditForeignDatabaseImport(findings, context, file, fileContext, match);
  }
}

function auditForeignDatabaseImport(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  fileContext: FileOwnerContext,
  match: RegExpMatchArray,
): void {
  const targetOwner = ownerForImportedPackage(context, match[2] ?? '');
  if (!targetOwner || targetOwner === fileContext.owner) return;
  for (const binding of parseImportBindings(match[1] ?? '')) {
    const accessExpression = new RegExp(`\\b${escapeRegExp(binding)}\\s*\\.\\s*database\\b`, 'gu');
    for (const access of file.source.matchAll(accessExpression)) {
      addFinding(
        findings,
        context,
        file.path,
        file.source,
        access.index ?? 0,
        `${binding}.database`,
        'foreign-database-access',
        namespaceSuggestion(
          targetOwner,
          [...(context.ownerNamespaces.get(targetOwner) ?? [])][0] ?? 'unknown',
        ),
        fileContext,
      );
    }
  }
}

function auditSourceForeignKeys(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
): void {
  const fileContext = ownerContextForPath(context, file.path);
  if (!fileContext || fileContext.owner === 'neutral-infrastructure') return;
  for (const match of file.source.matchAll(packageImportExpression)) {
    auditForeignKeyImport(findings, context, file, fileContext, match);
  }
}

function auditForeignKeyImport(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  fileContext: FileOwnerContext,
  match: RegExpMatchArray,
): void {
  const targetOwner = ownerForImportedPackage(context, match[2] ?? '');
  if (!targetOwner || targetOwner === fileContext.owner) return;
  for (const binding of parseImportBindings(match[1] ?? '')) {
    const referenceExpression = new RegExp(
      `\\.references\\s*\\(\\s*\\(\\s*\\)\\s*=>\\s*${escapeRegExp(binding)}(?:\\.[A-Za-z_$][\\w$]*)?`,
      'gu',
    );
    for (const reference of file.source.matchAll(referenceExpression)) {
      addFinding(
        findings,
        context,
        file.path,
        file.source,
        reference.index ?? 0,
        `${binding}.references`,
        'foreign-key',
        namespaceSuggestion(
          targetOwner,
          [...(context.ownerNamespaces.get(targetOwner) ?? [])][0] ?? 'unknown',
        ),
        fileContext,
      );
    }
  }
}
function auditMigrationHistory(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
): void {
  const fileContext = ownerContextForPath(context, file.path);
  if (!fileContext) return;
  if (fileContext.owner !== 'neutral-infrastructure') {
    auditForeignMigrationHistories(findings, context, file, fileContext);
  }
  if (file.path.endsWith('/libs/shared/node/module/src/initialize.ts')) {
    auditUnstableMigrationHistory(
      findings,
      context,
      file,
      fileContext,
      fallbackHistoryExpression,
      'moduleMigrationTableName',
    );
  }
  if (file.path.endsWith('/libs/shared/node/module/src/types.ts')) {
    auditUnstableMigrationHistory(
      findings,
      context,
      file,
      fileContext,
      optionalHistoryExpression,
      'migrationsTableName',
    );
  }
}

function auditForeignMigrationHistories(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  fileContext: FileOwnerContext,
): void {
  for (const match of file.source.matchAll(migrationHistoryExpression)) {
    const namespace = match[1] ?? '';
    const owner = context.namespaceOwners.get(namespace);
    if (!owner || owner === fileContext.owner) continue;
    addFinding(
      findings,
      context,
      file.path,
      file.source,
      match.index ?? 0,
      `__drizzle_migrations_${namespace}`,
      'foreign-migration',
      namespaceSuggestion(owner, namespace),
      fileContext,
    );
  }
}

function auditUnstableMigrationHistory(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  fileContext: FileOwnerContext,
  expression: RegExp,
  objectName: string,
): void {
  const match = file.source.match(expression);
  if (match?.index === undefined) return;
  addFinding(
    findings,
    context,
    file.path,
    file.source,
    match.index,
    objectName,
    'migration-history-instability',
    'Require the registered database namespace on every ModuleDatabase declaration.',
    fileContext,
    'neutral-infrastructure',
    'neutral',
  );
}

function auditMigrationFile(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
): void {
  const fileContext = ownerContextForPath(context, file.path);
  if (!fileContext?.unit) return;
  const patterns = migrationObjectPatterns(
    '(?:CREATE\\s+TABLE|ALTER\\s+TABLE|DROP\\s+TABLE)\\s+(?:IF\\s+NOT\\s+EXISTS\\s+|IF\\s+EXISTS\\s+)?',
  );
  auditMigrationObjects(findings, context, file, patterns);
  auditMigrationForeignKeys(findings, context, file, fileContext);
  auditDynamicMigrationIdentifiers(findings, context, file, fileContext);
}

function auditMigrationObjects(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  patterns: ReadonlyArray<readonly [DatabaseObjectKind, RegExp]>,
): void {
  for (const [kind, expression] of patterns) {
    for (const match of file.source.matchAll(expression)) {
      const name = identifierFromMatch(match);
      if (name)
        validateObjectReference(
          findings,
          context,
          file,
          {kind, name, index: match.index ?? 0},
          true,
        );
    }
  }
}

function auditMigrationForeignKeys(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  fileContext: FileOwnerContext,
): void {
  for (const match of file.source.matchAll(
    new RegExp(`\\bREFERENCES\\s+(?:${identifierExpression}\\.)?${identifierExpression}`, 'giu'),
  )) {
    const name = identifierFromMatch(match);
    if (!name) continue;
    const target = objectByNamespace(context, name);
    if (target?.owner && target.owner !== fileContext.owner) {
      addFinding(
        findings,
        context,
        file.path,
        file.source,
        match.index ?? 0,
        name,
        'foreign-key',
        namespaceSuggestion(target.owner, target.namespace),
        fileContext,
      );
    } else {
      validateObjectReference(
        findings,
        context,
        file,
        {kind: 'table', name, index: match.index ?? 0},
        true,
      );
    }
  }
}

function auditDynamicMigrationIdentifiers(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
  fileContext: FileOwnerContext,
): void {
  if (!interpolationPresenceExpression.test(file.source)) return;
  for (const match of file.source.matchAll(dynamicIdentifierExpression)) {
    addFinding(
      findings,
      context,
      file.path,
      file.source,
      match.index ?? 0,
      '<dynamic identifier>',
      'dynamic-sql-identifier',
      `Keep ${fileContext.namespace} migration identifiers static and owner-local.`,
      fileContext,
    );
  }
}

function auditSnapshotFile(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  file: AuditFile,
): void {
  const fileContext = ownerContextForPath(context, file.path);
  if (!fileContext?.unit) return;
  let snapshot: {
    tables?: Record<string, SnapshotTable>;
    enums?: Record<string, SnapshotEnum>;
  };
  try {
    snapshot = JSON.parse(file.source) as typeof snapshot;
  } catch {
    return;
  }
  const references = snapshotObjectReferences(snapshot, file.source);
  for (const reference of references) {
    if (reference.index >= 0) validateObjectReference(findings, context, file, reference, true);
  }
}

function snapshotObjectReferences(
  snapshot: {tables?: Record<string, SnapshotTable>; enums?: Record<string, SnapshotEnum>},
  source: string,
): ObjectReference[] {
  const references: ObjectReference[] = [];
  for (const [qualifiedName, table] of Object.entries(snapshot.tables ?? {})) {
    addSnapshotTableReferences(references, qualifiedName, table, source);
  }
  for (const [qualifiedName, enumValue] of Object.entries(snapshot.enums ?? {})) {
    const name = enumValue.name || lastIdentifier(qualifiedName);
    references.push({
      kind: 'enum',
      name,
      index: source.indexOf(name),
    });
  }
  return references;
}

function addSnapshotTableReferences(
  references: ObjectReference[],
  qualifiedName: string,
  table: SnapshotTable,
  source: string,
): void {
  const tableName = table.name || lastIdentifier(qualifiedName);
  references.push({kind: 'table', name: tableName, index: source.indexOf(tableName)});
  addSnapshotNamedReferences(references, Object.values(table.indexes ?? {}), 'index', source);
  addSnapshotNamedReferences(
    references,
    Object.values(table.uniqueConstraints ?? {}),
    'constraint',
    source,
  );
  addSnapshotNamedReferences(
    references,
    Object.values(table.checkConstraints ?? {}),
    'constraint',
    source,
  );
}

function addSnapshotNamedReferences(
  references: ObjectReference[],
  values: readonly SnapshotNamedObject[],
  kind: DatabaseObjectKind,
  source: string,
): void {
  for (const value of values) {
    if (value.name) references.push({kind, name: value.name, index: source.indexOf(value.name)});
  }
}

async function discoverFiles(
  rootDirectory: string,
  registry: ApiDatabaseRegistry,
): Promise<{sourceFiles: AuditFile[]; migrationFiles: AuditFile[]; snapshotFiles: AuditFile[]}> {
  const sourcePaths = await Promise.all([
    walkFiles(path.join(rootDirectory, 'libs/api')),
    walkFiles(path.join(rootDirectory, 'libs/shared/node')),
    walkFiles(path.join(rootDirectory, 'apps/api')),
  ]);
  const sourceFilePaths = sourcePaths
    .flat()
    .filter((filePath) => sourceFileExpression.test(filePath) && !filePath.includes('/drizzle/'));
  const migrationPaths = await Promise.all(
    registry.migrationUnits.map((unit) => walkFiles(path.join(rootDirectory, unit.migrationsPath))),
  );
  const migrationFilePaths = migrationPaths
    .flat()
    .filter((filePath) => migrationFileExpression.test(filePath));
  const snapshotFilePaths = migrationPaths.flatMap((paths) =>
    paths
      .filter((filePath) => snapshotFileExpression.test(filePath))
      .sort(compareText)
      .slice(-1),
  );
  const [sourceFiles, migrationFiles, snapshotFiles] = await Promise.all([
    readAuditFiles(sourceFilePaths),
    readAuditFiles(migrationFilePaths),
    readAuditFiles(snapshotFilePaths),
  ]);
  return {sourceFiles, migrationFiles, snapshotFiles};
}

function findUnregisteredMigrationUnits(
  findings: DatabaseBoundaryFinding[],
  context: AuditContext,
  files: readonly AuditFile[],
): void {
  const registered = new Set(context.registry.migrationUnits.map((unit) => unit.drizzleConfigPath));
  for (const file of files) {
    const repositoryPath = toRepositoryPath(context.rootDirectory, file.path);
    if (!repositoryPath.endsWith('/drizzle.config.ts')) continue;
    if (registered.has(repositoryPath)) continue;
    addFinding(
      findings,
      context,
      file.path,
      file.source,
      0,
      repositoryPath,
      'unregistered-migration-unit',
      'Register this migration unit in api-databases.cjs before adding database objects.',
    );
  }
}

export async function auditApiDatabaseBoundaries(
  options: DatabaseBoundaryAuditOptions = {},
): Promise<DatabaseBoundaryFinding[]> {
  const registry = options.registry ?? apiDatabaseRegistry;
  const rootDirectory = options.rootDirectory ?? repositoryRoot;
  const discovered = await discoverFiles(rootDirectory, registry);
  const context = createAuditContext(
    {registry, rootDirectory},
    discovered.migrationFiles,
    discovered.snapshotFiles,
    discovered.sourceFiles,
  );
  context.packageOwners = await packageNames(rootDirectory, registry);
  const findings: DatabaseBoundaryFinding[] = [];
  for (const file of discovered.sourceFiles) {
    auditFactories(findings, context, file);
    auditSourceDeclarations(findings, context, file);
    auditRawSql(findings, context, file);
    auditForeignDatabaseAccess(findings, context, file);
    auditSourceForeignKeys(findings, context, file);
    auditMigrationHistory(findings, context, file);
  }
  for (const file of discovered.migrationFiles) {
    auditRawSql(findings, context, file);
    auditMigrationFile(findings, context, file);
  }
  for (const file of discovered.snapshotFiles) auditSnapshotFile(findings, context, file);
  findUnregisteredMigrationUnits(findings, context, discovered.sourceFiles);
  const unique = new Map<string, DatabaseBoundaryFinding>();
  for (const finding of findings) unique.set(findingKey(finding), finding);
  return [...unique.values()].sort(compareFindings);
}

export async function verifyApiDatabaseBoundaries(
  options: DatabaseBoundaryAuditOptions = {},
): Promise<DatabaseBoundaryVerificationResult> {
  const findings = await auditApiDatabaseBoundaries(options);
  return {
    findings,
    registryErrors: await auditApiDatabaseRegistry(options.registry ?? apiDatabaseRegistry),
  };
}

function formatFinding(finding: DatabaseBoundaryFinding): string {
  return `${finding.file}:${finding.line} ${finding.rule} owner=${finding.owner} namespace=${finding.namespace} object=${finding.object} boundary=${finding.suggestedBoundary}`;
}

async function main(): Promise<void> {
  const result = await verifyApiDatabaseBoundaries();
  if (result.registryErrors.length > 0 || result.findings.length > 0) {
    process.stderr.write('API database-boundary verification failed\n');
    for (const error of result.registryErrors) process.stderr.write(`- registry: ${error}\n`);
    for (const finding of result.findings)
      process.stderr.write(`- finding: ${formatFinding(finding)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('API database-boundary verification passed\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
