import {realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, sep} from 'node:path';
import type {AgentSessionRuntimeDiagnostic, ResourceLoader} from '@earendil-works/pi-coding-agent';
import type {
  AgentHarnessResourceLoaderError,
  AgentHarnessResourceLoaderFailure,
} from '#core/errors.js';

export const PI_HARNESS_EXTENSION_PACKAGE_NAMES = ['pi-web-access', 'pi-mcp-adapter'] as const;
const PI_EXTENSION_DIAGNOSTIC_PATTERN = /^Extension "([^"]+)" error:/;
const require = createRequire(import.meta.url);
const resolvedDirectories = new Map<string, string>();
const availabilityByPackageName = new Map<string, boolean>();

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
  const cached = availabilityByPackageName.get(params.packageName);
  if (cached !== undefined) return cached;

  let available: boolean;
  try {
    piExtensionDirectories({packageNames: [params.packageName]});
    available = true;
  } catch {
    available = false;
  }
  availabilityByPackageName.set(params.packageName, available);
  return available;
}

/** Resolves every Pi extension required by the runner image or throws with the package cause. */
export function assertPiHarnessExtensionsAvailable(): void {
  piExtensionDirectories({packageNames: PI_HARNESS_EXTENSION_PACKAGE_NAMES});
}

/** Verifies that Pi loaded an entry from every requested extension directory. */
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

/**
 * Collects runner-owned extension failures while failing closed on harness-level diagnostics.
 * Pi also loads workspace and user extensions, so only path-attributed failures inside the
 * requested runner directories are classified as harness failures. Diagnostics without an
 * extension path remain runner-owned because startup/configuration errors must still abort the
 * step.
 */
export function piExtensionFailure(params: {
  resourceLoader: Pick<ResourceLoader, 'getExtensions'>;
  diagnostics: readonly AgentSessionRuntimeDiagnostic[];
  directories: readonly string[];
}): PiExtensionFailure {
  const {extensions, errors} = params.resourceLoader.getExtensions();
  const missingDirectories = params.directories.filter(
    (directory) =>
      !extensions.some((extension) =>
        extensionPathIsInDirectory(directory, extension.resolvedPath),
      ),
  );
  const loadFailure = partitionByExtensionPath(errors, params.directories, (error) => error.path);

  const diagnosticFailure = partitionByExtensionPath(
    params.diagnostics,
    params.directories,
    (diagnostic) =>
      diagnostic.type === 'error' ? extensionDiagnosticPath(diagnostic.message) : undefined,
  );

  return {
    missingDirectories,
    errors: loadFailure.runner.flatMap(({item, directory}) =>
      directory === undefined ? [] : [{error: item, directory}],
    ),
    unrelatedErrors: loadFailure.unrelated,
    diagnostics: diagnosticFailure.runner.map(({item}) => item),
    unrelatedDiagnostics: diagnosticFailure.unrelated,
  };
}

export interface PiExtensionFailure {
  readonly missingDirectories: readonly string[];
  readonly errors: readonly AgentHarnessResourceLoaderFailure[];
  readonly unrelatedErrors: readonly AgentHarnessResourceLoaderError[];
  readonly diagnostics: readonly AgentSessionRuntimeDiagnostic[];
  readonly unrelatedDiagnostics: readonly AgentSessionRuntimeDiagnostic[];
}

function partitionByExtensionPath<T>(
  items: readonly T[],
  directories: readonly string[],
  pathForItem: (item: T) => string | undefined,
): {
  runner: readonly {item: T; directory: string | undefined}[];
  unrelated: readonly T[];
} {
  const runner = items.flatMap((item) => {
    const path = pathForItem(item);
    const directory =
      path === undefined
        ? undefined
        : directories.find((candidate) => extensionPathIsInDirectory(candidate, path));
    return path === undefined || directory !== undefined ? [{item, directory}] : [];
  });
  const runnerItems = new Set(runner.map(({item}) => item));
  return {
    runner,
    unrelated: items.filter((item) => !runnerItems.has(item)),
  };
}

function resolvePiExtensionDirectory(packageName: string, resolve: PackageResolver): string {
  try {
    return dirname(resolve(`${packageName}/package.json`));
  } catch (error) {
    const reason =
      error instanceof Error ? (error.message.split('\n', 1)[0] ?? error.message) : String(error);
    throw new Error(`Unable to resolve Pi extension package "${packageName}": ${reason}`);
  }
}

function extensionDiagnosticPath(message: string): string | undefined {
  return PI_EXTENSION_DIAGNOSTIC_PATTERN.exec(message)?.[1];
}

function extensionPathIsInDirectory(directory: string, resolvedPath: string): boolean {
  if (directory === resolvedPath || isPathSegmentPrefix(directory, resolvedPath)) return true;

  const canonicalDirectory = canonicalizePath(directory);
  const canonicalResolvedPath = canonicalizePath(resolvedPath);
  return (
    canonicalDirectory === canonicalResolvedPath ||
    isPathSegmentPrefix(canonicalDirectory, canonicalResolvedPath)
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
