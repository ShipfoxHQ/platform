import {globSync, readFileSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import Ajv2020, {type ValidateFunction} from 'ajv/dist/2020.js';
import {parse as parseYaml, stringify as stringifyYaml} from 'yaml';

const WORKSPACE_MANIFEST_GLOB = '{apps,e2e,infra,libs,tools,turbo}/**/package.json';
const RUNTIME_DEPENDENCY_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/;
const RUNTIME_MODULE_PATTERN = /\.(?:[cm]?js|node)$/u;
const TYPE_DECLARATION_PATTERN = /\.d\.[cm]?ts$/u;
const REPOSITORY_URL = 'git+https://github.com/ShipfoxHQ/shipfox.git';

export interface PublicationClosureConfig {
  $schema?: string;
  roots: string[];
  packages: string[];
}

export interface PackageManifest {
  name: string;
  version: string;
  private?: boolean;
  license?: string;
  repository?:
    | string
    | {
        type?: string;
        url?: string;
        directory?: string;
      };
  imports?: Record<string, unknown>;
  exports?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface WorkspacePackage {
  directory: string;
  manifest: PackageManifest;
  manifestPath: string;
}

export interface ApplicationReleasePackage {
  name: string;
  version: string;
}

export interface PublicPackageEntryPoint {
  specifier: string;
  target: unknown;
}

const validateConfig = createConfigValidator();

export function readPublicationClosureConfig(path: string): PublicationClosureConfig {
  const config: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!validateConfig(config)) {
    throw new Error(`Invalid publication closure config: ${formatErrors(validateConfig)}`);
  }
  return config;
}

export function readWorkspacePackages(repositoryRoot: string): Map<string, WorkspacePackage> {
  const manifestPaths = globSync(join(repositoryRoot, WORKSPACE_MANIFEST_GLOB), {
    exclude: ['**/node_modules/**'],
  });
  const packages = new Map<string, WorkspacePackage>();

  for (const manifestPath of manifestPaths) {
    const manifest: PackageManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!manifest.name) continue;
    if (packages.has(manifest.name)) {
      throw new Error(`Duplicate workspace package name: ${manifest.name}`);
    }
    packages.set(manifest.name, {
      directory: dirname(manifestPath),
      manifest,
      manifestPath,
    });
  }

  return packages;
}

export function computePublicationClosure(
  packages: ReadonlyMap<string, WorkspacePackage>,
  roots: readonly string[],
): string[] {
  const closure = new Set<string>();

  const visit = (name: string): void => {
    if (closure.has(name)) return;
    const workspacePackage = packages.get(name);
    if (!workspacePackage) throw new Error(`Publication root is not a workspace package: ${name}`);

    closure.add(name);
    for (const dependency of runtimeDependencies(workspacePackage.manifest)) {
      if (packages.has(dependency)) visit(dependency);
    }
  };

  for (const root of roots) visit(root);
  return [...closure].sort();
}

export function validatePublicationState(
  packages: ReadonlyMap<string, WorkspacePackage>,
  config: PublicationClosureConfig,
  repositoryRoot: string,
): string[] {
  const closure = computePublicationClosure(packages, config.roots);
  assertSamePackageNames(closure, config.packages, 'computed publication closure');

  for (const root of config.roots) {
    if (!closure.includes(root))
      throw new Error(`Publication root is absent from closure: ${root}`);
  }

  for (const name of closure) {
    const workspacePackage = requiredPackage(packages, name);
    validatePublishedPackage(workspacePackage, repositoryRoot);
  }

  for (const [name, workspacePackage] of packages) {
    if (workspacePackage.manifest.private === true) continue;
    for (const dependency of runtimeDependencies(workspacePackage.manifest)) {
      const workspaceDependency = packages.get(dependency);
      if (workspaceDependency?.manifest.private === true) {
        throw new Error(`Public package ${name} has private runtime dependency ${dependency}`);
      }
    }
  }

  return closure;
}

