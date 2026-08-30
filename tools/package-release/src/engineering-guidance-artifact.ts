import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {basename, dirname, extname, join, posix, relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

import {
  checkRepositoryDocumentation,
  extractMarkdownLinks,
  guidanceFileKind,
  isGuidanceRootEntrypoint,
} from '@shipfox/repository-documentation-policy/documentation';

import {run} from './productionized-manifest-packer.js';

export const engineeringGuidancePackageName = '@shipfox/engineering-guidance';

const engineeringGuidanceRepository = 'ShipfoxHQ/shipfox';
const engineeringGuidancePackageDirectory = 'tools/engineering-guidance';
const fullCommitPattern = /^[a-f0-9]{40}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const markdownExtension = '.md';
const excludedPathPrefixes = [
  'apps/docs/content/',
  'apps/docs/WRITING.md',
  'libs/client/shell/test/external/',
] as const;
const excludedPathSegments = new Set(['.cache', '.changeset', '.context', '.git', '.turbo']);
const excludedFixtureSegments = new Set(['fixture', 'fixtures', 'test', 'tests', '__tests__']);
const externalLinkPattern = /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu;
const sourceLinkPathPattern = /^\/(?:ShipfoxHQ\/shipfox)\/(blob|tree)\//u;
const sourceLinkPattern =
  /^https:\/\/github\.com\/ShipfoxHQ\/shipfox\/(blob|tree)\/([^/]+)\/(.+)$/u;
const cloudLinkPattern = /https:\/\/github\.com\/ShipfoxHQ\/cloud(?:\/|$)/iu;
const absolutePathPattern = /^(?:\/[A-Za-z0-9_.-]|[A-Za-z]:[\\/])/u;
const localManifestReferencePattern = /^(?:file:|link:|workspace:)/u;
const whitespaceCharacterPattern = /\s/u;
const nonWhitespacePattern = /^\S+/u;
const privateGuidancePathPattern = /(?:^|\/)(?:cloud|private|\.context)(?:\/|$)/iu;
const atxHeadingPattern = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u;
const setextHeadingPattern = /^ {0,3}(?:=+|-+)\s*$/u;
const fencePattern = /^\s{0,3}(`{3,}|~{3,})/u;
const referenceLinkPattern = /^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]+>|[^\s]+)[^\n]*$/u;

const packageMetadataFiles = new Set([
  'LICENSE',
  'README.md',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/manifest.d.ts',
  'dist/manifest.js',
  'dist/bundle/MANIFEST.json',
  'package.json',
  'schema/manifest.schema.json',
]);

interface JsonRecord {
  [key: string]: unknown;
}

interface GuidanceManifestFile {
  kind: string;
  path: string;
  sha256: string;
}

export interface GuidanceManifest {
  entrypoints: Record<string, string>;
  files: GuidanceManifestFile[];
  package: {
    name: typeof engineeringGuidancePackageName;
    version: string;
  };
  schemaVersion: 1;
  source: {
    commit: string;
    repository: typeof engineeringGuidanceRepository;
  };
}

export interface GuidanceSelectionDiff {
  added: string[];
  moved: Array<{from: string; kind: string; to: string}>;
  reclassified: Array<{actual: string; expected: string; path: string}>;
  removed: string[];
}

export interface GuidanceArtifactValidationResult {
  manifest: GuidanceManifest;
  selectionDiff: GuidanceSelectionDiff;
}

interface MarkdownLink {
  line: number;
  target: string;
}

interface ParsedTarget {
  anchor: string | null;
  path: string;
}

interface GuidanceApi {
  getGuidanceBundleRoot?: () => unknown;
  getGuidanceManifestPath?: () => unknown;
  readGuidanceManifest?: () => unknown;
}

/**
 * Pack and install the guidance tarball in a repository-independent fixture.
 * The fixture is deliberately outside the workspace so Node resolution cannot
 * fall back to the source package.
 */
export async function validateExternalEngineeringGuidanceArtifact(
  tarballPath: string,
  repositoryRoot: string,
): Promise<GuidanceArtifactValidationResult> {
  await assertOutsideApplicationPublicationClosure(repositoryRoot);
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'shipfox-engineering-guidance-consumer-'));
  try {
    await writeConsumerManifest(fixtureRoot, tarballPath);
    await run('pnpm', ['install', '--offline', '--ignore-scripts'], fixtureRoot);

    const installedPackagePath = await realpath(
      join(fixtureRoot, 'node_modules', engineeringGuidancePackageName),
    );
    const sourcePackagePath = await realpath(
      join(repositoryRoot, engineeringGuidancePackageDirectory),
    );
    if (isWithin(sourcePackagePath, installedPackagePath)) {
      throw new Error(
        `Packed ${engineeringGuidancePackageName} resolved to the workspace source package`,
      );
    }

    return await validateInstalledEngineeringGuidance(
      installedPackagePath,
      repositoryRoot,
      fixtureRoot,
    );
  } finally {
    await rm(fixtureRoot, {force: true, recursive: true});
  }
}

export async function assertOutsideApplicationPublicationClosure(
  repositoryRoot: string,
): Promise<void> {
  const closurePath = join(repositoryRoot, 'publication-closure.json');
  const closure = parseJsonRecord(await readFile(closurePath));
  for (const field of ['roots', 'packages']) {
    const values = closure[field];
    if (Array.isArray(values) && values.includes(engineeringGuidancePackageName)) {
      throw new Error(
        `${engineeringGuidancePackageName} is a development-only tool and must not enter publication-closure.json.${field}`,
      );
    }
  }
}

export async function validateInstalledEngineeringGuidance(
  packageRoot: string,
  repositoryRoot: string,
  consumerRoot?: string,
): Promise<GuidanceArtifactValidationResult> {
  const packageManifest = parseJsonRecord(await readFile(join(packageRoot, 'package.json')));
  validatePackageManifest(packageManifest);

  const api = await importGuidanceApi(packageRoot, consumerRoot);
  const bundleRoot = await realpath(requiredString(api.getGuidanceBundleRoot?.(), 'bundle root'));
  const manifestPath = await realpath(
    requiredString(api.getGuidanceManifestPath?.(), 'manifest path'),
  );
  const expectedBundleRoot = resolve(packageRoot, 'dist/bundle');
  if (bundleRoot !== expectedBundleRoot) {
    throw new Error(
      `Guidance locator returned ${relative(packageRoot, bundleRoot) || '.'}; expected dist/bundle`,
    );
  }
  if (manifestPath !== join(bundleRoot, 'MANIFEST.json')) {
    throw new Error(
      `Guidance locator returned ${relative(packageRoot, manifestPath)}; expected dist/bundle/MANIFEST.json`,
    );
  }

  const manifestBytes = await readFile(manifestPath);
  const manifest = parseGuidanceManifest(JSON.parse(manifestBytes.toString('utf8')));
  const apiManifest = parseGuidanceManifest(
    requiredValue(api.readGuidanceManifest?.(), 'manifest'),
  );
  if (JSON.stringify(apiManifest) !== JSON.stringify(manifest)) {
    throw new Error(
      'Guidance locator returned a manifest different from dist/bundle/MANIFEST.json',
    );
  }
  if (manifest.package.version !== packageManifest.version) {
    throw new Error(
      `Guidance manifest version ${manifest.package.version} differs from package version ${packageManifest.version}`,
    );
  }

  const packageFiles = await filesUnder(packageRoot);
  validatePackageLayout(packageFiles, manifest);
  await validateManifestFiles(bundleRoot, manifest);
  await validateRequiredEntrypoints(bundleRoot, manifest);
  const selectionDiff = await validateDocumentationSelection(repositoryRoot, manifest);

  return {manifest, selectionDiff};
}

export function compareGuidanceSelection(
  expected: ReadonlyMap<string, string>,
  actual: ReadonlyMap<string, string>,
): GuidanceSelectionDiff {
  const removed = [...expected.keys()].filter((path) => !actual.has(path)).sort();
  const added = [...actual.keys()].filter((path) => !expected.has(path)).sort();
  const moved: GuidanceSelectionDiff['moved'] = [];
  const remainingRemoved = new Set(removed);
  const remainingAdded = new Set(added);

  for (const from of removed) {
    const candidate = added.find(
      (to) =>
        remainingAdded.has(to) &&
        basename(to) === basename(from) &&
        expected.get(from) === actual.get(to),
    );
    if (!candidate) continue;
    remainingRemoved.delete(from);
    remainingAdded.delete(candidate);
    moved.push({from, to: candidate, kind: expected.get(from) ?? 'unknown'});
  }

  const reclassified = [...expected.keys()]
    .filter(
      (path) => expected.has(path) && actual.has(path) && expected.get(path) !== actual.get(path),
    )
    .sort()
    .map((path) => ({
      actual: actual.get(path) ?? 'unknown',
      expected: expected.get(path) ?? 'unknown',
      path,
    }));

  return {
    added: [...remainingAdded].sort(),
    moved: moved.sort((left, right) => left.from.localeCompare(right.from)),
    reclassified,
    removed: [...remainingRemoved].sort(),
  };
}

export function formatGuidanceSelectionDiff(diff: GuidanceSelectionDiff): string {
  const lines = ['Guidance documentation selection differs from the repository policy:'];
  for (const path of diff.added) lines.push(`+ added to bundle: ${path}`);
  for (const path of diff.removed) lines.push(`- missing from bundle: ${path}`);
  for (const move of diff.moved) lines.push(`~ moved: ${move.from} -> ${move.to} (${move.kind})`);
  for (const change of diff.reclassified) {
    lines.push(`! reclassified: ${change.path} (${change.actual}; expected ${change.expected})`);
  }
  return lines.join('\n');
}

async function writeConsumerManifest(root: string, tarballPath: string): Promise<void> {
  await mkdir(root, {recursive: true});
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'shipfox-engineering-guidance-external-consumer',
        version: '1.0.0',
        private: true,
        type: 'module',
        dependencies: {[engineeringGuidancePackageName]: `file:${resolve(tarballPath)}`},
      },
      null,
      2,
    )}\n`,
  );
}

