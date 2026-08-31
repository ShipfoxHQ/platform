import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {dirname, extname, isAbsolute, join, posix, relative, resolve} from 'node:path';
import {promisify} from 'node:util';

import {
  assertGuidanceManifest,
  type GuidanceManifest,
  type GuidanceManifestFile,
  guidanceManifestSchemaVersion,
  guidancePackageName,
  guidanceRepository,
} from './manifest.js';

const execFileAsync = promisify(execFile);
const markdownExtension = '.md';
const excludedDirectoryNames = new Set([
  '.cache',
  '.changeset',
  '.context',
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'test-results',
]);
const excludedPathPrefixes = [
  'apps/docs/content/',
  'apps/docs/WRITING.md',
  'libs/client/shell/test/external/',
] as const;
const excludedPathSegments = new Set(['.cache', '.changeset', '.context', '.git', '.turbo']);
const excludedFixtureSegments = new Set(['fixture', 'fixtures', 'test', 'tests', '__tests__']);
const externalLinkPattern = /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu;
const atxHeadingPattern = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u;
const setextHeadingPattern = /^ {0,3}(?:=+|-+)\s*$/u;
const fencePattern = /^\s{0,3}(`{3,}|~{3,})/u;
const referenceLinkPattern = /^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]+>|[^\s]+)[^\n]*$/u;
const sourceCommitPattern = /^[a-f0-9]{40}$/u;
const nonWhitespacePattern = /^\S+/u;
const trailingSlashPattern = /\/$/u;
const whitespacePattern = /\s/u;

export interface GenerateGuidanceBundleOptions {
  sourceRoot: string;
  outputRoot: string;
  packageVersion: string;
  sourceCommit: string;
  availableFiles?: Iterable<string>;
}

export interface GeneratedGuidanceBundle {
  manifest: GuidanceManifest;
  files: string[];
  outputRoot: string;
}

export interface MarkdownLink {
  line: number;
  target: string;
}

interface ParsedMarkdownLink extends MarkdownLink {
  destinationEnd: number;
  destinationStart: number;
  usesAngleBrackets: boolean;
}

interface ParsedTarget {
  anchor: string | null;
  fragment: string;
  path: string;
  query: string;
}

interface LocalTarget {
  absolutePath: string;
  isDirectory: boolean;
  relativePath: string;
}

export async function generateGuidanceBundle(
  options: GenerateGuidanceBundleOptions,
): Promise<GeneratedGuidanceBundle> {
  // Keep the private policy package build-time-only for packed --ensure/--verify paths.
  const {guidanceFileKind, guidanceRootEntrypoints, isGuidanceRootEntrypoint} = await import(
    '@shipfox/repository-documentation-policy/documentation'
  );
  const sourceRoot = resolve(options.sourceRoot);
  const outputRoot = resolve(options.outputRoot);
  assertGenerationInputs(sourceRoot, outputRoot, options.packageVersion, options.sourceCommit);

  const availableFiles = await normalizeAvailableFiles(sourceRoot, options.availableFiles);
  const sourceFiles = await selectSourceFiles(
    sourceRoot,
    availableFiles,
    guidanceRootEntrypoints,
    isGuidanceRootEntrypoint,
  );
  const sourceContents = new Map<string, string>();
  for (const sourceFile of sourceFiles) {
    sourceContents.set(sourceFile, await readSourceText(sourceRoot, sourceFile));
  }

  const bundledFiles = new Map<string, string>();
  for (const sourceFile of sourceFiles) {
    const content = sourceContents.get(sourceFile) ?? '';
    const rewritten = await rewriteMarkdown(
      sourceRoot,
      sourceFile,
      content,
      sourceFiles,
      availableFiles,
      sourceContents,
      options.sourceCommit,
    );
    const outputPath = `repository/${sourceFile}`;
    if (bundledFiles.has(outputPath)) {
      throw new Error(`Duplicate guidance bundle output path: ${outputPath}`);
    }
    bundledFiles.set(outputPath, rewritten);
  }

  const manifestFiles = [...bundledFiles.entries()]
    .sort(([left], [right]) => comparePaths(left, right))
    .map(
      ([filePath, content]) =>
        ({
          path: filePath,
          sha256: sha256(content),
          kind: guidanceFileKind(filePath.slice('repository/'.length)),
        }) satisfies GuidanceManifestFile,
    );
  const manifest: GuidanceManifest = {
    schemaVersion: guidanceManifestSchemaVersion,
    package: {name: guidancePackageName, version: options.packageVersion},
    source: {repository: guidanceRepository, commit: options.sourceCommit},
    entrypoints: entrypointsFor(sourceFiles, isGuidanceRootEntrypoint),
    files: manifestFiles,
  };
  assertGuidanceManifest(manifest);

  await writeGeneratedBundle(outputRoot, bundledFiles, manifest);
  return {manifest, files: sourceFiles, outputRoot};
}

export async function validateGeneratedBundle(bundleRoot: string): Promise<GuidanceManifest> {
  const root = resolve(bundleRoot);
  const manifestPath = join(root, 'MANIFEST.json');
  const value: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  assertGuidanceManifest(value);
  const manifest = value;

  const expectedFiles = new Set(['MANIFEST.json', ...manifest.files.map((file) => file.path)]);
  const actualFiles = new Set(await filesUnder(root));
  for (const expectedFile of expectedFiles) {
    if (!actualFiles.has(expectedFile))
      throw new Error(`Guidance bundle is missing ${expectedFile}`);
  }
  for (const actualFile of actualFiles) {
    if (!expectedFiles.has(actualFile))
      throw new Error(`Guidance bundle contains undeclared ${actualFile}`);
  }

  for (const file of manifest.files) {
    const content = await readFile(join(root, file.path), 'utf8');
    if (sha256(content) !== file.sha256) {
      throw new Error(`Guidance bundle hash mismatch for ${file.path}`);
    }
    if (file.path.endsWith(markdownExtension)) {
      await validatePackagedMarkdown(root, file.path, content);
    }
  }
  return manifest;
}

export function extractMarkdownLinks(content: string): MarkdownLink[] {
  return extractParsedMarkdownLinks(content).map(({line, target}) => ({line, target}));
}

export function anchorsFor(content: string): Set<string> {
  const anchors = new Set<string>();
  const usedSlugs = new Map<string, number>();
  const lines = withoutFencedCode(normalizeLineEndings(content)).split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const atxHeading = line.match(atxHeadingPattern);
    const setextHeading = !atxHeading && lines[index + 1]?.match(setextHeadingPattern);
    const heading = atxHeading?.[1] ?? (setextHeading ? line.trim() : null);
    if (!heading) continue;

    const baseSlug = slugifyHeading(heading);
    if (!baseSlug) continue;
    const duplicateCount = usedSlugs.get(baseSlug) ?? 0;
    usedSlugs.set(baseSlug, duplicateCount + 1);
    anchors.add(duplicateCount === 0 ? baseSlug : `${baseSlug}-${duplicateCount}`);
  }
  return anchors;
}

export function isIncludedGuidancePath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized.endsWith(markdownExtension)) return false;
  if (
    excludedPathPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix))
  ) {
    return false;
  }
  if (normalized.split('/').some((segment) => excludedFixtureSegments.has(segment))) return false;
  if (normalized.split('/').some((segment) => excludedPathSegments.has(segment))) return false;
  if (posix.basename(normalized) === 'CHANGELOG.md') return false;
  return true;
}

async function selectSourceFiles(
  sourceRoot: string,
  availableFiles: Set<string>,
  guidanceRootEntrypoints: readonly string[],
  isGuidanceRootEntrypoint: (relativePath: string) => boolean,
): Promise<string[]> {
  const markdownFiles = [...availableFiles].filter((file) => isIncludedGuidancePath(file));
  const selected = new Set(markdownFiles.filter((file) => file.startsWith('docs/')));
  for (const entrypoint of guidanceRootEntrypoints) {
    if (availableFiles.has(entrypoint)) selected.add(entrypoint);
  }
  if (!selected.has('docs/README.md')) {
    throw new Error('Guidance source is missing the required docs/README.md entrypoint');
  }

  const pending = [...selected];
  while (pending.length > 0) {
    const sourceFile = pending.pop();
    if (!sourceFile) continue;
    await selectLinkedSourceFiles(
      sourceRoot,
      sourceFile,
      availableFiles,
      selected,
      pending,
      isGuidanceRootEntrypoint,
    );
  }

  return [...selected].sort(comparePaths);
}

async function selectLinkedSourceFiles(
  sourceRoot: string,
  sourceFile: string,
  availableFiles: Set<string>,
  selected: Set<string>,
  pending: string[],
  isGuidanceRootEntrypoint: (relativePath: string) => boolean,
): Promise<void> {
  const content = await readSourceText(sourceRoot, sourceFile);
  for (const link of extractParsedMarkdownLinks(content)) {
    if (isExternalTarget(link.target)) continue;
    const target = await resolveLocalTarget(sourceRoot, sourceFile, link.target);
    if (!target || target.isDirectory) continue;
    if (!availableFiles.has(target.relativePath)) {
      if (isExcludedGuidancePath(target.relativePath)) continue;
      throw new Error(
        `${sourceFile}:${link.line} links to an untracked or unavailable file: ${link.target}`,
      );
    }
    if (!isReachableGuidancePath(target.relativePath, isGuidanceRootEntrypoint)) continue;
    if (selected.has(target.relativePath)) continue;
    selected.add(target.relativePath);
    pending.push(target.relativePath);
  }
}

async function rewriteMarkdown(
  sourceRoot: string,
  sourceFile: string,
  content: string,
  bundledFiles: string[],
  availableFiles: Set<string>,
  sourceContents: Map<string, string>,
  sourceCommit: string,
): Promise<string> {
  const replacements: Array<{end: number; start: number; value: string}> = [];
  const bundledSet = new Set(bundledFiles);
  for (const link of extractParsedMarkdownLinks(content)) {
    if (isExternalTarget(link.target)) continue;
    const replacementText = await rewriteMarkdownLink({
      availableFiles,
      bundledSet,
      link,
      sourceCommit,
      sourceContents,
      sourceFile,
      sourceRoot,
    });
    if (replacementText !== content.slice(link.destinationStart, link.destinationEnd)) {
      replacements.push({
        start: link.destinationStart,
        end: link.destinationEnd,
        value: replacementText,
      });
    }
  }

  let rewritten = content;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    rewritten =
      rewritten.slice(0, replacement.start) + replacement.value + rewritten.slice(replacement.end);
  }
  return normalizeLineEndings(rewritten);
}

interface RewriteMarkdownLinkOptions {
  availableFiles: Set<string>;
  bundledSet: Set<string>;
  link: ParsedMarkdownLink;
  sourceCommit: string;
  sourceContents: Map<string, string>;
  sourceFile: string;
  sourceRoot: string;
}

async function rewriteMarkdownLink(options: RewriteMarkdownLinkOptions): Promise<string> {
  const {availableFiles, bundledSet, link, sourceCommit, sourceContents, sourceFile, sourceRoot} =
    options;
  const parsedTarget = parseTarget(link.target);
  const target = await resolveLocalTarget(sourceRoot, sourceFile, link.target);
  if (!target)
    throw new Error(`${sourceFile}:${link.line} has an invalid local link: ${link.target}`);
  const isAvailable =
    availableFiles.has(target.relativePath) || hasAvailableDescendant(target, availableFiles);
  if (!isAvailable && !isExcludedGuidancePath(target.relativePath)) {
    throw new Error(`${sourceFile}:${link.line} links to an unavailable file: ${link.target}`);
  }
  await validateSourceLinkAnchor(
    sourceRoot,
    sourceFile,
    sourceContents,
    link,
    target,
    parsedTarget,
  );

  const replacement = bundledSet.has(target.relativePath)
    ? bundledLinkTarget(sourceFile, target.relativePath, parsedTarget)
    : externalLinkTarget(sourceFile, sourceCommit, link, target, parsedTarget, isAvailable);
  return link.usesAngleBrackets || whitespacePattern.test(replacement)
    ? `<${replacement}>`
    : replacement;
}

async function validateSourceLinkAnchor(
  sourceRoot: string,
  sourceFile: string,
  sourceContents: Map<string, string>,
  link: ParsedMarkdownLink,
  target: LocalTarget,
  parsedTarget: ParsedTarget,
): Promise<void> {
  if (!parsedTarget.anchor) return;
  const targetContents = await readTargetText(sourceRoot, target, sourceContents);
  if (!targetContents || !isMarkdownPath(target.relativePath)) return;
  if (anchorsFor(targetContents).has(parsedTarget.anchor)) return;
  throw new Error(
    `${sourceFile}:${link.line} links to missing anchor ${link.target} in ${target.relativePath}`,
  );
}

function bundledLinkTarget(
  sourceFile: string,
  targetFile: string,
  parsedTarget: ParsedTarget,
): string {
  const sourceOutputPath = `repository/${sourceFile}`;
  const targetOutputPath = `repository/${targetFile}`;
  const relativeTarget = posix.relative(posix.dirname(sourceOutputPath), targetOutputPath);
  return `${relativeTarget || posix.basename(targetOutputPath)}${parsedTarget.query}${parsedTarget.fragment}`;
}

function externalLinkTarget(
  sourceFile: string,
  sourceCommit: string,
  link: ParsedMarkdownLink,
  target: LocalTarget,
  parsedTarget: ParsedTarget,
  isAvailable: boolean,
): string {
  if (!isAvailable) {
    throw new Error(`${sourceFile}:${link.line} links to a disallowed local file: ${link.target}`);
  }
  return `${githubPermalink(target, sourceCommit)}${parsedTarget.query}${parsedTarget.fragment}`;
}

async function validatePackagedMarkdown(
  bundleRoot: string,
  relativeFile: string,
  content: string,
): Promise<void> {
  const repositoryRoot = join(bundleRoot, 'repository');
  for (const link of extractParsedMarkdownLinks(content)) {
    if (isExternalTarget(link.target)) continue;
    await validatePackagedMarkdownLink(repositoryRoot, relativeFile, link);
  }
}

async function validatePackagedMarkdownLink(
  repositoryRoot: string,
  relativeFile: string,
  link: ParsedMarkdownLink,
): Promise<void> {
  const target = parseTarget(link.target);
  if (target.path.startsWith('/')) {
    throw new Error(`${relativeFile}:${link.line} contains an absolute local link: ${link.target}`);
  }
  const sourceAbsolute = join(repositoryRoot, relativeFile.slice('repository/'.length));
  const targetAbsolute = target.path
    ? resolve(dirname(sourceAbsolute), target.path)
    : sourceAbsolute;
  if (!isWithin(repositoryRoot, targetAbsolute)) {
    throw new Error(`${relativeFile}:${link.line} escapes the guidance bundle: ${link.target}`);
  }
  const resolved = await resolveBundleTarget(targetAbsolute);
  if (!resolved) throw new Error(`${relativeFile}:${link.line} has a broken link: ${link.target}`);
  if (!target.anchor || !(await isFile(resolved)) || !isMarkdownPath(resolved)) return;
  const targetContent = await readFile(resolved, 'utf8');
  if (!anchorsFor(targetContent).has(target.anchor)) {
    throw new Error(`${relativeFile}:${link.line} has a missing anchor: ${link.target}`);
  }
}

async function writeGeneratedBundle(
  outputRoot: string,
  bundledFiles: Map<string, string>,
  manifest: GuidanceManifest,
): Promise<void> {
  await mkdir(dirname(outputRoot), {recursive: true});
  const temporaryRoot = await mkdtemp(join(dirname(outputRoot), '.engineering-guidance-'));
  try {
    for (const [filePath, content] of bundledFiles) {
      const outputPath = join(temporaryRoot, filePath);
      await mkdir(dirname(outputPath), {recursive: true});
      await writeFile(outputPath, content, 'utf8');
    }
    await writeFile(join(temporaryRoot, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(outputRoot, {force: true, recursive: true});
    await rename(temporaryRoot, outputRoot);
  } catch (error) {
    await rm(temporaryRoot, {force: true, recursive: true});
    throw error;
  }
}

function entrypointsFor(
  sourceFiles: string[],
  isGuidanceRootEntrypoint: (relativePath: string) => boolean,
): Record<string, string> {
  const sourceSet = new Set(sourceFiles);
  const entrypoints: Record<string, string> = {
    documentationMap: 'repository/docs/README.md',
  };
  const names: Array<[string, string]> = [
    ['agents', 'AGENTS.md'],
    ['contributing', 'CONTRIBUTING.md'],
    ['writing', 'WRITING.md'],
    ['design', 'DESIGN.md'],
  ];
  for (const [name, sourceFile] of names) {
    if (sourceSet.has(sourceFile) && isGuidanceRootEntrypoint(sourceFile)) {
      entrypoints[name] = `repository/${sourceFile}`;
    }
  }
  return entrypoints;
}

function githubPermalink(target: LocalTarget, sourceCommit: string): string {
  const targetPath = target.relativePath;
  const kind = target.isDirectory ? 'tree' : 'blob';
  return `https://github.com/${guidanceRepository}/${kind}/${sourceCommit}/${targetPath}`;
}

