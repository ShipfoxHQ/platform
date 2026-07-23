import {globSync} from 'node:fs';
import {access, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {parse as parseYaml} from 'yaml';

import {
  engineeringGuidancePackageName,
  validateExternalEngineeringGuidanceArtifact,
} from './engineering-guidance-artifact.js';
import {
  architectureMetadataForPackageDirectory,
  assertPackageArchitectureMetadataMatches,
} from './package-architecture-metadata.js';
import {
  mapWithConcurrency,
  type PackageDependencyContext,
  packProductionizedPackage,
  resolveDependencyReference,
  run,
} from './productionized-manifest-packer.js';
import {getRepositoryRoot} from './repository-root.js';

type DependencyMap = Record<string, string>;

export interface PackageManifest extends Record<string, unknown> {
  bin?: Record<string, string> | string;
  dependencies?: DependencyMap;
  exports?: unknown;
  main?: string;
  name: string;
  peerDependencies?: DependencyMap;
  private?: boolean;
  version?: string;
}

interface SourcePackage {
  directory: string;
  manifest: PackageManifest;
  manifestPath: string;
}

interface WorkspaceConfig {
  catalog?: DependencyMap;
  catalogs?: Record<string, DependencyMap>;
}

type SourcePackageEntry = [string, SourcePackage];
type SourcePackages = Map<string, SourcePackage>;

const repositoryRoot = getRepositoryRoot(import.meta.url);
const registryShipfoxPackagePattern = /^@shipfox\+[^@]+@\d/u;
const runtimeModulePattern = /\.(?:[cm]?js|node)$/u;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Published package artifact validation failed: ${message}\n`);
    process.exitCode = 1;
  });
}

export async function main() {
  const [workspaceText, sourcePackageEntries, workspaceVersions] = await Promise.all([
    readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8'),
    readSourcePackages(),
    readWorkspaceVersions(),
  ]);
  const workspace = parseYaml(workspaceText) as WorkspaceConfig;
  const dependencyContext = {workspaceConfig: workspace, workspaceVersions};
  const sourcePackages = new Map(sourcePackageEntries);
  const expectedDependencies = new Map(
    [...sourcePackages].map(([name, sourcePackage]) => [
      name,
      catalogDependencies(sourcePackage.manifest, workspace, workspaceVersions),
    ]),
  );
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'shipfox-published-artifacts-'));
  const tarballRoot = join(fixtureRoot, 'tarballs');
  const stagingRoot = join(fixtureRoot, 'packages');

  try {
    await Promise.all([mkdir(tarballRoot), mkdir(stagingRoot)]);
    const tarballs = await packPackages(
      [...sourcePackages],
      tarballRoot,
      stagingRoot,
      dependencyContext,
    );
    const guidanceTarball = tarballs[engineeringGuidancePackageName];
    if (!guidanceTarball) {
      throw new Error(
        `Published tool inventory is missing ${engineeringGuidancePackageName}; keep public tools discoverable by the release verifier`,
      );
    }
    await validateExternalEngineeringGuidanceArtifact(guidanceTarball, repositoryRoot);
    await writeConsumerManifest(fixtureRoot, tarballs);
    await run('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], fixtureRoot);
    await validateInstalledPackages(fixtureRoot, sourcePackages, expectedDependencies);
    await validateNoRegistryShipfoxPackages(fixtureRoot);
    await exerciseConsumer(fixtureRoot, sourcePackages);
    process.stdout.write(`Validated ${sourcePackages.size} packed public tool artifacts.\n`);
  } finally {
    await rm(fixtureRoot, {recursive: true, force: true});
  }
}

async function readSourcePackages(): Promise<SourcePackageEntry[]> {
  const entries = await Promise.all(
    globSync(join(repositoryRoot, 'tools/**/package.json')).map(async (manifestPath) => {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest;
      if (manifest.private === true) return undefined;
      const {name} = manifest;
      if (typeof name !== 'string')
        throw new Error(`${manifestPath} does not define a package name`);
      return [
        name,
        {
          directory: dirname(manifestPath),
          manifest,
          manifestPath,
        },
      ] satisfies SourcePackageEntry;
    }),
  );
  const sourcePackageEntries = entries.filter(
    (entry): entry is SourcePackageEntry => entry !== undefined,
  );
  const names = new Set<string>();
  for (const [name] of sourcePackageEntries) {
    if (names.has(name)) throw new Error(`Duplicate public tool package: ${name}`);
    names.add(name);
  }
  return sourcePackageEntries;
}

export function catalogDependencies(
  manifest: PackageManifest,
  workspaceConfig: WorkspaceConfig,
  workspaceVersions: ReadonlyMap<string, string> = new Map(),
): DependencyMap {
  const dependencies: DependencyMap = {};
  for (const [name, reference] of Object.entries(manifest.dependencies ?? {})) {
    if (
      typeof reference !== 'string' ||
      (!reference.startsWith('catalog:') && !reference.startsWith('workspace:'))
    ) {
      throw new Error(
        `Published package ${manifest.name} must use a catalog or workspace reference for ${name}`,
      );
    }
    const resolved = resolveDependencyReference(name, reference, {
      workspaceConfig,
      workspaceVersions,
    });
    if (typeof resolved !== 'string') {
      throw new Error(`Published package ${manifest.name} has an invalid dependency for ${name}`);
    }
    dependencies[name] = resolved;
  }
  return dependencies;
}

export function catalogRange(
  reference: string,
  dependency: string,
  workspaceConfig: WorkspaceConfig,
): string {
  const catalogName = reference === 'catalog:' ? 'default' : reference.slice('catalog:'.length);
  const catalog =
    catalogName === 'default' ? workspaceConfig.catalog : workspaceConfig.catalogs?.[catalogName];
  const range = catalog?.[dependency];
  if (typeof range !== 'string') {
    throw new Error(`Catalog ${catalogName} does not define ${dependency}`);
  }
  return range;
}

async function packPackages(
  packages: SourcePackageEntry[],
  tarballRoot: string,
  stagingRoot: string,
  dependencyContext: PackageDependencyContext,
): Promise<DependencyMap> {
  const tarballs = await mapWithConcurrency(packages, 3, async ([name, sourcePackage]) => {
    const tarball = join(tarballRoot, `${safePackageName(name)}.tgz`);
    await packProductionizedPackage({
      dependencyContext,
      manifest: sourcePackage.manifest,
      sourceDirectory: sourcePackage.directory,
      stagingRoot,
      packArtifact: (stagedDirectory) =>
        run('pnpm', ['pack', '--out', tarball], stagedDirectory, {stdio: 'ignore'}),
    });
    return [name, tarball] as const;
  });
  return Object.fromEntries(tarballs);
}

async function readWorkspaceVersions(): Promise<Map<string, string>> {
  const manifestPaths = globSync(
    join(repositoryRoot, '{apps,e2e,infra,libs,tools,turbo}/**/package.json'),
    {exclude: ['**/node_modules/**']},
  );
  const entries = await Promise.all(
    manifestPaths.map(async (manifestPath) => {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest;
      return typeof manifest.name === 'string' && typeof manifest.version === 'string'
        ? ([manifest.name, manifest.version] as const)
        : undefined;
    }),
  );
  return new Map(
    entries.filter((entry): entry is readonly [string, string] => entry !== undefined),
  );
}

async function writeConsumerManifest(root: string, tarballs: DependencyMap): Promise<void> {
  const manifest = {
    name: 'shipfox-published-package-artifacts-consumer',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: consumerDependencies(tarballs),
  };
  await Promise.all([
    writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(
      join(root, 'pnpm-workspace.yaml'),
      `overrides: ${JSON.stringify(consumerOverrides(tarballs))}\n`,
    ),
  ]);
}

export function consumerDependencies(tarballs: DependencyMap): DependencyMap {
  return Object.fromEntries(
    Object.entries(tarballs).map(([name, tarball]) => [name, `file:${tarball}`]),
  );
}

export function consumerOverrides(tarballs: DependencyMap): DependencyMap {
  return Object.fromEntries(
    Object.entries(tarballs).map(([name, tarball]) => [name, `file:${tarball}`]),
  );
}

export async function validateInstalledPackages(
  root: string,
  packages: SourcePackages,
  expectedDependencies: Map<string, DependencyMap>,
): Promise<void> {
  const fixturePath = await realpath(root);
  for (const [name, sourcePackage] of packages) {
    const manifestPath = join(root, 'node_modules', name, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.version !== sourcePackage.manifest.version) {
      throw new Error(
        `Packed ${name} has version ${manifest.version}; expected ${sourcePackage.manifest.version}`,
      );
    }
    assertPackageArchitectureMetadataMatches(
      manifest,
      architectureMetadataForPackageDirectory(sourcePackage.directory),
      'Installed',
    );
    const unsupportedProtocol = findUnsupportedProtocol(manifest);
    if (unsupportedProtocol) {
      throw new Error(`Packed ${name} contains an unsupported protocol at ${unsupportedProtocol}`);
    }
    validateCatalogRanges(name, manifest, expectedDependencies);
    validatePeerRanges(name, sourcePackage.manifest, manifest);
    await validatePackageFiles(root, name, manifest);
    const packagePath = await realpath(join(root, 'node_modules', name));
    if (!packagePath.startsWith(fixturePath)) {
      throw new Error(`Packed ${name} resolved outside the external consumer`);
    }
  }
}

async function validatePackageFiles(
  root: string,
  name: string,
  manifest: PackageManifest,
): Promise<void> {
  const binPaths =
    typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin ?? {});
  for (const binPath of binPaths) {
    try {
      await access(join(root, 'node_modules', name, binPath));
    } catch (error) {
      throw new Error(`Packed ${name} is missing its executable ${binPath}`, {cause: error});
    }
  }
}

export function findUnsupportedProtocol(value: unknown, path = 'package.json'): string | undefined {
  if (typeof value === 'string') {
    return value.startsWith('catalog:') || value.startsWith('workspace:') ? path : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const unsupportedProtocol = findUnsupportedProtocol(child, `${path}.${key}`);
    if (unsupportedProtocol) return unsupportedProtocol;
  }
  return undefined;
}

function validateCatalogRanges(
  name: string,
  manifest: PackageManifest,
  expectedDependencies: Map<string, DependencyMap>,
): void {
  for (const [dependency, expectedRange] of Object.entries(expectedDependencies.get(name) ?? {})) {
    const actualRange = manifest.dependencies?.[dependency];
    if (actualRange !== expectedRange) {
      throw new Error(
        `Packed ${name} has ${dependency}@${actualRange ?? 'missing'}; expected ${expectedRange}`,
      );
    }
  }
}

function validatePeerRanges(
  name: string,
  sourceManifest: PackageManifest,
  packedManifest: PackageManifest,
): void {
  const expectedPeers = sourceManifest.peerDependencies ?? {};
  for (const [peer, expectedRange] of Object.entries(expectedPeers)) {
    const actualRange = packedManifest.peerDependencies?.[peer];
    if (actualRange !== expectedRange) {
      throw new Error(
        `Packed ${name} has peer ${peer}@${actualRange ?? 'missing'}; expected ${expectedRange}`,
      );
    }
  }
}

async function validateNoRegistryShipfoxPackages(root: string): Promise<void> {
  const virtualStore = await readdir(join(root, 'node_modules/.pnpm'), {withFileTypes: true});
  const registryPackages = virtualStore
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => registryShipfoxPackagePattern.test(name));
  if (registryPackages.length > 0) {
    throw new Error(
      `External consumer used registry Shipfox packages: ${registryPackages.join(', ')}`,
    );
  }
}

async function exerciseConsumer(root: string, sourcePackages: SourcePackages): Promise<void> {
  const imports = [...sourcePackages].flatMap(([name, {manifest}]) =>
    runtimeEntryPoints(name, manifest),
  );
  await run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const imports = ${JSON.stringify(imports)};
const modules = await Promise.all(imports.map((specifier) => import(specifier)));
if (modules.some((module) => Object.keys(module).length === 0)) throw new Error('An imported packed package has no exports.');`,
    ],
    root,
  );
  await run(
    process.execPath,
    [
      '--conditions=development',
      '--input-type=module',
      '--eval',
      `const imports = ${JSON.stringify(imports)};
const modules = await Promise.all(imports.map((specifier) => import(specifier)));
if (modules.some((module) => Object.keys(module).length === 0)) throw new Error('A development-condition import has no exports.');`,
    ],
    root,
  );
}

export function runtimeEntryPoints(name: string, manifest: PackageManifest): string[] {
  if (manifest.exports === undefined) {
    return typeof manifest.main === 'string' && runtimeTarget(manifest.main) ? [name] : [];
  }
  if (typeof manifest.exports === 'string') {
    return runtimeTarget(manifest.exports) ? [name] : [];
  }
  if (!isRecord(manifest.exports)) return [];
  const exportsField = manifest.exports;
  const subpaths = Object.keys(exportsField).filter((key) => key.startsWith('.'));
  if (subpaths.length === 0) {
    return exportTargets(exportsField).some(runtimeTarget) ? [name] : [];
  }
  return subpaths.flatMap((subpath) => {
    const target = exportsField[subpath];
    if (!exportTargets(target).some(runtimeTarget)) return [];
    return [subpath === '.' ? name : `${name}/${subpath.slice(2)}`];
  });
}

function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([condition, target]) =>
    condition === 'types' ? [] : exportTargets(target),
  );
}

function runtimeTarget(target: string): boolean {
  return runtimeModulePattern.test(target);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function safePackageName(name: string): string {
  return name.replace('@shipfox/', '').replaceAll('/', '-');
}