async function importGuidanceApi(packageRoot: string, consumerRoot?: string): Promise<GuidanceApi> {
  const modulePath = consumerRoot
    ? pathToFileURL(
        createRequire(join(consumerRoot, 'package.json')).resolve(engineeringGuidancePackageName),
      ).href
    : pathToFileURL(join(packageRoot, 'dist/index.js')).href;
  const api = (await import(modulePath)) as GuidanceApi;
  if (
    typeof api.getGuidanceBundleRoot !== 'function' ||
    typeof api.getGuidanceManifestPath !== 'function' ||
    typeof api.readGuidanceManifest !== 'function'
  ) {
    throw new Error(
      `Packed ${engineeringGuidancePackageName} does not expose the supported locator contract`,
    );
  }
  return api;
}

export function validatePackageManifest(manifest: JsonRecord): void {
  if (manifest.name !== engineeringGuidancePackageName)
    throw new Error(`Packed package has unexpected name: ${String(manifest.name)}`);
  if (typeof manifest.version !== 'string' || !manifest.version)
    throw new Error('Packed engineering guidance package has no version');
  if (manifest.private !== false)
    throw new Error(`Packed ${engineeringGuidancePackageName} must be public`);
  if (manifest.license !== 'MIT')
    throw new Error(`Packed ${engineeringGuidancePackageName} must use the MIT license`);
  if (manifest.type !== 'module')
    throw new Error(`Packed ${engineeringGuidancePackageName} must be an ES module`);

  const repository = manifest.repository;
  if (
    !isRecord(repository) ||
    repository.type !== 'git' ||
    repository.url !== 'git+https://github.com/ShipfoxHQ/shipfox.git' ||
    repository.directory !== engineeringGuidancePackageDirectory
  ) {
    throw new Error(`Packed ${engineeringGuidancePackageName} has invalid repository metadata`);
  }

  const forbidden = findForbiddenManifestValue(manifest);
  if (forbidden)
    throw new Error(`Packed ${engineeringGuidancePackageName} has unsafe value at ${forbidden}`);
  if (manifest.devDependencies !== undefined) {
    throw new Error(`Packed ${engineeringGuidancePackageName} contains devDependencies`);
  }

  const exportTargets = collectStringValues(manifest.exports);
  if (exportTargets.length === 0 || exportTargets.some((target) => isTypeScriptSource(target))) {
    throw new Error(`Packed ${engineeringGuidancePackageName} exports TypeScript source`);
  }
}