function parseTarget(target: string): ParsedTarget {
  const hashIndex = target.indexOf('#');
  const beforeFragment = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const fragment = hashIndex >= 0 ? target.slice(hashIndex) : '';
  const queryIndex = beforeFragment.indexOf('?');
  const pathPart = queryIndex >= 0 ? beforeFragment.slice(0, queryIndex) : beforeFragment;
  const query = queryIndex >= 0 ? beforeFragment.slice(queryIndex) : '';
  const anchorPart = hashIndex >= 0 ? target.slice(hashIndex + 1) : '';
  let decodedPath: string;
  let decodedAnchor: string;
  try {
    decodedPath = decodeURIComponent(pathPart.replaceAll('\\', '/'));
    decodedAnchor = decodeURIComponent(anchorPart);
  } catch {
    throw new Error(`Invalid percent encoding in Markdown target: ${target}`);
  }
  return {
    path: decodedPath,
    query,
    fragment,
    anchor: decodedAnchor ? decodedAnchor.toLowerCase() : null,
  };
}

async function resolveLocalTarget(
  sourceRoot: string,
  sourceFile: string,
  rawTarget: string,
): Promise<LocalTarget | null> {
  const parsedTarget = parseTarget(rawTarget);
  if (parsedTarget.path.startsWith('/')) {
    throw new Error(`Absolute local Markdown target is not allowed: ${rawTarget}`);
  }
  const sourceAbsolute = join(sourceRoot, sourceFile);
  const candidate = parsedTarget.path
    ? resolve(dirname(sourceAbsolute), parsedTarget.path)
    : sourceAbsolute;
  if (!isWithin(sourceRoot, candidate)) {
    throw new Error(`Markdown target escapes the repository: ${rawTarget}`);
  }

  const candidates = [candidate];
  if (extname(candidate) === '') {
    candidates.push(`${candidate}.md`, `${candidate}.mdx`, join(candidate, 'README.md'));
  } else if (await isDirectory(candidate)) {
    candidates.push(join(candidate, 'README.md'));
  }
  for (const possibleTarget of candidates) {
    if (!(await isFileOrDirectory(possibleTarget))) continue;
    await assertRealpathWithin(sourceRoot, possibleTarget);
    return {
      absolutePath: possibleTarget,
      isDirectory: await isDirectory(possibleTarget),
      relativePath: toRepositoryPath(sourceRoot, possibleTarget),
    };
  }
  return null;
}

