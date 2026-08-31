import {readFileSync, realpathSync, statSync} from 'node:fs';
import {dirname, extname, isAbsolute, join, relative, resolve as resolvePath, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {type Package, imports as resolvePackageImports} from 'resolve.exports';
import type {Plugin} from 'vite';

const workspaceSourceCondition = 'workspace-source';
const packageImportPrefix = '#';
const packagePostfixPattern = /[?#]/;

type PackageManifest = Package & {
  name: string;
};

type PackageInfo = {
  directory: string;
  manifest: PackageManifest;
};

function stripPostfix(value: string): string {
  const postfixStart = value.search(packagePostfixPattern);
  return postfixStart === -1 ? value : value.slice(0, postfixStart);
}

function splitPackageImport(id: string): {specifier: string; postfix: string} {
  const postfixStart = id.slice(1).search(packagePostfixPattern);
  if (postfixStart === -1) return {specifier: id, postfix: ''};

  const absolutePostfixStart = postfixStart + 1;
  return {
    specifier: id.slice(0, absolutePostfixStart),
    postfix: id.slice(absolutePostfixStart),
  };
}

function toImporterPath(importer: string): string {
  const cleanImporter = stripPostfix(importer);
  if (cleanImporter.startsWith('file://')) return fileURLToPath(cleanImporter);
  if (cleanImporter.startsWith('/@fs/')) return cleanImporter.slice('/@fs'.length);
  return cleanImporter;
}

function removeDefaultBranches(value: unknown, preserveDefaults = false): unknown {
  if (Array.isArray(value)) {
    return value.map((nestedValue) => removeDefaultBranches(nestedValue, preserveDefaults));
  }
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      key === 'default' && !preserveDefaults
        ? null
        : removeDefaultBranches(nestedValue, preserveDefaults || key === workspaceSourceCondition),
    ]),
  );
}

function readPackageInfo(
  packageJsonPath: string,
  packageCache: Map<string, PackageInfo | null>,
): PackageInfo | null {
  const cached = packageCache.get(packageJsonPath);
  if (cached !== undefined) return cached;

  let packageInfo: PackageInfo | null = null;
  try {
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageManifest;
    if (typeof manifest.name === 'string') {
      packageInfo = {
        directory: dirname(packageJsonPath),
        manifest,
      };
    }
  } catch {
    packageInfo = null;
  }

  packageCache.set(packageJsonPath, packageInfo);
  return packageInfo;
}

function findOwningPackage(
  importer: string,
  packageCache: Map<string, PackageInfo | null>,
  ownershipCache: Map<string, PackageInfo | null>,
): PackageInfo | null {
  const importerPath = toImporterPath(importer);
  const cached = ownershipCache.get(importerPath);
  if (cached !== undefined) return cached;
  if (!isAbsolute(importerPath)) {
    ownershipCache.set(importerPath, null);
    return null;
  }

  let directory = dirname(importerPath);
  while (true) {
    const packageInfo = readPackageInfo(join(directory, 'package.json'), packageCache);
    if (packageInfo) {
      ownershipCache.set(importerPath, packageInfo);
      return packageInfo;
    }

    const parentDirectory = dirname(directory);
    if (parentDirectory === directory) break;
    directory = parentDirectory;
  }

  ownershipCache.set(importerPath, null);
  return null;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function sourceCandidates(path: string): string[] {
  const extension = extname(path);
  if (extension === '.js') return [path, `${path.slice(0, -3)}.ts`, `${path.slice(0, -3)}.tsx`];
  if (extension === '.mjs') return [path, `${path.slice(0, -4)}.mts`];
  if (extension === '.cjs') return [path, `${path.slice(0, -4)}.cts`];
  return [path];
}

function isLexicallyWithinDirectory(directory: string, path: string): boolean {
  const relativePath = relative(directory, path);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function isWithinDirectory(directory: string, path: string): boolean {
  let directoryPath: string;
  let candidatePath: string;
  try {
    directoryPath = realpathSync(directory);
    candidatePath = realpathSync(path);
  } catch {
    return false;
  }

  const relativePath = relative(directoryPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function isDistTarget(packageDirectory: string, target: string): boolean {
  const relativeTarget = relative(packageDirectory, target);
  return relativeTarget === 'dist' || relativeTarget.startsWith(`dist${sep}`);
}

function resolveSourceTarget(
  packageInfo: PackageInfo,
  specifier: string,
  conditions: readonly string[],
): string | undefined {
  const imports = packageInfo.manifest.imports;
  if (!imports) return undefined;

  const sourceManifest = {
    ...packageInfo.manifest,
    imports: removeDefaultBranches(imports) as Package['imports'],
  };

  let mappedTargets: string[] | undefined;
  try {
    const resolvedTargets = resolvePackageImports(sourceManifest, specifier, {
      conditions,
      unsafe: true,
    });
    if (resolvedTargets) mappedTargets = resolvedTargets;
  } catch {
    return undefined;
  }

  for (const mappedTarget of mappedTargets ?? []) {
    const target = resolveMappedSourceTarget(packageInfo.directory, mappedTarget);
    if (target) return target;
  }

  return undefined;
}

function resolveMappedSourceTarget(
  packageDirectory: string,
  mappedTarget: string,
): string | undefined {
  if (!mappedTarget.startsWith('./')) return undefined;
  const absoluteTarget = resolvePath(packageDirectory, mappedTarget);
  if (!isLexicallyWithinDirectory(packageDirectory, absoluteTarget)) return undefined;
  if (isDistTarget(packageDirectory, absoluteTarget)) return undefined;
  for (const candidate of sourceCandidates(absoluteTarget)) {
    if (!isFile(candidate)) continue;
    if (!isWithinDirectory(packageDirectory, candidate)) continue;
    return absoluteTarget;
  }
  return undefined;
}

/**
 * Composes package-import maps with Vite's filesystem resolver for workspace source.
 * The plugin is intentionally inert unless the active environment opted into the
 * repository's `workspace-source` condition.
 */
export function workspaceSourceResolver(): Plugin {
  const packageCache = new Map<string, PackageInfo | null>();
  const ownershipCache = new Map<string, PackageInfo | null>();

  return {
    name: 'shipfox:workspace-source-resolver',
    enforce: 'pre',
    resolveId(id, importer, options) {
      if (!importer || !id.startsWith(packageImportPrefix)) return;

      const conditions = options.ssr
        ? (this.environment.config.ssr?.resolve?.conditions ?? [])
        : (this.environment.config.resolve?.conditions ?? []);
      if (!conditions.includes(workspaceSourceCondition)) return;

      const effectiveConditions = conditions.map((condition) => {
        if (condition !== 'development|production') return condition;
        return this.environment.config.isProduction ? 'production' : 'development';
      });
      effectiveConditions.push(options.kind === 'require-call' ? 'require' : 'import');

      const packageInfo = findOwningPackage(importer, packageCache, ownershipCache);
      if (!packageInfo) return;

      const {specifier, postfix} = splitPackageImport(id);
      const mappedTarget = resolveSourceTarget(packageInfo, specifier, effectiveConditions);
      if (!mappedTarget) return;

      return this.resolve(`${mappedTarget}${postfix}`, importer, {skipSelf: true});
    },
  };
}