function findForbiddenManifestValue(value: unknown, path = 'package.json'): string | undefined {
  if (typeof value === 'string') {
    if (localManifestReferencePattern.test(value) || absolutePathPattern.test(value)) return path;
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    const found = findForbiddenManifestValue(child, `${path}.${key}`);
    if (found) return found;
  }
  return undefined;
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as JsonRecord).flatMap(collectStringValues);
}

export function validatePackageLayout(packageFiles: string[], manifest: GuidanceManifest): void {
  const expectedFiles = new Set([
    ...packageMetadataFiles,
    ...manifest.files.map((file) => `dist/bundle/${file.path}`),
  ]);
  for (const expectedFile of expectedFiles) {
    if (!packageFiles.includes(expectedFile)) {
      throw new Error(`Packed ${engineeringGuidancePackageName} is missing ${expectedFile}`);
    }
  }
  const extras = packageFiles.filter((file) => !expectedFiles.has(file)).sort();
  if (extras.length > 0) {
    throw new Error(
      `Packed ${engineeringGuidancePackageName} contains undeclared extra file(s): ${extras.join(', ')}`,
    );
  }
  const unsafePath = packageFiles.find((file) => isPrivateGuidancePath(file));
  if (unsafePath) {
    throw new Error(
      `Packed ${engineeringGuidancePackageName} contains private or Cloud path ${unsafePath}`,
    );
  }
}