async function resolveBundleTarget(candidate: string): Promise<string | null> {
  const candidates = [candidate];
  if (extname(candidate) === '') {
    candidates.push(`${candidate}.md`, `${candidate}.mdx`, join(candidate, 'README.md'));
  } else if (await isDirectory(candidate)) {
    candidates.push(join(candidate, 'README.md'));
  }
  for (const possibleTarget of candidates) {
    if (await isFile(possibleTarget)) return possibleTarget;
  }
  return null;
}

async function normalizeAvailableFiles(
  sourceRoot: string,
  availableFiles: Iterable<string> | undefined,
): Promise<Set<string>> {
  const files = availableFiles ? [...availableFiles] : await filesUnder(sourceRoot);
  const normalized = new Set<string>();
  for (const file of files) {
    const relativePath = normalizeRelativePath(file);
    if (normalized.has(relativePath)) {
      throw new Error(`Duplicate source path maps to ${relativePath}`);
    }
    if (await isFile(join(sourceRoot, relativePath))) normalized.add(relativePath);
  }
  return normalized;
}

async function readTargetText(
  sourceRoot: string,
  target: LocalTarget,
  sourceContents: Map<string, string>,
): Promise<string> {
  const cached = sourceContents.get(target.relativePath);
  if (cached !== undefined) return cached;
  if (target.isDirectory || !isMarkdownPath(target.relativePath)) return '';
  const content = await readSourceText(sourceRoot, target.relativePath);
  sourceContents.set(target.relativePath, content);
  return content;
}

