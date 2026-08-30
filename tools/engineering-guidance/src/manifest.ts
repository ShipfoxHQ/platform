export const guidancePackageName = '@shipfox/engineering-guidance';
export const guidanceRepository = 'ShipfoxHQ/shipfox';
export const guidanceManifestSchemaVersion = 1 as const;

const commitPattern = /^[a-f0-9]{40}$/u;
const entrypointNamePattern = /^[a-z][A-Za-z0-9]*$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export interface GuidanceManifestFile {
  path: string;
  sha256: string;
  kind: string;
}

export interface GuidanceManifest {
  schemaVersion: typeof guidanceManifestSchemaVersion;
  package: {
    name: typeof guidancePackageName;
    version: string;
  };
  source: {
    repository: typeof guidanceRepository;
    commit: string;
  };
  entrypoints: Record<string, string>;
  files: GuidanceManifestFile[];
}

export function assertGuidanceManifest(value: unknown): asserts value is GuidanceManifest {
  if (!isRecord(value)) throw new Error('Guidance manifest must be an object');
  if (value.schemaVersion !== guidanceManifestSchemaVersion) {
    throw new Error(`Unsupported guidance manifest schema: ${String(value.schemaVersion)}`);
  }

  assertManifestPackage(value.package);
  assertManifestSource(value.source);
  const paths = assertManifestFiles(value.files);
  assertManifestEntrypoints(value.entrypoints, paths);
}

function assertManifestPackage(packageValue: unknown): void {
  if (!isRecord(packageValue) || packageValue.name !== guidancePackageName) {
    throw new Error(`Guidance manifest package name must be ${guidancePackageName}`);
  }
  if (!isNonEmptyString(packageValue.version)) {
    throw new Error('Guidance manifest package version must be a non-empty string');
  }
}

function assertManifestSource(sourceValue: unknown): void {
  if (!isRecord(sourceValue) || sourceValue.repository !== guidanceRepository) {
    throw new Error(`Guidance manifest source repository must be ${guidanceRepository}`);
  }
  if (!isCommit(sourceValue.commit)) {
    throw new Error('Guidance manifest source commit must be a full 40-character SHA-1');
  }
}

function assertManifestEntrypoints(entrypoints: unknown, paths: ReadonlySet<string>): void {
  if (!isRecord(entrypoints) || typeof entrypoints.documentationMap !== 'string') {
    throw new Error('Guidance manifest must define entrypoints.documentationMap');
  }
  for (const [name, entrypoint] of Object.entries(entrypoints)) {
    if (!entrypointNamePattern.test(name)) {
      throw new Error(`Invalid guidance manifest entrypoint name: ${name}`);
    }
    assertManifestPath(entrypoint, `entrypoints.${name}`);
    if (!paths.has(entrypoint)) {
      throw new Error(`Guidance manifest entrypoint ${name} is not listed in files`);
    }
  }
}

function assertManifestFiles(files: unknown): Set<string> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Guidance manifest must list at least one file');
  }
  let previousPath = '';
  const paths = new Set<string>();
  for (const [index, file] of files.entries()) {
    if (!isRecord(file)) throw new Error(`Manifest file ${index} must be an object`);
    if (!isNonEmptyString(file.path)) throw new Error(`Manifest file ${index} has no path`);
    assertManifestPath(file.path, `files.${index}.path`);
    if (file.path <= previousPath) {
      throw new Error('Guidance manifest files must be sorted by path');
    }
    previousPath = file.path;
    if (paths.has(file.path)) throw new Error(`Duplicate guidance manifest path: ${file.path}`);
    paths.add(file.path);
    if (!sha256Pattern.test(String(file.sha256))) {
      throw new Error(`Invalid SHA-256 for guidance manifest file: ${file.path}`);
    }
    if (!isNonEmptyString(file.kind)) {
      throw new Error(`Missing kind for guidance manifest file: ${file.path}`);
    }
  }
  return paths;
}

export function isGuidanceManifest(value: unknown): value is GuidanceManifest {
  try {
    assertGuidanceManifest(value);
    return true;
  } catch {
    return false;
  }
}

function assertManifestPath(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('repository/') ||
    value.includes('\\') ||
    value.includes('//') ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
}

function isCommit(value: unknown): value is string {
  return typeof value === 'string' && commitPattern.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