export async function validateManifestFiles(
  bundleRoot: string,
  manifest: GuidanceManifest,
): Promise<void> {
  for (const file of manifest.files) {
    const filePath = join(bundleRoot, file.path);
    const bytes = await readFile(filePath);
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== file.sha256) {
      throw new Error(
        `Packed ${engineeringGuidancePackageName} hash mismatch for ${file.path}: expected ${file.sha256}, received ${actualHash}`,
      );
    }
    if (file.path.endsWith(markdownExtension)) {
      await validatePackagedMarkdown(
        bundleRoot,
        file.path,
        bytes.toString('utf8'),
        manifest.source.commit,
      );
    }
  }
}

async function validateRequiredEntrypoints(
  bundleRoot: string,
  manifest: GuidanceManifest,
): Promise<void> {
  const documentationMap = manifest.entrypoints.documentationMap;
  if (!documentationMap) throw new Error('Packed guidance bundle has no documentation map');
  const required = new Set<string>([
    documentationMap,
    'repository/docs/architecture/client-architecture.md',
    'repository/docs/architecture/backend-architecture.md',
  ]);
  const packageReadme = manifest.files.find((file) => file.kind === 'package');
  if (!packageReadme) throw new Error('Packed guidance bundle contains no package README');
  required.add(packageReadme.path);

  for (const file of required) {
    const content = await readFile(join(bundleRoot, file), 'utf8');
    if (content.trim().length === 0)
      throw new Error(`Packed guidance entrypoint is empty: ${file}`);
  }
}

export async function validatePackagedMarkdown(
  bundleRoot: string,
  relativeFile: string,
  content: string,
  sourceCommit: string,
): Promise<void> {
  const repositoryRoot = join(bundleRoot, 'repository');
  for (const link of extractArtifactMarkdownLinks(content)) {
    await validatePackagedMarkdownLink(repositoryRoot, relativeFile, link, sourceCommit);
  }
}