async function readSourceText(sourceRoot: string, relativePath: string): Promise<string> {
  const absolutePath = join(sourceRoot, relativePath);
  const fileStats = await lstat(absolutePath);
  if (fileStats.isSymbolicLink())
    throw new Error(`Symlinked guidance source is not allowed: ${relativePath}`);
  if (!fileStats.isFile()) throw new Error(`Guidance source is not a file: ${relativePath}`);
  return normalizeLineEndings(await readFile(absolutePath, 'utf8'));
}

function assertGenerationInputs(
  sourceRoot: string,
  outputRoot: string,
  packageVersion: string,
  sourceCommit: string,
): void {
  if (!packageVersion) throw new Error('Guidance package version is required');
  if (!sourceCommitPattern.test(sourceCommit)) {
    throw new Error('Guidance source commit must be a full 40-character SHA-1');
  }
  if (outputRoot === sourceRoot || sourceRoot.startsWith(`${outputRoot}/`)) {
    throw new Error('Guidance output root must not replace the repository root');
  }
}

function isExternalTarget(target: string): boolean {
  return externalLinkPattern.test(target);
}

function isExcludedGuidancePath(relativePath: string): boolean {
  return !isIncludedGuidancePath(relativePath);
}

function isReachableGuidancePath(
  relativePath: string,
  isGuidanceRootEntrypoint: (relativePath: string) => boolean,
): boolean {
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

function hasAvailableDescendant(target: LocalTarget, availableFiles: Set<string>): boolean {
  if (!target.isDirectory) return false;
  const prefix = `${target.relativePath.replace(trailingSlashPattern, '')}/`;
  return [...availableFiles].some((file) => file.startsWith(prefix));
}

function isMarkdownPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(markdownExtension);
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return (
    normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
  );
}

