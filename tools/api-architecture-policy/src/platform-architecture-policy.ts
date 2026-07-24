import {access, readdir, readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  type ArchitectureClassConfiguration,
  type ArchitectureFacts,
  architecturePolicySchemaVersion,
  type CompositionFact,
  createDefaultRepositoryConfiguration,
  evaluateArchitecturePolicy,
  type LocalPackageClassification,
  type ManifestEdgeFact,
  type PackageFact,
  type PolicyDiagnostic,
  type PublicExportFact,
  type RepositoryConfiguration,
} from '@shipfox/architecture-policy';

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const platformRealm = 'source-available';
const serverRoots = [
  'libs/api',
  'libs/shared/common',
  'libs/shared/expression',
  'libs/shared/node',
  'libs/shared/workflow',
] as const;
const dependencyGroups = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;
const registryClassNames = {
  implementations: 'implementation',
  dto: 'dto',
  'shared-semantic': 'shared-semantic',
  'shared-infrastructure': 'shared-infrastructure',
  spi: 'spi',
  'composition-root': 'composition-root',
} as const;
const contextAwareRegistryClasses = new Set(['implementations', 'dto', 'spi']);
const leadingRelativePathExpression = /^\.\//u;
const distPathExpression = /^dist\//u;
const mjsPathExpression = /\.m?js$/u;
const cjsPathExpression = /\.c?js$/u;
const jsxPathExpression = /\.jsx?$/u;

interface ArchitectureRegistryEntry {
  architectureClass: string;
  boundedContext: string | null;
  packagePath: string;
}

interface ApiArchitectureEdge {
  decision: 'allow' | 'same-context' | 'never';
  rule?: string;
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: unknown;
  name?: string;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  version?: string;
}

interface ApiContextRegistry {
  apiArchitectureEdgePolicy: Record<string, Record<string, ApiArchitectureEdge>>;
  architecturePackages: Record<string, Record<string, string[]>>;
}

const {
  apiArchitectureEdgePolicy,
  architecturePackages,
}: ApiContextRegistry = require('../../../api-contexts.cjs');

export interface PlatformArchitecturePolicyDiscovery {
  configuration: RepositoryConfiguration;
  facts: ArchitectureFacts;
}

export interface PlatformArchitecturePolicyOptions {
  compositionFacts?: readonly CompositionFact[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toRepositoryPath(filePath: string): string {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function registryEntries(): ArchitectureRegistryEntry[] {
  return Object.entries(architecturePackages).flatMap(([registryClass, contexts]) => {
    const architectureClass =
      registryClassNames[registryClass as keyof typeof registryClassNames] ?? registryClass;
    return Object.entries(contexts).flatMap(([boundedContext, packagePaths]) =>
      packagePaths.map((packagePath) => ({
        architectureClass,
        boundedContext: contextAwareRegistryClasses.has(registryClass) ? boundedContext : null,
        packagePath,
      })),
    );
  });
}

function registryEntriesByPath(): Map<string, ArchitectureRegistryEntry[]> {
  const entries = new Map<string, ArchitectureRegistryEntry[]>();
  for (const entry of registryEntries()) {
    const existing = entries.get(entry.packagePath) ?? [];
    existing.push(entry);
    entries.set(entry.packagePath, existing);
  }
  return entries;
}

async function findPackagePaths(directory: string, relativeDirectory = ''): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const packagePaths: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      packagePaths.push(...(await findPackagePaths(absolutePath, relativePath)));
    } else if (entry.name === 'package.json') {
      packagePaths.push(path.posix.dirname(relativePath));
    }
  }
  return packagePaths;
}

async function repositoryPackagePaths(): Promise<string[]> {
  const paths = await Promise.all(
    serverRoots.map(async (root) => {
      const relativePaths = await findPackagePaths(path.join(repositoryRoot, root));
      return relativePaths.map((relativePath) => path.posix.join(root, relativePath));
    }),
  );
  return paths.flat().sort(compareText);
}