async function validatePackagedMarkdownLink(
  repositoryRoot: string,
  relativeFile: string,
  link: MarkdownLink,
  sourceCommit: string,
): Promise<void> {
  if (link.target.startsWith('file:')) {
    throw new Error(`${relativeFile}:${link.line} contains an absolute local link: ${link.target}`);
  }
  if (isExternalTarget(link.target)) {
    validateExternalMarkdownLink(link, sourceCommit, relativeFile);
    return;
  }

  const target = parseMarkdownTarget(link.target);
  if (absolutePathPattern.test(target.path) || target.path.startsWith('/')) {
    throw new Error(`${relativeFile}:${link.line} contains an absolute local link: ${link.target}`);
  }
  const sourceAbsolute = join(repositoryRoot, relativeFile.slice('repository/'.length));
  const targetAbsolute = target.path
    ? resolve(dirname(sourceAbsolute), target.path)
    : sourceAbsolute;
  if (!isWithin(repositoryRoot, targetAbsolute)) {
    throw new Error(`${relativeFile}:${link.line} escapes the guidance bundle: ${link.target}`);
  }
  const resolvedTarget = await resolveBundleMarkdownTarget(targetAbsolute);
  if (!resolvedTarget) {
    throw new Error(`${relativeFile}:${link.line} has a broken link: ${link.target}`);
  }
  if (!target.anchor || !resolvedTarget.endsWith(markdownExtension)) return;
  const anchors = anchorsFor(await readFile(resolvedTarget, 'utf8'));
  if (!anchors.has(target.anchor)) {
    throw new Error(`${relativeFile}:${link.line} has a missing anchor: ${link.target}`);
  }
}

function validateExternalMarkdownLink(
  link: MarkdownLink,
  sourceCommit: string,
  sourceFile: string,
): void {
  if (cloudLinkPattern.test(link.target)) {
    throw new Error(`${sourceFile}:${link.line} contains a Cloud/private link: ${link.target}`);
  }
  let url: URL;
  try {
    url = new URL(link.target);
  } catch {
    if (link.target.startsWith('//')) return;
    throw new Error(`${sourceFile}:${link.line} contains an invalid external link: ${link.target}`);
  }
  if (!sourceLinkPathPattern.test(url.pathname)) return;
  const match = link.target.match(sourceLinkPattern);
  if (!match || match[2] !== sourceCommit) {
    throw new Error(
      `${sourceFile}:${link.line} contains a source permalink at the wrong commit: ${link.target}`,
    );
  }
}

async function validateDocumentationSelection(
  repositoryRoot: string,
  manifest: GuidanceManifest,
): Promise<GuidanceSelectionDiff> {
  const result = await checkRepositoryDocumentation(repositoryRoot);
  if (result.violations.length > 0) {
    const details = result.violations.map((violation) => {
      if ('source' in violation) {
        return `- ${violation.kind}: ${violation.source}:${violation.line} -> ${violation.target} (${violation.reason})`;
      }
      return `- ${violation.kind}: ${violation.file} (${violation.reason})`;
    });
    throw new Error(`Repository documentation policy failed:\n${details.join('\n')}`);
  }

  const expected = await expectedGuidanceSelection(repositoryRoot, result.checkedFiles);
  const actual = new Map(manifest.files.map((file) => [file.path, file.kind]));
  const diff = compareGuidanceSelection(expected, actual);
  if (diff.added.length || diff.removed.length || diff.moved.length || diff.reclassified.length) {
    throw new Error(formatGuidanceSelectionDiff(diff));
  }
  return diff;
}

async function expectedGuidanceSelection(
  repositoryRoot: string,
  policyFiles: string[],
): Promise<Map<string, string>> {
  const policyFileSet = new Set(policyFiles);
  const selected = new Set(
    policyFiles.filter(
      (file) =>
        isIncludedGuidancePath(file) &&
        (file.startsWith('docs/') || isGuidanceRootEntrypoint(file)),
    ),
  );
  const pending = [...selected];

  while (pending.length > 0) {
    const source = pending.pop();
    if (!source) continue;
    const content = await readFile(join(repositoryRoot, source), 'utf8');
    for (const link of extractMarkdownLinks(content)) {
      if (isExternalTarget(link.target)) continue;
      const target = await resolvePolicyTarget(repositoryRoot, source, link.target, policyFileSet);
      if (!target || !isReachableGuidancePath(target) || selected.has(target)) continue;
      selected.add(target);
      pending.push(target);
    }
  }

  return new Map(
    [...selected].sort().map((file) => [`repository/${file}`, guidanceFileKind(file)] as const),
  );
}