async function assertRealpathWithin(root: string, candidate: string): Promise<void> {
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (!isWithin(realRoot, realCandidate)) {
    throw new Error(`Guidance path escapes the repository: ${candidate}`);
  }
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/gu, '\n');
}

function normalizeRelativePath(file: string): string {
  const normalized = posix.normalize(file.replaceAll('\\', '/'));
  if (isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Source path escapes the repository: ${file}`);
  }
  return normalized;
}

function toRepositoryPath(root: string, file: string): string {
  return relative(root, file).split('\\').join('/');
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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

function extractParsedMarkdownLinks(content: string): ParsedMarkdownLink[] {
  const links: ParsedMarkdownLink[] = [];
  const normalizedContent = normalizeLineEndings(content);
  const lines = normalizedContent.split('\n');
  let offset = 0;
  let inFence = false;
  for (const line of lines) {
    if (fencePattern.test(line)) {
      inFence = !inFence;
      offset += line.length + 1;
      continue;
    }
    if (!inFence) collectInlineLinks(line, offset, lineNumberAt(normalizedContent, offset), links);
    offset += line.length + 1;
  }
  collectReferenceLinks(normalizedContent, links);
  return links.sort((left, right) => left.destinationStart - right.destinationStart);
}

function collectInlineLinks(
  line: string,
  offset: number,
  lineNumber: number,
  links: ParsedMarkdownLink[],
): void {
  let searchFrom = 0;
  while (searchFrom < line.length) {
    const closeBracket = line.indexOf('](', searchFrom);
    if (closeBracket < 0) return;
    const destinationStartInLine = closeBracket + 2;
    const parsed = parseInlineDestination(line, destinationStartInLine);
    if (parsed) {
      links.push({
        line: lineNumber,
        target: parsed.target,
        destinationStart: offset + parsed.destinationStart,
        destinationEnd: offset + parsed.destinationEnd,
        usesAngleBrackets: parsed.usesAngleBrackets,
      });
    }
    searchFrom = parsed ? parsed.closeParenthesis + 1 : destinationStartInLine + 1;
  }
}

function parseInlineDestination(
  line: string,
  start: number,
): {
  closeParenthesis: number;
  destinationEnd: number;
  destinationStart: number;
  target: string;
  usesAngleBrackets: boolean;
} | null {
  let destinationStart = start;
  while (whitespacePattern.test(line[destinationStart] ?? '')) destinationStart += 1;
  if (line[destinationStart] === '<') {
    const closeAngle = line.indexOf('>', destinationStart + 1);
    if (closeAngle < 0) return null;
    const target = line.slice(destinationStart + 1, closeAngle);
    const closeParenthesis = findClosingParenthesis(line, closeAngle + 1);
    if (closeParenthesis < 0) return null;
    return {
      closeParenthesis,
      destinationStart: destinationStart + 1,
      destinationEnd: closeAngle,
      target,
      usesAngleBrackets: true,
    };
  }
  const closeParenthesis = findClosingParenthesis(line, destinationStart);
  if (closeParenthesis < 0) return null;
  const rawDestination = line.slice(destinationStart, closeParenthesis);
  const token = rawDestination.match(nonWhitespacePattern)?.[0];
  if (!token) return null;
  return {
    closeParenthesis,
    destinationStart,
    destinationEnd: destinationStart + token.length,
    target: token,
    usesAngleBrackets: false,
  };
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

function collectReferenceLinks(content: string, links: ParsedMarkdownLink[]): void {
  const normalizedContent = normalizeLineEndings(content);
  let offset = 0;
  let inFence = false;
  for (const line of normalizedContent.split('\n')) {
    if (fencePattern.test(line)) {
      inFence = !inFence;
      offset += line.length + 1;
      continue;
    }
    if (!inFence) {
      collectReferenceLinkLine(normalizedContent, line, offset, links);
    }
    offset += line.length + 1;
  }
}

function collectReferenceLinkLine(
  content: string,
  line: string,
  offset: number,
  links: ParsedMarkdownLink[],
): void {
  const rawTarget = line.match(referenceLinkPattern)?.[1];
  if (!rawTarget) return;
  const definitionEnd = line.indexOf(']:');
  let rawStartInLine = definitionEnd + 2;
  while (line[rawStartInLine] === ' ' || line[rawStartInLine] === '\t') rawStartInLine += 1;
  const usesAngleBrackets = rawTarget.startsWith('<') && rawTarget.endsWith('>');
  const rawStart = offset + rawStartInLine;
  links.push({
    line: lineNumberAt(content, rawStart),
    target: usesAngleBrackets ? rawTarget.slice(1, -1) : rawTarget,
    destinationStart: rawStart + (usesAngleBrackets ? 1 : 0),
    destinationEnd: rawStart + rawTarget.length - (usesAngleBrackets ? 1 : 0),
    usesAngleBrackets,
  });
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

async function filesUnder(directory: string, rootDirectory = directory): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (excludedDirectoryNames.has(entry.name)) return [];
        return filesUnder(entryPath, rootDirectory);
      }
      if (!entry.isFile()) return [];
      return [toRepositoryPath(rootDirectory, entryPath)];
    }),
  );
  return files.flat();
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

async function isFileOrDirectory(file: string): Promise<boolean> {
  return (await isFile(file)) || (await isDirectory(file));
}

async function getGitOutput(root: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', root, ...args], {encoding: 'utf8'});
  return result.stdout.trim();
}

export async function generateFromRepository(
  packageRoot: string,
  outputRoot: string,
  packageVersion: string,
): Promise<GeneratedGuidanceBundle> {
  const sourceRoot = await getGitOutput(packageRoot, ['rev-parse', '--show-toplevel']);
  const sourceCommit = await getGitOutput(sourceRoot, ['rev-parse', 'HEAD']);
  const trackedOutput = await execFileAsync(
    'git',
    ['-C', sourceRoot, 'ls-files', '-co', '--exclude-standard', '-z'],
    {encoding: 'utf8'},
  );
  const availableFiles = trackedOutput.stdout.split('\0').filter((file) => file.length > 0);
  return generateGuidanceBundle({
    sourceRoot,
    outputRoot,
    packageVersion,
    sourceCommit,
    availableFiles,
  });
}

export function verifyBundle(bundleRoot: string): Promise<GuidanceManifest> {
  return validateGeneratedBundle(bundleRoot);
}