export function createApplicationReleasePackages(
  packages: ReadonlyMap<string, WorkspacePackage>,
  config: PublicationClosureConfig,
  repositoryRoot: string,
): ApplicationReleasePackage[] {
  const closure = validatePublicationState(packages, config, repositoryRoot);
  const releasePackages = closure.map((name) => {
    const manifest = requiredPackage(packages, name).manifest;
    return {name, version: manifest.version};
  });
  assertApplicationReleasePackages(releasePackages, closure);
  return releasePackages;
}

export function assertApplicationReleasePackages(
  releasePackages: readonly ApplicationReleasePackage[],
  expectedNames: readonly string[],
): void {
  const names = releasePackages.map(({name}) => name);
  assertSamePackageNames(names, expectedNames, 'application-release package set');

  for (const {name, version} of releasePackages) {
    if (!SEMVER_PATTERN.test(version)) {
      throw new Error(`Application-release package ${name} has invalid version ${version}`);
    }
  }
}

export function listPublicPackageEntryPoints(
  name: string,
  exportsField: unknown,
): PublicPackageEntryPoint[] {
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    return [{specifier: name, target: exportsField}];
  }

  const exportsRecord = exportsField as Record<string, unknown>;
  const subpaths = Object.keys(exportsRecord).filter((key) => key.startsWith('.'));
  if (!subpaths.length) return [{specifier: name, target: exportsField}];
  return subpaths.map((subpath) => ({
    specifier: subpath === '.' ? name : `${name}/${subpath.slice(2)}`,
    target: exportsRecord[subpath],
  }));
}

export function entryPointSupportsRuntimeImport(target: unknown): boolean {
  return exportTargetPaths(target, new Set(['workspace-source', 'types'])).some((path) =>
    RUNTIME_MODULE_PATTERN.test(path),
  );
}

export function entryPointSupportsTypeResolution(target: unknown): boolean {
  const declarationTarget = exportTargetPaths(target, new Set(['workspace-source'])).some((path) =>
    TYPE_DECLARATION_PATTERN.test(path),
  );
  return declarationTarget || entryPointSupportsRuntimeImport(target);
}

function validatePublishedPackage(
  workspacePackage: WorkspacePackage,
  repositoryRoot: string,
): void {
  const {manifest} = workspacePackage;
  const packageLabel = `${manifest.name} (${relative(repositoryRoot, workspacePackage.manifestPath)})`;

  if (manifest.private === true)
    throw new Error(`Publication closure package is private: ${packageLabel}`);
  if (manifest.license !== 'MIT')
    throw new Error(`Publication closure package is not MIT: ${packageLabel}`);
  if (!SEMVER_PATTERN.test(manifest.version)) {
    throw new Error(`Publication closure package has invalid version: ${packageLabel}`);
  }
  if (
    typeof manifest.repository !== 'object' ||
    manifest.repository?.url !== REPOSITORY_URL ||
    !manifest.repository.directory
  ) {
    throw new Error(
      `Publication closure package has incomplete repository metadata: ${packageLabel}`,
    );
  }
  if (manifest.exports === undefined) {
    throw new Error(`Publication closure package has no intentional exports: ${packageLabel}`);
  }
  const internalImports = manifest.imports?.['#*'];
  if (
    internalImports !== undefined &&
    (typeof internalImports !== 'object' ||
      internalImports === null ||
      (internalImports as Record<string, unknown>)['workspace-source'] !== './src/*' ||
      (internalImports as Record<string, unknown>).default !== './dist/*')
  ) {
    throw new Error(
      `Publication closure package does not map internal imports to dist: ${packageLabel}`,
    );
  }
  const sourceConditions = new Set(['development', 'workspace-source']);
  const packedTargets = [
    ...exportTargetPaths(manifest.imports, new Set([...sourceConditions, 'types'])),
    ...exportTargetPaths(manifest.exports, sourceConditions),
  ];
  if (packedTargets.some((target) => target.includes('./src/'))) {
    throw new Error(
      `Publication closure package resolves to src after productionization: ${packageLabel}`,
    );
  }
  for (const script of ['build', 'type', 'type:emit']) {
    if (!manifest.scripts?.[script]) {
      throw new Error(
        `Publication closure package does not emit runtime and types: ${packageLabel}`,
      );
    }
  }
}