async function resolvePolicyTarget(
  repositoryRoot: string,
  source: string,
  rawTarget: string,
  policyFiles: ReadonlySet<string>,
): Promise<string | null> {
  const hashIndex = rawTarget.indexOf('#');
  const beforeFragment = hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget;
  const queryIndex = beforeFragment.indexOf('?');
  const rawPath = queryIndex >= 0 ? beforeFragment.slice(0, queryIndex) : beforeFragment;
  let targetPath: string;
  try {
    targetPath = decodeURIComponent(rawPath.replaceAll('\\', '/'));
  } catch {
    return null;
  }
  const sourceAbsolute = join(repositoryRoot, source);
  const candidate = targetPath ? resolve(dirname(sourceAbsolute), targetPath) : sourceAbsolute;
  if (!isWithin(repositoryRoot, candidate)) return null;

  const candidates = [candidate];
  if (extname(candidate) === '') {
    candidates.push(`${candidate}.md`, `${candidate}.mdx`, join(candidate, 'README.md'));
  } else if (await isDirectory(candidate)) {
    candidates.push(join(candidate, 'README.md'));
  }
  for (const possible of candidates) {
    if (!(await isFile(possible))) continue;
    const relativePath = toRepositoryPath(repositoryRoot, possible);
    if (policyFiles.has(relativePath)) return relativePath;
  }
  return null;
}

export function parseGuidanceManifest(value: unknown): GuidanceManifest {
  if (!isRecord(value)) throw new Error('Guidance manifest must be an object');
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported guidance manifest schema: ${String(value.schemaVersion)}`);
  }
  const packageValue = parseManifestPackage(value.package);
  const sourceValue = parseManifestSource(value.source);
  const {files, paths} = parseManifestFiles(value.files);
  const entrypoints = parseManifestEntrypoints(value.entrypoints, paths);

  return {
    entrypoints,
    files,
    package: {name: engineeringGuidancePackageName, version: packageValue.version},
    schemaVersion: 1,
    source: {commit: sourceValue.commit, repository: engineeringGuidanceRepository},
  };
}

function parseManifestPackage(value: unknown): {version: string} {
  if (!isRecord(value) || value.name !== engineeringGuidancePackageName) {
    throw new Error(`Guidance manifest package name must be ${engineeringGuidancePackageName}`);
  }
  if (typeof value.version !== 'string' || !value.version) {
    throw new Error('Guidance manifest package version must be a non-empty string');
  }
  return {version: value.version};
}

function parseManifestSource(value: unknown): {commit: string} {
  if (!isRecord(value) || value.repository !== engineeringGuidanceRepository) {
    throw new Error(`Guidance manifest source repository must be ${engineeringGuidanceRepository}`);
  }
  if (typeof value.commit !== 'string' || !fullCommitPattern.test(value.commit)) {
    throw new Error('Guidance manifest source commit must be a full 40-character SHA-1');
  }
  return {commit: value.commit};
}

function parseManifestFiles(value: unknown): {
  files: GuidanceManifestFile[];
  paths: Set<string>;
} {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Guidance manifest must list at least one file');
  }
  const paths = new Set<string>();
  let previousPath = '';
  const files: GuidanceManifestFile[] = [];
  for (const [index, rawFile] of value.entries()) {
    const file = parseManifestFile(rawFile, index, previousPath, paths);
    paths.add(file.path);
    previousPath = file.path;
    files.push(file);
  }
  return {files, paths};
}

function parseManifestFile(
  value: unknown,
  index: number,
  previousPath: string,
  paths: ReadonlySet<string>,
): GuidanceManifestFile {
  if (!isRecord(value)) throw new Error(`Guidance manifest file ${index} must be an object`);
  if (
    typeof value.path !== 'string' ||
    typeof value.sha256 !== 'string' ||
    typeof value.kind !== 'string'
  ) {
    throw new Error(`Guidance manifest file ${index} has an invalid shape`);
  }
  assertManifestPath(value.path, `files.${index}.path`);
  if (!value.path.endsWith(markdownExtension)) {
    throw new Error(`Guidance manifest file is not Markdown: ${value.path}`);
  }
  if (value.path <= previousPath) throw new Error('Guidance manifest files must be sorted by path');
  if (paths.has(value.path)) throw new Error(`Duplicate guidance manifest path: ${value.path}`);
  if (!sha256Pattern.test(value.sha256)) {
    throw new Error(`Invalid SHA-256 for guidance manifest file: ${value.path}`);
  }
  if (!value.kind) throw new Error(`Missing kind for guidance manifest file: ${value.path}`);
  if (isPrivateGuidancePath(value.path)) {
    throw new Error(`Guidance manifest contains a private or Cloud path: ${value.path}`);
  }
  return {kind: value.kind, path: value.path, sha256: value.sha256};
}

function parseManifestEntrypoints(
  value: unknown,
  paths: ReadonlySet<string>,
): Record<string, string> {
  if (!isRecord(value) || typeof value.documentationMap !== 'string') {
    throw new Error('Guidance manifest must define entrypoints.documentationMap');
  }
  const entrypoints: Record<string, string> = {};
  for (const [name, entrypoint] of Object.entries(value)) {
    if (typeof entrypoint !== 'string') {
      throw new Error(`Guidance manifest entrypoint ${name} must be a string`);
    }
    assertManifestPath(entrypoint, `entrypoints.${name}`);
    if (!paths.has(entrypoint)) {
      throw new Error(`Guidance manifest entrypoint ${name} is not listed in files`);
    }
    entrypoints[name] = entrypoint;
  }
  return entrypoints;
}

function assertManifestPath(value: string, field: string): void {
  if (
    !value.startsWith('repository/') ||
    value.includes('\\') ||
    value.includes('//') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid ${field}: ${value}`);
  }
}