async function readManifests(
  packagePaths: readonly string[],
): Promise<Map<string, PackageManifest>> {
  const manifests = await Promise.all(
    packagePaths.map(async (packagePath) => {
      const text = await readFile(path.join(repositoryRoot, packagePath, 'package.json'), 'utf8');
      return [packagePath, JSON.parse(text) as PackageManifest] as const;
    }),
  );
  return new Map(manifests);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return false;
    throw error;
  }
}

function packageNameForPath(
  packagePath: string,
  manifests: ReadonlyMap<string, PackageManifest>,
): string {
  return manifests.get(packagePath)?.name ?? `workspace:${packagePath}`;
}

function packageFactForPath(
  packagePath: string,
  manifest: PackageManifest,
  classifiedEntries: ReadonlyMap<string, ArchitectureRegistryEntry[]>,
): PackageFact {
  const classification = classifiedEntries.get(packagePath)?.[0];
  const isPolicyParticipant =
    packagePath.startsWith('libs/api/') || packagePath.startsWith('libs/shared/');
  const hasManifestName = typeof manifest.name === 'string' && manifest.name.length > 0;
  return {
    schemaVersion: architecturePolicySchemaVersion,
    name: manifest.name ?? `workspace:${packagePath}`,
    version: manifest.version ?? null,
    path: packagePath,
    origin: 'local',
    policyParticipant: isPolicyParticipant,
    realm: isPolicyParticipant ? platformRealm : null,
    architectureClass: isPolicyParticipant
      ? hasManifestName && classification?.architectureClass
        ? classification.architectureClass
        : 'unclassified'
      : null,
    boundedContext: isPolicyParticipant ? (classification?.boundedContext ?? null) : null,
  };
}

function externalPackageFact(name: string): PackageFact {
  return {
    schemaVersion: architecturePolicySchemaVersion,
    name,
    version: null,
    path: `node_modules/${name}`,
    origin: 'installed',
    policyParticipant: false,
    realm: null,
    architectureClass: null,
    boundedContext: null,
  };
}

function dependencyNames(
  manifest: PackageManifest,
  group: (typeof dependencyGroups)[number],
): string[] {
  return Object.keys(manifest[group] ?? {}).sort(compareText);
}

function createManifestEdges(
  packagePaths: readonly string[],
  manifests: ReadonlyMap<string, PackageManifest>,
  packageFactsByName: ReadonlyMap<string, PackageFact>,
): {edges: ManifestEdgeFact[]; externalFacts: PackageFact[]} {
  const edges: ManifestEdgeFact[] = [];
  const externalFacts = new Map<string, PackageFact>();
  for (const packagePath of packagePaths) {
    const source = packageFactsByName.get(packageNameForPath(packagePath, manifests));
    if (!source?.policyParticipant) continue;
    const manifest = manifests.get(packagePath);
    if (!manifest) continue;
    for (const dependencyGroup of dependencyGroups) {
      for (const target of dependencyNames(manifest, dependencyGroup)) {
        if (!packageFactsByName.has(target)) externalFacts.set(target, externalPackageFact(target));
        edges.push({
          schemaVersion: architecturePolicySchemaVersion,
          source: source.name,
          target,
          dependencyGroup,
        });
      }
    }
  }
  return {
    edges,
    externalFacts: [...externalFacts.values()].sort((left, right) =>
      compareText(left.name, right.name),
    ),
  };
}

function exportSubpaths(exportsValue: unknown): Array<[string, unknown]> {
  if (typeof exportsValue === 'string' || Array.isArray(exportsValue) || exportsValue === undefined)
    return exportsValue === undefined ? [] : [['.', exportsValue]];
  if (typeof exportsValue !== 'object' || exportsValue === null) return [['.', exportsValue]];
  const entries = Object.entries(exportsValue);
  return entries.some(([key]) => key.startsWith('.')) ? entries : [['.', exportsValue]];
}

