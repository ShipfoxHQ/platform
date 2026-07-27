import {realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, sep} from 'node:path';
import type {ResourceLoader} from '@earendil-works/pi-coding-agent';

const PI_HARNESS_EXTENSION_PACKAGE_NAMES = ['pi-web-access', 'pi-mcp-adapter'] as const;
const require = createRequire(import.meta.url);
const resolvedDirectories = new Map<string, string>();

type PackageResolver = (specifier: string) => string;

/**
 * Resolves Pi extension package directories without asking Pi to resolve package names from a
 * job workspace. The resolver override is intentionally uncached so tests cannot affect the
 * process-wide package resolution cache.
 */
export function piExtensionDirectories(params: {
  packageNames: readonly string[];
  resolve?: PackageResolver;
}): string[] {
  const injectedResolver = params.resolve;
  if (injectedResolver !== undefined) {
    return params.packageNames.map((packageName) =>
      resolvePiExtensionDirectory(packageName, injectedResolver),
    );
  }

  return params.packageNames.map((packageName) => {
    const cached = resolvedDirectories.get(packageName);
    if (cached !== undefined) return cached;

    const directory = resolvePiExtensionDirectory(packageName, require.resolve);
    resolvedDirectories.set(packageName, directory);
    return directory;
  });
}

/** Returns whether a Pi extension package can be resolved from the runner installation. */
export function isPiExtensionAvailable(params: {packageName: string}): boolean {
  try {
    piExtensionDirectories({packageNames: [params.packageName]});
    return true;
  } catch {
    return false;
  }
}

/** Resolves every Pi extension required by the runner image or throws with the package cause. */
export function assertPiHarnessExtensionsAvailable(): void {
  piExtensionDirectories({packageNames: PI_HARNESS_EXTENSION_PACKAGE_NAMES});
}

/**
 * Verifies that Pi loaded an entry from every requested extension directory. Pi reports entry
 * files rather than package directories, and package-manager symlinks make canonical paths the
 * reliable comparison while the raw fallback keeps diagnostics useful for missing paths.
 */
export function assertPiExtensionsLoaded(params: {
  resourceLoader: Pick<ResourceLoader, 'getExtensions'>;
  directories: readonly string[];
}): void {
  const {extensions, errors} = params.resourceLoader.getExtensions();
  const missingDirectories = params.directories.filter(
    (directory) =>
      !extensions.some((extension) =>
        extensionPathIsInDirectory(directory, extension.resolvedPath),
      ),
  );
  if (missingDirectories.length === 0) return;

  const piErrors = errors.length === 0 ? '' : ` Pi errors: ${JSON.stringify(errors)}`;
  throw new Error(
    `Pi extensions failed to load from: ${missingDirectories.join(', ')}.${piErrors}`,
  );
}

function resolvePiExtensionDirectory(packageName: string, resolve: PackageResolver): string {
  try {
    return dirname(resolve(`${packageName}/package.json`));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to resolve Pi extension package "${packageName}": ${reason}`);
  }
}

function extensionPathIsInDirectory(directory: string, resolvedPath: string): boolean {
  return (
    isPathSegmentPrefix(directory, resolvedPath) ||
    isPathSegmentPrefix(canonicalizePath(directory), canonicalizePath(resolvedPath))
  );
}

function isPathSegmentPrefix(directory: string, path: string): boolean {
  const prefix = directory.endsWith(sep) ? directory : `${directory}${sep}`;
  return path.startsWith(prefix);
}

function canonicalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