function parseJsonRecord(bytes: Buffer): JsonRecord {
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (!isRecord(value)) throw new Error('Expected a JSON object');
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Guidance API returned no ${label}`);
  return value;
}

function requiredValue(value: unknown, label: string): unknown {
  if (value === undefined) throw new Error(`Guidance API returned no ${label}`);
  return value;
}

async function filesUnder(directory: string, rootDirectory = directory): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Packed ${engineeringGuidancePackageName} contains a symlink: ${entry.name}`);
    }
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(entryPath, rootDirectory)));
    } else if (entry.isFile()) {
      files.push(toRepositoryPath(rootDirectory, entryPath));
    } else {
      throw new Error(
        `Packed ${engineeringGuidancePackageName} contains a special file: ${entry.name}`,
      );
    }
  }
  return files.sort();
}

async function resolveBundleMarkdownTarget(candidate: string): Promise<string | null> {
  const candidates = [candidate];
  if (extname(candidate) === '') {
    candidates.push(`${candidate}.md`, `${candidate}.mdx`, join(candidate, 'README.md'));
  } else if (await isDirectory(candidate)) {
    candidates.push(join(candidate, 'README.md'));
  }
  for (const possible of candidates) {
    if (await isFile(possible)) return possible;
  }
  return null;
}

function extractArtifactMarkdownLinks(content: string): MarkdownLink[] {
  const normalizedContent = content.replace(/\r\n?/gu, '\n');
  const links: MarkdownLink[] = [];
  const lines = normalizedContent.split('\n');
  let inFence = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    if (fencePattern.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      collectInlineLinks(line, lineIndex + 1, links);
      const reference = line.match(referenceLinkPattern)?.[1];
      if (reference) {
        const target = reference.startsWith('<') ? reference.slice(1, -1) : reference;
        links.push({line: lineIndex + 1, target});
      }
    }
  }
  return links;
}