function resolveExportTarget(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const resolved = resolveExportTarget(candidate);
      if (resolved) return resolved;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const records = value as Record<string, unknown>;
  for (const condition of ['workspace-source', 'types', 'import', 'require', 'default']) {
    if (!(condition in records)) continue;
    const resolved = resolveExportTarget(records[condition]);
    if (resolved) return resolved;
  }
  for (const candidate of Object.values(records)) {
    const resolved = resolveExportTarget(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function sourceTargetCandidates(target: string): string[] {
  const normalized = target.replace(leadingRelativePathExpression, '');
  const sourceRoot = normalized.replace(distPathExpression, 'src/');
  const candidates = new Set([normalized, sourceRoot]);
  for (const candidate of [...candidates]) {
    candidates.add(candidate.replace(mjsPathExpression, '.mts'));
    candidates.add(candidate.replace(cjsPathExpression, '.cts'));
    candidates.add(candidate.replace(jsxPathExpression, '.tsx'));
    candidates.add(candidate.replace(mjsPathExpression, '.ts'));
    candidates.add(candidate.replace(cjsPathExpression, '.ts'));
    candidates.add(candidate.replace(jsxPathExpression, '.ts'));
  }
  return [...candidates];
}

async function resolveSourceTarget(
  packagePath: string,
  target: string | null,
): Promise<string | null> {
  if (!target || target.includes('*') || target.includes('..')) return null;
  for (const candidate of sourceTargetCandidates(target)) {
    const absolutePath = path.join(repositoryRoot, packagePath, candidate);
    if (await fileExists(absolutePath)) return toRepositoryPath(absolutePath);
  }
  return null;
}

async function createPublicExports(
  packagePaths: readonly string[],
  manifests: ReadonlyMap<string, PackageManifest>,
  packageFactsByName: ReadonlyMap<string, PackageFact>,
): Promise<{exports: PublicExportFact[]; exportIntent: Record<string, string[]>}> {
  const exports: PublicExportFact[] = [];
  const exportIntent = new Map<string, Set<string>>();
  for (const packagePath of packagePaths) {
    const manifest = manifests.get(packagePath);
    const packageFact = packageFactsByName.get(packageNameForPath(packagePath, manifests));
    if (!manifest || !packageFact?.policyParticipant) continue;
    const entries = exportSubpaths(manifest.exports);
    for (const [publicSubpath, value] of entries) {
      const declaredTarget = resolveExportTarget(value);
      exports.push({
        schemaVersion: architecturePolicySchemaVersion,
        package: packageFact.name,
        publicSubpath,
        // The repository adapter owns the explicit DTO contract source. The
        // packed-package verifier owns resolving every other public entrypoint.
        resolvedTarget:
          publicSubpath === './inter-module'
            ? await resolveSourceTarget(packagePath, declaredTarget)
            : declaredTarget,
      });
    }
    if (await fileExists(path.join(repositoryRoot, packagePath, 'src/inter-module.ts'))) {
      const expected = exportIntent.get(packageFact.name) ?? new Set<string>();
      expected.add('./inter-module');
      exportIntent.set(packageFact.name, expected);
    }
  }
  return {
    exports: exports.sort((left, right) =>
      compareText(
        `${left.package}:${left.publicSubpath}`,
        `${right.package}:${right.publicSubpath}`,
      ),
    ),
    exportIntent: Object.fromEntries(
      [...exportIntent.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([packageName, subpaths]) => [packageName, [...subpaths].sort(compareText)]),
    ),
  };
}

function createArchitectureClasses(): Record<string, ArchitectureClassConfiguration> {
  const configuration = createDefaultRepositoryConfiguration();
  for (const entry of registryEntries()) {
    configuration.architectureClasses[entry.architectureClass] ??= {
      requiresBoundedContext: entry.boundedContext !== null,
    };
  }
  return configuration.architectureClasses;
}

function createClassRelationships(): RepositoryConfiguration['classRelationships'] {
  const relationships: RepositoryConfiguration['classRelationships'] = {};
  for (const [sourceRegistryClass, targetRows] of Object.entries(apiArchitectureEdgePolicy)) {
    const sourceClass =
      registryClassNames[sourceRegistryClass as keyof typeof registryClassNames] ??
      sourceRegistryClass;
    const row: RepositoryConfiguration['classRelationships'][string] = {};
    for (const [targetRegistryClass, edge] of Object.entries(targetRows)) {
      const targetClass =
        registryClassNames[targetRegistryClass as keyof typeof registryClassNames] ??
        targetRegistryClass;
      row[targetClass] = {
        decision: edge.decision,
        ...(edge.rule ? {ruleId: edge.rule} : {}),
      };
    }
    relationships[sourceClass] = row;
  }
  return relationships;
}

function createConfiguration(
  manifests: ReadonlyMap<string, PackageManifest>,
  classifiedEntries: ReadonlyMap<string, ArchitectureRegistryEntry[]>,
  exportIntent: Record<string, string[]>,
): RepositoryConfiguration {
  const configuration = createDefaultRepositoryConfiguration();
  configuration.realms = {[platformRealm]: {mayDependOn: [platformRealm]}};
  configuration.architectureClasses = createArchitectureClasses();
  configuration.classRelationships = createClassRelationships();
  configuration.localPackages = registryEntries().map<LocalPackageClassification>((entry) => ({
    path: entry.packagePath,
    packageName: packageNameForPath(entry.packagePath, manifests),
    realm: platformRealm,
    architectureClass: entry.architectureClass,
    boundedContext: entry.boundedContext,
  }));
  configuration.compositionRoots = registryEntries()
    .filter(({architectureClass}) => architectureClass === 'composition-root')
    .map(({packagePath}) => packageNameForPath(packagePath, manifests));
  configuration.exportIntent = exportIntent;
  configuration.extensions = {
    platform: {
      classificationSource: 'api-contexts.cjs',
      dependencyCruiserSource: 'api-contexts.cjs',
      classifiedPackageCount: classifiedEntries.size,
    },
  };
  return configuration;
}

export async function discoverPlatformArchitecturePolicy(
  options: PlatformArchitecturePolicyOptions = {},
): Promise<PlatformArchitecturePolicyDiscovery> {
  const packagePaths = await repositoryPackagePaths();
  const manifests = await readManifests(packagePaths);
  const classifiedEntries = registryEntriesByPath();
  const packageFacts = packagePaths.map((packagePath) =>
    packageFactForPath(packagePath, manifests.get(packagePath) ?? {}, classifiedEntries),
  );
  const packageFactsByName = new Map(
    packageFacts.map((packageFact) => [packageFact.name, packageFact]),
  );
  const {edges: manifestEdges, externalFacts} = createManifestEdges(
    packagePaths,
    manifests,
    packageFactsByName,
  );
  const {exports, exportIntent} = await createPublicExports(
    packagePaths,
    manifests,
    packageFactsByName,
  );
  const configuration = createConfiguration(manifests, classifiedEntries, exportIntent);
  const facts: ArchitectureFacts = {
    schemaVersion: architecturePolicySchemaVersion,
    packages: [...packageFacts, ...externalFacts],
    // Dependency Cruiser remains the owner of resolved source edges. Its rules
    // consume the same api-contexts.cjs classifications and edge matrix.
    importEdges: [],
    manifestEdges,
    publicExports: exports,
    compositionFacts: [...(options.compositionFacts ?? [])],
  };
  return {configuration, facts};
}

export async function evaluatePlatformArchitecturePolicy(
  options: PlatformArchitecturePolicyOptions = {},
): Promise<PolicyDiagnostic[]> {
  const {facts, configuration} = await discoverPlatformArchitecturePolicy(options);
  return evaluateArchitecturePolicy(facts, configuration);
}

export function apiContextPackagePaths(): string[] {
  return registryEntries()
    .map(({packagePath}) => packagePath)
    .sort(compareText);
}

export {platformRealm, serverRoots};
