import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

export type DocumentationViolation =
  | {
      kind: 'broken-link';
      source: string;
      line: number;
      target: string;
      reason: string;
    }
  | {
      kind: 'missing-anchor';
      source: string;
      line: number;
      target: string;
      reason: string;
    }
  | {
      kind: 'orphan';
      file: string;
      reason: string;
    };

export interface DocumentationCheckResult {
  checkedFiles: string[];
  violations: DocumentationViolation[];
}

export interface MarkdownLink {
  line: number;
  target: string;
}

/**
 * These scope rules keep repository documentation separate from product-doc
 * validation and generated release output. The paths are intentionally
 * explicit so adding a new exception requires changing this policy.
 */
export const excludedDocumentationPaths = [
  {path: '.agents/skills/', reason: 'Agent skills own their provider-specific documentation.'},
  {path: '.claude/skills/', reason: 'Claude skills own their provider-specific documentation.'},
  {path: '.changeset/', reason: 'Changeset files are release metadata.'},
  {path: '.context/', reason: 'Workspace collaboration files are local state.'},
  {path: '.github/skills/', reason: 'GitHub skills own their provider-specific documentation.'},
  {path: 'apps/docs/WRITING.md', reason: 'The docs app owns its surface-specific writing guide.'},
  {path: 'apps/docs/content/', reason: 'The docs app owns product documentation links.'},
  {path: '**/CHANGELOG.md', reason: 'Changelogs are generated release output.'},
  {
    path: 'libs/client/shell/test/external/FINDINGS.md',
    reason: 'External-consumer fixture findings are test artifacts.',
  },
] as const;

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const entrypointFiles = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'DESIGN.md',
  'README.md',
  'SECURITY.md',
  'WRITING.md',
  'docs/README.md',
  'docs/adr/README.md',
]);

export const guidanceRootEntrypoints = [
  'AGENTS.md',
  'CONTRIBUTING.md',
  'WRITING.md',
  'DESIGN.md',
] as const;

export type GuidanceFileKind =
  | 'agent-skill'
  | 'adr'
  | 'architecture'
  | 'documentation-map'
  | 'entrypoint'
  | 'guide'
  | 'package'
  | 'policy'
  | 'subsystem';

export function guidanceFileKind(relativePath: string): GuidanceFileKind {
  if (relativePath === 'docs/README.md') return 'documentation-map';
  if (isGuidanceRootEntrypoint(relativePath)) return 'entrypoint';
  if (relativePath.startsWith('docs/architecture/')) return 'architecture';
  if (relativePath.startsWith('docs/adr/')) return 'adr';
  if (relativePath.startsWith('docs/policies/')) return 'policy';
  if (relativePath.startsWith('docs/guides/')) return 'guide';
  if (relativePath.startsWith('.agents/skills/')) return 'agent-skill';
  if (path.posix.basename(relativePath) === 'README.md') return 'package';
  return 'subsystem';
}

export function isGuidanceRootEntrypoint(relativePath: string): boolean {
  return guidanceRootEntrypoints.includes(relativePath as (typeof guidanceRootEntrypoints)[number]);
}

