import {readFileSync, realpathSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve as resolvePath, sep} from 'node:path';
import type {ResourceLoader} from '@earendil-works/pi-coding-agent';

export const PI_HARNESS_EXTENSION_PACKAGE_NAMES = ['pi-web-access', 'pi-mcp-adapter'] as const;
const require = createRequire(import.meta.url);
const resolvedDirectories = new Map<string, string>();
const availabilityByPackageName = new Map<string, boolean>();

type PackageResolver = (specifier: string) => string;

/**
 * Resolves a Pi extension package directory without asking Pi to resolve package names from a
 * job workspace. The resolver override is intentionally uncached so tests cannot affect the
 * process-wide package resolution cache.
 */
export function piExtensionDirectory(params: {
  packageName: string;
  resolve?: PackageResolver | undefined;
}): string {
  const {packageName, resolve} = params;
  if (resolve !== undefined) return resolvePiExtensionDirectory({packageName, resolve});

  const cached = resolvedDirectories.get(packageName);
  if (cached !== undefined) return cached;

  const directory = resolvePiExtensionDirectory({packageName, resolve: require.resolve});
  resolvedDirectories.set(packageName, directory);
  return directory;
}

/** Resolves each requested Pi extension package directory, preserving the requested order. */
export function piExtensionDirectories(params: {
  packageNames: readonly string[];
  resolve?: PackageResolver;
}): string[] {
  return params.packageNames.map((packageName) =>
    piExtensionDirectory({packageName, resolve: params.resolve}),
  );
}

/**
 * Returns whether a Pi extension package can be resolved from the runner installation. Callers
 * like the heartbeat loop invoke this on every tick, so both outcomes are cached: package
 * resolvability is fixed for the process lifetime (a package install doesn't change at runtime).
 */
export function isPiExtensionAvailable(params: {packageName: string}): boolean {
  const cached = availabilityByPackageName.get(params.packageName);
  if (cached !== undefined) return cached;

  let available: boolean;
  try {
    piExtensionDirectory({packageName: params.packageName});
    available = true;
  } catch {
    available = false;
  }
  availabilityByPackageName.set(params.packageName, available);
  return available;
}

/**
 * Resolves every Pi extension required by the runner image and verifies each declared entry file
 * exists, or throws with the package cause. The runner image build runs this against the deployed
 * production closure, where a packaging regression is observable and the development tree is not.
 */
export function assertPiHarnessExtensionsAvailable(params: {resolve?: PackageResolver} = {}): void {
  for (const packageName of PI_HARNESS_EXTENSION_PACKAGE_NAMES) {
    const directory = piExtensionDirectory({packageName, resolve: params.resolve});

    assertPiExtensionEntriesAvailable({packageName, directory});
  }
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

function resolvePiExtensionDirectory(params: {
  packageName: string;
  resolve: PackageResolver;
}): string {
  const {packageName, resolve} = params;
  try {
    return dirname(resolve(`${packageName}/package.json`));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to resolve Pi extension package "${packageName}": ${reason}`);
  }
}

function assertPiExtensionEntriesAvailable(params: {packageName: string; directory: string}): void {
  const {packageName, directory} = params;
  const packageJsonPath = resolvePath(directory, 'package.json');
  let packageJson: {pi?: {extensions?: string[]}};

  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      pi?: {extensions?: string[]};
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to inspect Pi extension package "${packageName}": ${reason}`);
  }

  const entries = packageJson.pi?.extensions;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`Pi extension package "${packageName}" has no pi.extensions entries.`);
  }

  for (const entry of entries) {
    try {
      statSync(resolvePath(directory, entry));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Pi extension package "${packageName}" is missing entry "${entry}": ${reason}`,
      );
    }
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
