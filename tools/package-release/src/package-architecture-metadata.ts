import {createRequire} from 'node:module';
import {relative} from 'node:path';

import {
  architecturePolicySchemaVersion,
  DEFAULT_ARCHITECTURE_CLASSES,
  type PackageArchitectureMetadata,
  packageArchitectureMetadataFromManifest,
  validatePackageArchitectureMetadata,
} from '@shipfox/architecture-policy';
import {getRepositoryRoot} from './repository-root.js';

type ArchitectureRegistry = Record<string, Record<string, string[]>>;
type PackageManifest = Record<string, unknown>;

const require = createRequire(import.meta.url);
const {architecturePackages} = require('../../../api-contexts.cjs') as {
  architecturePackages: ArchitectureRegistry;
};

export const sourceAvailableRealm = 'source-available';

const repositoryRoot = getRepositoryRoot(import.meta.url);
const registryEntries = new Map<string, PackageArchitectureMetadata>();

for (const [registryClass, contexts] of Object.entries(architecturePackages)) {
  for (const [context, packagePaths] of Object.entries(contexts)) {
    for (const packagePath of packagePaths) {
      const kind = metadataKind(registryClass);
      const metadata: PackageArchitectureMetadata = {
        schema: architecturePolicySchemaVersion,
        realm: sourceAvailableRealm,
        kind,
        context: DEFAULT_ARCHITECTURE_CLASSES[kind]?.requiresBoundedContext ? context : null,
      };
      const existing = registryEntries.get(packagePath);
      if (existing && JSON.stringify(existing) !== JSON.stringify(metadata)) {
        throw new Error(`Conflicting architecture registry entries for ${packagePath}`);
      }
      registryEntries.set(packagePath, metadata);
    }
  }
}

export function architectureMetadataForPackageDirectory(
  directory: string,
  root = repositoryRoot,
): PackageArchitectureMetadata | undefined {
  const packagePath = relative(root, directory).split('/').join('/');
  const metadata = registryEntries.get(packagePath);
  return metadata ? {...metadata} : undefined;
}

export function architectureMetadataForPackagePath(
  packagePath: string,
): PackageArchitectureMetadata | undefined {
  const metadata = registryEntries.get(packagePath.split('/').join('/'));
  return metadata ? {...metadata} : undefined;
}

export function architectureMetadataDescription(metadata: PackageArchitectureMetadata): string {
  return `${metadata.kind}${metadata.context === null ? '' : ` (${metadata.context})`}`;
}

export function packageArchitectureMetadataErrors(
  manifest: PackageManifest,
  expected: PackageArchitectureMetadata | undefined,
  source = 'Packed',
): string[] {
  const packageName = typeof manifest.name === 'string' ? manifest.name : '<unknown package>';
  const actual = packageArchitectureMetadataFromManifest(manifest);

  if (!expected) {
    if (actual === undefined) return [];
    const errors = validatePackageArchitectureMetadata(actual);
    return errors.map(
      (error) => `${source} ${packageName} has invalid architecture metadata: ${error}`,
    );
  }

  const expectedDescription = architectureMetadataDescription(expected);
  if (actual === undefined) {
    return [
      `${source} ${packageName} is missing architecture metadata; expected ${expectedDescription}`,
    ];
  }

  const errors = validatePackageArchitectureMetadata(actual);
  if (errors.length > 0) {
    return [
      `${source} ${packageName} has invalid architecture metadata; expected ${expectedDescription}: ${errors.join('; ')}`,
    ];
  }

  const actualMetadata = actual as PackageArchitectureMetadata;
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => actualMetadata[key as keyof PackageArchitectureMetadata] !== value)
    .map(
      ([key, value]) =>
        `${key}=${String(actualMetadata[key as keyof PackageArchitectureMetadata])} (expected ${String(value)})`,
    );
  if (mismatches.length > 0) {
    return [
      `${source} ${packageName} has stale or conflicting architecture metadata; expected ${expectedDescription}: ${mismatches.join(', ')}`,
    ];
  }

  return [];
}

export function assertPackageArchitectureMetadataMatches(
  manifest: PackageManifest,
  expected: PackageArchitectureMetadata | undefined,
  source = 'Packed',
): void {
  const errors = packageArchitectureMetadataErrors(manifest, expected, source);
  if (errors.length > 0) throw new Error(errors.join('\n'));
}

function metadataKind(registryClass: string): string {
  return registryClass === 'implementations' ? 'implementation' : registryClass;
}