const excludedDirectoryNames = new Set([
  '.changeset',
  '.context',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'node_modules',
  'storybook-output',
  'storybook-static',
]);
const generatedStorybookDirectoryPattern = /^\.storybook-output-(?:previous|staging)-/u;
const markdownExtension = '.md';
const markdownLinkPattern = /!?(?:\[[^\]\n]*\])\(([^)\n]+)\)/g;
const markdownLinkTargetPattern = /^\S+/;
const externalLinkPattern = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
const atxHeadingPattern = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const setextHeadingPattern = /^ {0,3}(?:=+|-+)\s*$/;
const fencePattern = /^\s{0,3}(`{3,}|~{3,})/;

export async function checkRepositoryDocumentation(
  rootDirectory = repositoryRoot,
): Promise<DocumentationCheckResult> {
  const checkedFiles = await collectDocumentationFiles(rootDirectory);
  const contents = new Map<string, string>(
    await Promise.all(
      checkedFiles.map(
        async (file) => [file, await readFile(path.join(rootDirectory, file), 'utf8')] as const,
      ),
    ),
  );
  const anchorsByFile = new Map<string, Set<string>>(
    checkedFiles.map((file) => [file, anchorsFor(contents.get(file) ?? '')] as const),
  );
  const checkedFileSet = new Set(checkedFiles);
  const edges = new Map<string, Set<string>>();
  const violations: DocumentationViolation[] = [];

  for (const source of checkedFiles) {
    edges.set(
      source,
      await checkDocumentationFile({
        anchorsByFile,
        checkedFileSet,
        content: contents.get(source) ?? '',
        rootDirectory,
        source,
        violations,
      }),
    );
  }

  const reachable = reachableFiles(edges, checkedFiles.filter(isApprovedRoot));
  for (const file of checkedFiles) {
    if (!reachable.has(file) && !isApprovedRoot(file)) {
      violations.push({
        kind: 'orphan',
        file,
        reason:
          'No approved entrypoint or documentation index links to this file. Add a contextual link from docs/README.md or the owning subsystem index.',
      });
    }
  }

  return {checkedFiles, violations};
}

interface DocumentationFileCheckOptions {
  anchorsByFile: ReadonlyMap<string, Set<string>>;
  checkedFileSet: Set<string>;
  content: string;
  rootDirectory: string;
  source: string;
  violations: DocumentationViolation[];
}

async function checkDocumentationFile(
  options: DocumentationFileCheckOptions,
): Promise<Set<string>> {
  const {checkedFileSet, content, rootDirectory, source, violations} = options;
  const sourceEdges = new Set<string>();
  for (const link of extractMarkdownLinks(content)) {
    const parsedTarget = parseTarget(link.target);
    if (parsedTarget.kind === 'ignored') continue;
    if (parsedTarget.kind === 'invalid') {
      violations.push({
        kind: 'broken-link',
        source,
        line: link.line,
        target: link.target,
        reason: parsedTarget.reason,
      });
      continue;
    }
    const targetFile = parsedTarget.path
      ? await resolveDocumentationTarget(rootDirectory, source, parsedTarget.path)
      : source;
    if (!targetFile) {
      violations.push({
        kind: 'broken-link',
        source,
        line: link.line,
        target: link.target,
        reason: 'target does not exist',
      });
      continue;
    }
    await checkDocumentationAnchor(options, link, parsedTarget.anchor, targetFile);
    if (checkedFileSet.has(targetFile)) sourceEdges.add(targetFile);
  }
  return sourceEdges;
}

async function checkDocumentationAnchor(
  options: DocumentationFileCheckOptions,
  link: MarkdownLink,
  anchor: string | null,
  targetFile: string,
): Promise<void> {
  const {anchorsByFile, checkedFileSet, rootDirectory, source, violations} = options;
  if (!anchor || !shouldCheckAnchor(targetFile, checkedFileSet)) return;
  let targetAnchors = anchorsByFile.get(targetFile);
  if (targetFile === source) targetAnchors = anchorsByFile.get(source);
  if (!targetAnchors) {
    targetAnchors = anchorsFor(await readFile(path.join(rootDirectory, targetFile), 'utf8'));
  }
  if (targetAnchors.has(anchor)) return;
  violations.push({
    kind: 'missing-anchor',
    source,
    line: link.line,
    target: link.target,
    reason: 'target heading does not exist',
  });
}

export async function collectDocumentationFiles(rootDirectory: string): Promise<string[]> {
  const files = await filesUnder(rootDirectory);
  return files
    .filter((file) => isIncludedDocumentationPath(toRepositoryPath(rootDirectory, file)))
    .map((file) => toRepositoryPath(rootDirectory, file))
    .sort();
}

export function extractMarkdownLinks(content: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const source = withoutFencedCode(content);

  for (const match of source.matchAll(markdownLinkPattern)) {
    const rawTarget = match[1]?.trim();
    if (!rawTarget) continue;

    const target = rawTarget.startsWith('<')
      ? rawTarget.slice(1, rawTarget.indexOf('>'))
      : rawTarget.match(markdownLinkTargetPattern)?.[0];
    if (!target) continue;

    links.push({line: lineNumberAt(source, match.index ?? 0), target});
  }

  return links;
}

function isIncludedDocumentationPath(relativePath: string): boolean {
  if (!relativePath.endsWith(markdownExtension)) return false;
  return !excludedDocumentationPaths.some(({path: excludedPath}) => {
    if (excludedPath === '**/CHANGELOG.md')
      return relativePath.endsWith('/CHANGELOG.md') || relativePath === 'CHANGELOG.md';
    if (excludedPath.endsWith('/')) return relativePath.startsWith(excludedPath);
    return relativePath === excludedPath;
  });
}

function isApprovedRoot(relativePath: string): boolean {
  return entrypointFiles.has(relativePath) || path.posix.basename(relativePath) === 'README.md';
}

function parseTarget(
  target: string,
):
  | {kind: 'ignored'}
  | {kind: 'invalid'; reason: string}
  | {kind: 'relative'; path: string; anchor: string | null} {
  if (externalLinkPattern.test(target) || target.startsWith('/')) return {kind: 'ignored'};

  const [rawPath, rawAnchor] = target.split('#', 2);
  let decodedPath = rawPath ?? '';
  let decodedAnchor = rawAnchor ?? '';
  try {
    decodedPath = decodeURIComponent(decodedPath);
    decodedAnchor = decodeURIComponent(decodedAnchor);
  } catch {
    return {kind: 'invalid', reason: 'target contains invalid percent encoding'};
  }

  return {
    kind: 'relative',
    path: decodedPath,
    anchor: decodedAnchor ? decodedAnchor.toLowerCase() : null,
  };
}

async function resolveDocumentationTarget(
  rootDirectory: string,
  source: string,
  target: string,
): Promise<string | null> {
  const sourceDirectory = path.dirname(path.join(rootDirectory, source));
  const candidate = path.resolve(sourceDirectory, target);
  const root = path.resolve(rootDirectory);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;

  const candidates = [candidate];
  if (path.extname(candidate) === '') {
    candidates.push(`${candidate}.md`, `${candidate}.mdx`, path.join(candidate, 'README.md'));
  } else if (await isDirectory(candidate)) {
    candidates.push(path.join(candidate, 'README.md'));
  }

  for (const possibleTarget of candidates) {
    if (await isFile(possibleTarget)) return toRepositoryPath(rootDirectory, possibleTarget);
  }
  if (await isDirectory(candidate)) return toRepositoryPath(rootDirectory, candidate);
  return null;
}

function shouldCheckAnchor(targetFile: string, checkedFiles: Set<string>): boolean {
  return checkedFiles.has(targetFile) && !targetFile.startsWith('apps/docs/content/');
}

function reachableFiles(edges: Map<string, Set<string>>, roots: string[]): Set<string> {
  const reachable = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    for (const target of edges.get(current) ?? []) pending.push(target);
  }
  return reachable;
}

function anchorsFor(content: string): Set<string> {
  const anchors = new Set<string>();
  const usedSlugs = new Map<string, number>();
  const lines = withoutFencedCode(content).split('\n');

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

function slugifyHeading(heading: string): string {
  return heading
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[\u0060*_~]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function withoutFencedCode(content: string): string {
  const lines = content.split('\n');
  let inFence = false;
  return lines
    .map((line) => {
      if (fencePattern.test(line)) {
        inFence = !inFence;
        return '';
      }
      return inFence ? '' : line;
    })
    .join('\n');
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = await Promise.all(
    entries.map((entry) => {
      if (entry.isDirectory()) {
        if (
          excludedDirectoryNames.has(entry.name) ||
          generatedStorybookDirectoryPattern.test(entry.name)
        )
          return [];
        return filesUnder(path.join(directory, entry.name));
      }
      return [path.join(directory, entry.name)];
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

function toRepositoryPath(rootDirectory: string, file: string): string {
  return path.relative(rootDirectory, file).split(path.sep).join('/');
}

function formatViolation(violation: DocumentationViolation): string {
  if (violation.kind === 'orphan') {
    return `- ${violation.file}: ${violation.reason}`;
  }
  return `- ${violation.source}:${violation.line} -> ${violation.target}: ${violation.reason}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkRepositoryDocumentation();
  if (result.violations.length > 0) {
    process.stderr.write(
      `Repository documentation validation failed:\n${result.violations.map(formatViolation).join('\n')}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Repository documentation validation passed (${result.checkedFiles.length} files).\n`,
    );
  }
}
