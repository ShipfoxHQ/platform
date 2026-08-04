import {execFile} from 'node:child_process';
import {existsSync, globSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

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
  run,
} from './productionized-manifest-packer.js';
import {
  getRepositoryRoot,
  loadPublicationClosure,
  resolvePublicationManifests,
} from './publish-productionized-closure.js';

type DependencyMap = Record<string, string>;
type JsonRecord = Record<string, unknown>;

interface PackageManifest extends JsonRecord {
  bin?: Record<string, string> | string;
  dependencies?: DependencyMap;
  name: string;
  optionalDependencies?: DependencyMap;
  peerDependencies?: DependencyMap;
  private?: boolean;
  version?: string;
}

export interface PublicationPackage {
  directory: string;
  manifest: PackageManifest;
  manifestPath: string;
}

const runtimeDependencyFields = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;
const semverRange =
  /^(?:[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|[~^]?\d+\.\d+|[~^]?\d+|\*|latest)$/u;

export type PublishedVersionLookup = (name: string) => Promise<ReadonlySet<string>>;

const defaultRegistry = process.env.npm_config_registry ?? 'https://registry.npmjs.org';
const trailingSlash = /\/$/u;

export function readPublicationClosurePackages(root: string): Promise<PublicationPackage[]> {
  const config = loadPublicationClosure(root);
  return readPublicationPackages(resolvePublicationManifests(root, config.packages));
}

// The publication closure is only the application runtime graph. `changeset publish` also releases
// the public `tools/*` packages, so the registry check has to span everything changesets will
// attempt rather than the closure alone.
export async function readChangesetPublishablePackages(
  root: string,
): Promise<PublicationPackage[]> {
  const ignored = await readChangesetIgnoreList(root);
  const manifestPaths = globSync(join(root, '{apps,e2e,infra,libs,tools}/**/package.json'), {
    exclude: ['**/node_modules/**'],
  });
  const packages = await readPublicationPackages(manifestPaths);
  return packages.filter(
    ({manifest}) =>
      typeof manifest.name === 'string' &&
      typeof manifest.version === 'string' &&
      manifest.private !== true &&
      !ignored.has(manifest.name),
  );
}

async function readChangesetIgnoreList(root: string): Promise<ReadonlySet<string>> {
  const configPath = join(root, '.changeset', 'config.json');
  if (!existsSync(configPath)) return new Set();
  const config = JSON.parse(await readFile(configPath, 'utf8')) as {ignore?: string[]};
  return new Set(config.ignore ?? []);
}

export async function fetchPublishedVersions(
  name: string,
  registry: string = defaultRegistry,
): Promise<ReadonlySet<string>> {
  const response = await fetch(
    `${registry.replace(trailingSlash, '')}/${name.replace('/', '%2f')}`,
    {
      headers: {accept: 'application/vnd.npm.install-v1+json'},
    },
  );
  if (response.status === 404) return new Set();
  if (!response.ok)
    throw new Error(`Registry lookup for ${name} failed with status ${response.status}`);
  const document = (await response.json()) as {versions?: Record<string, unknown>};
  return new Set(Object.keys(document.versions ?? {}));
}

// `changeset publish` treats an already-published version as a no-op and reports success, so a
// version that collides with an abandoned lineage never reaches the registry while consumers keep
// resolving the old tarball for that number. Fail the release instead of shipping that mismatch.
export async function assertPublishableVersions(
  packages: PublicationPackage[],
  lookup: PublishedVersionLookup = (name) => fetchPublishedVersions(name),
): Promise<void> {
  const results = await mapWithConcurrency(packages, 5, async (entry) => {
    const {name, version} = entry.manifest;
    if (typeof version !== 'string') return undefined;
    return (await lookup(name)).has(version) ? `${name}@${version}` : undefined;
  });
  const collisions = results.filter((value): value is string => value !== undefined);
  if (collisions.length > 0) {
    throw new Error(
      `Publication preflight found versions already on the registry: ${collisions.join(', ')}. ` +
        'Publishing would be skipped silently and consumers would resolve the existing tarball. ' +
        'Bump each package past its published range.',
    );
  }
  process.stdout.write(
    `Publication preflight registry check passed: ${packages.length} versions are unpublished.\n`,
  );
}

export async function preflightPublicationClosure(root: string): Promise<void> {
  const config = loadPublicationClosure(root);
  const manifestPaths = resolvePublicationManifests(root, config.packages);
  const packages = await readPublicationPackages(manifestPaths);
  const packagesByName = new Map(packages.map((entry) => [entry.manifest.name, entry]));
  const workspacePackages = await readWorkspacePackages(root);
  const workspaceVersions = new Map(
    [...workspacePackages].flatMap(([name, manifest]) =>
      typeof manifest.version === 'string' ? [[name, manifest.version] as const] : [],
    ),
  );
  const workspaceConfig = parseYaml(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')) as {
    catalog?: DependencyMap;
    catalogs?: Record<string, DependencyMap>;
  };
  const dependencyContext = {workspaceConfig, workspaceVersions} satisfies PackageDependencyContext;

  validatePublicationPlan(packages, packagesByName, workspacePackages);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-publication-preflight-'));
  const tarballRoot = join(temporaryRoot, 'tarballs');
  const stagingRoot = join(temporaryRoot, 'packages');

  try {
    await Promise.all([mkdir(tarballRoot), mkdir(stagingRoot)]);
    const results = await mapWithConcurrency(packages, 3, async (entry) => {
      const tarball = join(tarballRoot, `${safePackageName(entry.manifest.name)}.tgz`);
      await packProductionizedPackage({
        dependencyContext,
        manifest: entry.manifest,
        sourceDirectory: entry.directory,
        stagingRoot,
        packArtifact: (stagedDirectory) =>
          run('pnpm', ['pack', '--out', tarball], stagedDirectory, {stdio: 'ignore'}),
      });
      await validatePackedPackage(entry, tarball, packagesByName);
      return {name: entry.manifest.name, tarball};
    });
    if (existsSync(join(root, 'tools/engineering-guidance/package.json'))) {
      const guidanceTarball = results.find(
        ({name}) => name === engineeringGuidancePackageName,
      )?.tarball;
      if (!guidanceTarball) {
        throw new Error(
          `Publication preflight did not pack ${engineeringGuidancePackageName}; keep public tools outside application runtime closures`,
        );
      }
      await validateExternalEngineeringGuidanceArtifact(guidanceTarball, root);
    }
    process.stdout.write(
      `Publication preflight plan: ${results.map(({name}) => name).join(', ')}\n` +
        `Publication preflight passed: packed ${results.length} packages.\n`,
    );
  } finally {
    await rm(temporaryRoot, {force: true, recursive: true});
  }
}

function readPublicationPackages(manifestPaths: string[]): Promise<PublicationPackage[]> {
  return Promise.all(
    manifestPaths.map(async (manifestPath) => ({
      directory: dirname(manifestPath),
      manifest: JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest,
      manifestPath,
    })),
  );
}

async function readWorkspacePackages(root: string): Promise<Map<string, PackageManifest>> {
  const manifestPaths = globSync(join(root, '{apps,e2e,infra,libs,tools,turbo}/**/package.json'), {
    exclude: ['**/node_modules/**'],
  });
  const manifests = await Promise.all(
    manifestPaths.map(async (path) => [path, JSON.parse(await readFile(path, 'utf8'))] as const),
  );
  const packages = new Map<string, PackageManifest>();
  for (const [, manifest] of manifests) {
    if (typeof manifest.name !== 'string') continue;
    if (packages.has(manifest.name))
      throw new Error(`Duplicate workspace package: ${manifest.name}`);
    packages.set(manifest.name, manifest as PackageManifest);
  }
  return packages;
}

function validatePublicationPlan(
  packages: PublicationPackage[],
  packagesByName: ReadonlyMap<string, PublicationPackage>,
  workspacePackages: ReadonlyMap<string, PackageManifest>,
): void {
  for (const entry of packages) {
    const {manifest} = entry;
    if (manifest.private === true)
      throw new Error(`Publication package is private: ${manifest.name}`);
    if (typeof manifest.version !== 'string')
      throw new Error(`Publication package has no version: ${manifest.name}`);
    for (const field of runtimeDependencyFields) {
      for (const [dependency, reference] of Object.entries(manifest[field] ?? {})) {
        if (typeof reference !== 'string') {
          throw new Error(
            `Publication package ${manifest.name} has invalid ${field} reference for ${dependency}`,
          );
        }
        const workspacePackage = workspacePackages.get(dependency);
        if (workspacePackage) {
          if (workspacePackage.private === true) {
            throw new Error(
              `Publication package ${manifest.name} has private runtime dependency ${dependency}`,
            );
          }
          if (!packagesByName.has(dependency)) {
            throw new Error(
              `Publication package ${manifest.name} depends on ${dependency} outside the release plan`,
            );
          }
        } else if (!reference.startsWith('catalog:') && !semverRange.test(reference)) {
          throw new Error(
            `Publication package ${manifest.name} has unsupported external range ${dependency}@${reference}`,
          );
        }
      }
    }
  }
}

async function validatePackedPackage(
  entry: PublicationPackage,
  tarball: string,
  packagesByName: ReadonlyMap<string, PublicationPackage>,
): Promise<void> {
  const files = (await execFileText('tar', ['-tzf', tarball])).split('\n').filter(Boolean);
  const packedManifestText = await execFileText('tar', ['-xOzf', tarball, 'package/package.json']);
  const manifest = JSON.parse(packedManifestText) as PackageManifest;
  validatePackedPackageManifest(entry, files, manifest, packagesByName);
}

export function validatePackedPackageManifest(
  entry: PublicationPackage,
  files: string[],
  manifest: PackageManifest,
  packagesByName: ReadonlyMap<string, PublicationPackage>,
): void {
  assertPackageArchitectureMetadataMatches(
    manifest,
    architectureMetadataForPackageDirectory(entry.directory),
    'Packed',
  );
  const unsupported = findUnsupportedProtocol(manifest);
  if (unsupported)
    throw new Error(`Packed ${manifest.name} contains unsupported protocol at ${unsupported}`);
  validatePackedDependencies(manifest, packagesByName);
  for (const target of packageEntryTargets(manifest)) {
    if (!target.startsWith('./')) continue;
    const expectedPath = `package/${target.slice(2)}`;
    if (!files.some((file) => matchesPackagePath(file, expectedPath))) {
      throw new Error(`Packed ${manifest.name} is missing entry point ${target}`);
    }
  }
  if (manifest.name !== entry.manifest.name || manifest.version !== entry.manifest.version) {
    throw new Error(`Packed manifest differs from release plan for ${entry.manifest.name}`);
  }
}

function matchesPackagePath(file: string, expectedPath: string): boolean {
  if (!expectedPath.includes('*')) return file === expectedPath;
  const [prefix, suffix] = expectedPath.split('*');
  return file.startsWith(prefix ?? '') && file.endsWith(suffix ?? '');
}

function validatePackedDependencies(
  manifest: PackageManifest,
  packagesByName: ReadonlyMap<string, PublicationPackage>,
): void {
  for (const field of runtimeDependencyFields) {
    for (const [name, reference] of Object.entries(manifest[field] ?? {})) {
      const plannedVersion = packagesByName.get(name)?.manifest.version;
      if (plannedVersion && !matchesPlannedVersion(reference, plannedVersion)) {
        throw new Error(
          `Packed ${manifest.name} has inconsistent release dependency ${name}@${reference}`,
        );
      }
      if (
        !packagesByName.has(name) &&
        typeof reference === 'string' &&
        !semverRange.test(reference)
      ) {
        throw new Error(`Packed ${manifest.name} has invalid external range ${name}@${reference}`);
      }
    }
  }
}

function matchesPlannedVersion(reference: string, version: string): boolean {
  return reference === version || reference === `^${version}` || reference === `~${version}`;
}

function packageEntryTargets(manifest: PackageManifest): string[] {
  return exportTargets(manifest.exports).concat(
    exportTargets(manifest.imports),
    binTargets(manifest.bin),
  );
}

function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(exportTargets);
}

function binTargets(bin: PackageManifest['bin']): string[] {
  if (typeof bin === 'string') return [bin];
  return Object.values(bin ?? {});
}

export function findUnsupportedProtocol(value: unknown, path = 'package.json'): string | undefined {
  if (typeof value === 'string') {
    return value.startsWith('catalog:') || value.startsWith('workspace:') ? path : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    const found = findUnsupportedProtocol(child, `${path}.${key}`);
    if (found) return found;
  }
  return undefined;
}

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error)
        reject(new Error(`${command} ${args.join(' ')} failed: ${stderr || error.message}`));
      else resolvePromise(stdout);
    });
  });
}

function safePackageName(name: string): string {
  return name.replace('@shipfox/', '').replaceAll('/', '-');
}

async function main() {
  const root = getRepositoryRoot(import.meta.url);
  await preflightPublicationClosure(root);
  await assertPublishableVersions(await readChangesetPublishablePackages(root));
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryPoint === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `Publication preflight failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