function collectInlineLinks(line: string, lineNumber: number, links: MarkdownLink[]): void {
  let searchFrom = 0;
  while (searchFrom < line.length) {
    const closeBracket = line.indexOf('](', searchFrom);
    if (closeBracket < 0) return;
    const start = closeBracket + 2;
    let targetStart = start;
    while (whitespaceCharacterPattern.test(line[targetStart] ?? '')) targetStart += 1;
    if (line[targetStart] === '<') {
      const closeAngle = line.indexOf('>', targetStart + 1);
      if (closeAngle >= 0) {
        links.push({line: lineNumber, target: line.slice(targetStart + 1, closeAngle)});
        searchFrom = closeAngle + 1;
        continue;
      }
    }
    const closeParenthesis = findClosingParenthesis(line, targetStart);
    if (closeParenthesis < 0) return;
    const target = line.slice(targetStart, closeParenthesis).match(nonWhitespacePattern)?.[0];
    if (target) links.push({line: lineNumber, target});
    searchFrom = closeParenthesis + 1;
  }
}

function findClosingParenthesis(line: string, start: number): number {
  let depth = 0;
  for (let index = start; index < line.length; index += 1) {
    const character = line[index];
    if (character === '(') depth += 1;
    if (character !== ')') continue;
    if (depth === 0) return index;
    depth -= 1;
  }
  return -1;
}

function parseMarkdownTarget(target: string): ParsedTarget {
  const hashIndex = target.indexOf('#');
  const rawPath = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const rawAnchor = hashIndex >= 0 ? target.slice(hashIndex + 1) : '';
  try {
    return {
      anchor: rawAnchor ? decodeURIComponent(rawAnchor).toLowerCase() : null,
      path: decodeURIComponent(rawPath.replaceAll('\\', '/')),
    };
  } catch {
    throw new Error(`Invalid percent encoding in Markdown target: ${target}`);
  }
}

function anchorsFor(content: string): Set<string> {
  const anchors = new Set<string>();
  const usedSlugs = new Map<string, number>();
  const lines = withoutFencedCode(content.replace(/\r\n?/gu, '\n')).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const atxHeading = line.match(atxHeadingPattern);
    const setextHeading = !atxHeading && lines[index + 1]?.match(setextHeadingPattern);
    const heading = atxHeading?.[1] ?? (setextHeading ? line.trim() : null);
    if (!heading) continue;
    const slug = slugifyHeading(heading);
    if (!slug) continue;
    const count = usedSlugs.get(slug) ?? 0;
    usedSlugs.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return anchors;
}

function slugifyHeading(heading: string): string {
  return heading
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]+>/gu, '')
    .replace(/[\u0060*_~]/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/\s+/gu, '-');
}

function withoutFencedCode(content: string): string {
  let inFence = false;
  return content
    .split('\n')
    .map((line) => {
      if (fencePattern.test(line)) {
        inFence = !inFence;
        return '';
      }
      return inFence ? '' : line;
    })
    .join('\n');
}

function isIncludedGuidancePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  if (!normalized.endsWith(markdownExtension)) return false;
  if (
    excludedPathPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix))
  ) {
    return false;
  }
  if (normalized.split('/').some((segment) => excludedFixtureSegments.has(segment))) return false;
  if (normalized.split('/').some((segment) => excludedPathSegments.has(segment))) return false;
  return posix.basename(normalized) !== 'CHANGELOG.md';
}

function isReachableGuidancePath(relativePath: string): boolean {
  return (
    isIncludedGuidancePath(relativePath) &&
    (isGuidanceRootEntrypoint(relativePath) ||
      relativePath.startsWith('apps/') ||
      relativePath.startsWith('dev/') ||
      relativePath.startsWith('e2e/') ||
      relativePath.startsWith('infra/') ||
      relativePath.startsWith('libs/') ||
      relativePath.startsWith('tools/') ||
      relativePath.startsWith('.agents/skills/'))
  );
}

function isPrivateGuidancePath(file: string): boolean {
  return privateGuidancePathPattern.test(file);
}

function isExternalTarget(target: string): boolean {
  return externalLinkPattern.test(target);
}

function isTypeScriptSource(target: string): boolean {
  return target.includes('/src/') || (target.endsWith('.ts') && !target.endsWith('.d.ts'));
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return (
    normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
  );
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toRepositoryPath(root: string, file: string): string {
  return relative(root, file).split('\\').join('/');
}