function assertSamePackageNames(
  actualNames: readonly string[],
  expectedNames: readonly string[],
  label: string,
): void {
  const actual = [...actualNames].sort();
  const expected = [...expectedNames].sort();
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((name) => !actualSet.has(name));
  const unexpected = actual.filter((name) => !expectedSet.has(name));

  if (missing.length || unexpected.length || actual.length !== expected.length) {
    throw new Error(
      `${label} differs from the declared package set` +
        `${missing.length ? `; missing: ${missing.join(', ')}` : ''}` +
        `${unexpected.length ? `; unexpected: ${unexpected.join(', ')}` : ''}`,
    );
  }
}

function runtimeDependencies(manifest: PackageManifest): string[] {
  const dependencies = new Set<string>();
  for (const field of RUNTIME_DEPENDENCY_FIELDS) {
    for (const dependency of Object.keys(manifest[field] ?? {})) dependencies.add(dependency);
  }
  return [...dependencies];
}

function exportTargetPaths(target: unknown, excludedConditions: ReadonlySet<string>): string[] {
  if (typeof target === 'string') return [target];
  if (Array.isArray(target)) {
    return target.flatMap((value) => exportTargetPaths(value, excludedConditions));
  }
  if (!target || typeof target !== 'object') return [];

  return Object.entries(target).flatMap(([condition, value]) =>
    excludedConditions.has(condition) ? [] : exportTargetPaths(value, excludedConditions),
  );
}

function requiredPackage(
  packages: ReadonlyMap<string, WorkspacePackage>,
  name: string,
): WorkspacePackage {
  const workspacePackage = packages.get(name);
  if (!workspacePackage) throw new Error(`Unknown workspace package: ${name}`);
  return workspacePackage;
}

function createConfigValidator(): ValidateFunction<PublicationClosureConfig> {
  const schemaPath = new URL('../schema/publication-closure.schema.json', import.meta.url);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const validator = new Ajv2020({allErrors: true, strict: true});
  return validator.compile<PublicationClosureConfig>(schema);
}

function formatErrors(validator: ValidateFunction): string {
  return (
    validator.errors
      ?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
      .join('; ') ?? 'unknown schema error'
  );
}

export interface FixtureWorkspaceConfigOptions {
  repositoryRoot: string;
  overrides: Record<string, string>;
}

interface ReleaseAgePolicy {
  minimumReleaseAge?: number;
  minimumReleaseAgeExclude?: string[];
}

/**
 * Renders the `pnpm-workspace.yaml` of a packed-consumer fixture. Fixtures resolve
 * third-party dependencies fresh, so they carry the repository's release-age policy;
 * otherwise a release published minutes earlier can break a fixture that the pinned
 * workspace itself never installs.
 */
export function renderFixtureWorkspaceConfig(options: FixtureWorkspaceConfigOptions): string {
  const workspaceConfig: unknown = parseYaml(
    readFileSync(join(options.repositoryRoot, 'pnpm-workspace.yaml'), 'utf8'),
  );
  return stringifyYaml({
    packages: ['.'],
    overrides: options.overrides,
    ...releaseAgePolicy(workspaceConfig),
  });
}

function releaseAgePolicy(workspaceConfig: unknown): ReleaseAgePolicy {
  if (typeof workspaceConfig !== 'object' || workspaceConfig === null) return {};
  const config = workspaceConfig as Record<string, unknown>;
  const policy: ReleaseAgePolicy = {};
  if (typeof config.minimumReleaseAge === 'number') {
    policy.minimumReleaseAge = config.minimumReleaseAge;
  }
  const exclude = config.minimumReleaseAgeExclude;
  if (
    Array.isArray(exclude) &&
    exclude.every((entry): entry is string => typeof entry === 'string')
  ) {
    policy.minimumReleaseAgeExclude = exclude;
  }
  return policy;
}
