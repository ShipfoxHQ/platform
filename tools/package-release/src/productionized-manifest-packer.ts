import {spawn} from 'node:child_process';
import {cp, readFile, writeFile} from 'node:fs/promises';
import {basename, join} from 'node:path';

import {productionizeManifest} from '@shipfox/tool-utils';

import {
  architectureMetadataForPackageDirectory,
  assertPackageArchitectureMetadataMatches,
} from './package-architecture-metadata.js';

type JsonRecord = Record<string, unknown>;
type DependencyMap = Record<string, string>;

export interface PackageDependencyContext {
  workspaceConfig: {
    catalog?: DependencyMap;
    catalogs?: Record<string, DependencyMap>;
  };
  workspaceVersions: ReadonlyMap<string, string>;
}

interface PackProductionizedPackageOptions<T> {
  dependencyContext: PackageDependencyContext;
  manifest: JsonRecord;
  packArtifact: (stagedDirectory: string) => Promise<T>;
  sourceDirectory: string;
  stagingRoot: string;
}

export async function packProductionizedPackage<T>({
  dependencyContext,
  manifest,
  packArtifact,
  sourceDirectory,
  stagingRoot,
}: PackProductionizedPackageOptions<T>): Promise<T> {
  if (typeof manifest.name !== 'string') throw new Error('Package manifest must define a name');

  const stagedDirectory = join(stagingRoot, safePackageName(manifest.name));
  await cp(sourceDirectory, stagedDirectory, {
    filter: (source) => !excludedStagingEntryNames.has(basename(source)),
    recursive: true,
  });

  const stagedManifestPath = join(stagedDirectory, 'package.json');
  const stagedManifest = JSON.parse(await readFile(stagedManifestPath, 'utf8')) as JsonRecord;
  const productionManifest = productionizeDependencyReferences(
    productionizePackageManifest(stagedManifest, sourceDirectory),
    dependencyContext,
  );
  await writeFile(stagedManifestPath, `${JSON.stringify(productionManifest, null, 2)}\n`);

  return packArtifact(stagedDirectory);
}

export function productionizePackageManifest(
  manifest: JsonRecord,
  sourceDirectory?: string,
): JsonRecord {
  const productionManifest = productionizeManifest(manifest);
  const {devDependencies: _, imports, ...publishManifest} = productionManifest;
  const productionizedManifest = isRecord(imports)
    ? {
        ...publishManifest,
        imports: Object.fromEntries(
          Object.entries(imports).filter(([specifier]) => !specifier.startsWith('#test/')),
        ),
      }
    : publishManifest;

  const expectedMetadata = sourceDirectory
    ? architectureMetadataForPackageDirectory(sourceDirectory)
    : undefined;
  if (expectedMetadata) {
    const existingShipfox = isRecord(productionizedManifest.shipfox)
      ? productionizedManifest.shipfox
      : {};
    if (!Object.hasOwn(existingShipfox, 'architecture')) {
      productionizedManifest.shipfox = {...existingShipfox, architecture: expectedMetadata};
    }
  }
  assertPackageArchitectureMetadataMatches(
    productionizedManifest,
    expectedMetadata,
    'Productionized package',
  );
  return productionizedManifest;
}

export function run(
  command: string,
  args: string[],
  cwd: string,
  {signal, stdio = 'inherit'}: {signal?: AbortSignal; stdio?: 'ignore' | 'inherit'} = {},
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {cwd, stdio});
    const terminate = () => child.kill('SIGTERM');
    const cleanup = () => signal?.removeEventListener('abort', terminate);

    if (signal?.aborted) terminate();
    else signal?.addEventListener('abort', terminate, {once: true});

    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('exit', (code) => {
      cleanup();
      if (code === 0) resolvePromise();
      else reject(new Error(`${basename(command)} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let failure: unknown;

  async function worker() {
    while (nextIndex < values.length && failure === undefined) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        const value = values[index];
        if (value !== undefined) results[index] = await mapper(value, index);
      } catch (error) {
        failure ??= error;
      }
    }
  }

  await Promise.all(Array.from({length: concurrency}, () => worker()));
  if (failure !== undefined) throw failure;
  return results;
}

function safePackageName(name: string) {
  return name.replace('@shipfox/', '').replaceAll('/', '-');
}

const excludedStagingEntryNames = new Set(['node_modules', '.turbo']);
const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

function productionizeDependencyReferences(
  manifest: JsonRecord,
  dependencyContext: PackageDependencyContext,
): JsonRecord {
  const productionManifest = {...manifest};

  for (const field of dependencyFields) {
    const dependencies = manifest[field];
    if (!isRecord(dependencies)) continue;
    productionManifest[field] = Object.fromEntries(
      Object.entries(dependencies).map(([name, reference]) => [
        name,
        resolveDependencyReference(name, reference, dependencyContext),
      ]),
    );
  }

  return productionManifest;
}

export function resolveDependencyReference(
  name: string,
  reference: unknown,
  {workspaceConfig, workspaceVersions}: PackageDependencyContext,
): unknown {
  if (typeof reference !== 'string') return reference;

  if (reference.startsWith('catalog:')) {
    const catalogName = reference.slice('catalog:'.length) || 'default';
    const catalog =
      catalogName === 'default' ? workspaceConfig.catalog : workspaceConfig.catalogs?.[catalogName];
    const range = catalog?.[name];
    if (!range) throw new Error(`Catalog ${catalogName} does not define ${name}`);
    return range;
  }

  if (!reference.startsWith('workspace:')) return reference;
  const version = workspaceVersions.get(name);
  if (!version) throw new Error(`Workspace package ${name} has no version`);
  const range = reference.slice('workspace:'.length);
  if (range === '*') return version;
  if (range === '^' || range === '~') return `${range}${version}`;
  throw new Error(`Unsupported workspace reference for ${name}: ${reference}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
