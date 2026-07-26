import {readdir, readFile, stat} from 'node:fs/promises';
import {dirname, extname, relative, resolve, sep} from 'node:path';
import {storybookManifestVersion, storybooks} from '../preview-manifest.js';

// Cloudflare Pages Direct Upload currently rejects files larger than 25 MiB.
// Keep the local gate aligned with the hosting limit so a bad artifact fails
// before credentials are used for an upload.
export const defaultMaxFileBytes = 25 * 1024 * 1024;

type FileMetric = {
  path: string;
  bytes: number;
};

export type ArtifactMetrics = {
  fileCount: number;
  bytes: number;
  oversizedFiles: FileMetric[];
};

export type StorybookMetrics = ArtifactMetrics & {
  id: string;
};

export type PreviewArtifactMetrics = {
  shell: ArtifactMetrics;
  children: StorybookMetrics[];
  total: ArtifactMetrics;
};

type ValidateStorybookDirectoryOptions = {
  artifactRoot: string;
  directory: string;
  label: string;
  maxFileBytes: number;
};

type VerifyPreviewArtifactOptions = {
  maxFileBytes?: number;
  staticRoot: string;
};

const requiredFiles = ['index.html', 'iframe.html', 'index.json'] as const;
const protocolPattern = /^[a-z][a-z\d+.-]*:/i;
const queryOrHashPattern = /[?#]/;
const styleBlockPattern = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const scriptBlockPattern = /(<script\b[^>]*>)[\s\S]*?<\/script>/gi;

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, {withFileTypes: true});
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = resolve(current, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, entryPath)));
      continue;
    }

    if (entry.isFile()) files.push(relative(root, entryPath));
  }

  return files;
}

async function collectMetrics(
  root: string,
  artifactRoot: string,
  maxFileBytes: number,
  excludedPrefixes: string[] = [],
  excludedFiles: string[] = [],
): Promise<ArtifactMetrics> {
  const files = await walkFiles(root);
  let bytes = 0;
  let fileCount = 0;
  const oversizedFiles: FileMetric[] = [];

  for (const file of files) {
    const normalizedFile = file.split(sep).join('/');
    const isExcluded =
      excludedFiles.includes(normalizedFile) ||
      excludedPrefixes.some(
        (prefix) => normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`),
      );

    if (isExcluded) continue;

    const filePath = resolve(root, file);
    const fileStats = await stat(filePath);
    const artifactPath = relative(artifactRoot, filePath).split(sep).join('/');

    fileCount += 1;
    bytes += fileStats.size;
    if (fileStats.size > maxFileBytes)
      oversizedFiles.push({path: artifactPath, bytes: fileStats.size});
  }

  return {fileCount, bytes, oversizedFiles};
}

function shouldSkipReference(reference: string): boolean {
  return (
    reference.length === 0 ||
    reference.startsWith('#') ||
    reference.startsWith('//') ||
    reference.startsWith('data:') ||
    reference.startsWith('blob:') ||
    reference.startsWith('mailto:') ||
    protocolPattern.test(reference)
  );
}

function resolveLocalReference(
  reference: string,
  sourceFile: string,
  staticRoot: string,
): string | null {
  const trimmedReference = reference.trim();
  if (shouldSkipReference(trimmedReference)) return null;

  const pathOnly = trimmedReference.split(queryOrHashPattern, 1)[0];
  if (pathOnly === undefined || pathOnly.length === 0) return null;

  const candidate = pathOnly.startsWith('/')
    ? resolve(staticRoot, `.${pathOnly}`)
    : resolve(dirname(sourceFile), pathOnly);

  if (!isWithin(staticRoot, candidate)) {
    throw new Error(`local asset reference escapes the artifact: ${trimmedReference}`);
  }

  return candidate;
}

function findAssetReferences(content: string, includeCssUrls: boolean): string[] {
  const references = new Set<string>();
  const attributePattern = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  const cssPattern = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  const markupContent = includeCssUrls ? content : content.replace(scriptBlockPattern, '$1');

  for (const match of markupContent.matchAll(attributePattern)) {
    if (match[1] !== undefined) references.add(match[1]);
  }

  if (includeCssUrls) {
    for (const match of content.matchAll(cssPattern)) {
      if (match[1] !== undefined) references.add(match[1]);
    }
  } else {
    for (const styleBlock of content.matchAll(styleBlockPattern)) {
      const styleContent = styleBlock[1];
      if (styleContent === undefined) continue;

      for (const match of styleContent.matchAll(cssPattern)) {
        if (match[1] !== undefined) references.add(match[1]);
      }
    }
  }

  return [...references];
}

async function validateReferencedAssets(directory: string, staticRoot: string): Promise<void> {
  const files = await walkFiles(directory);
  const filesToScan = files.filter((file) =>
    ['.html', '.css'].includes(extname(file).toLowerCase()),
  );

  for (const file of filesToScan) {
    const sourceFile = resolve(directory, file);
    const content = await readFile(sourceFile, 'utf8');

    for (const reference of findAssetReferences(content, extname(file).toLowerCase() === '.css')) {
      const assetPath = resolveLocalReference(reference, sourceFile, staticRoot);
      if (assetPath === null) continue;

      let assetExists = false;
      try {
        assetExists = (await stat(assetPath)).isFile();
      } catch {
        assetExists = false;
      }

      if (!assetExists) {
        const source = relative(staticRoot, sourceFile).split(sep).join('/');
        throw new Error(`missing local asset ${reference} referenced by ${source}`);
      }
    }
  }
}

export async function validateStorybookDirectory(
  options: ValidateStorybookDirectoryOptions,
): Promise<void> {
  const {artifactRoot, directory, label, maxFileBytes} = options;

  for (const file of requiredFiles) {
    const filePath = resolve(directory, file);
    let fileStats: Awaited<ReturnType<typeof stat>>;

    try {
      fileStats = await stat(filePath);
    } catch {
      throw new Error(`${label} is missing required ${file}`);
    }

    if (!fileStats.isFile() || fileStats.size === 0) {
      throw new Error(`${label} has an empty or invalid ${file}`);
    }
  }

  let index: unknown;
  try {
    index = JSON.parse(await readFile(resolve(directory, 'index.json'), 'utf8'));
  } catch (error) {
    throw new Error(
      `${label} has an invalid index.json: ${error instanceof Error ? error.message : error}`,
    );
  }

  const entries =
    typeof index === 'object' && index !== null && 'entries' in index
      ? (index as {entries?: unknown}).entries
      : undefined;

  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    throw new Error(`${label} index.json does not contain an entries object`);
  }

  if (Object.keys(entries).length === 0) {
    throw new Error(`${label} index.json contains no stories or documentation entries`);
  }

  await validateReferencedAssets(directory, artifactRoot);

  const metrics = await collectMetrics(directory, artifactRoot, maxFileBytes);
  if (metrics.oversizedFiles.length > 0) {
    const files = metrics.oversizedFiles
      .map(({path, bytes}) => `${path} (${bytes} bytes)`)
      .join(', ');
    throw new Error(`${label} contains files over ${maxFileBytes} bytes: ${files}`);
  }
}

function combineMetrics(metrics: ArtifactMetrics[]): ArtifactMetrics {
  return {
    fileCount: metrics.reduce((total, metric) => total + metric.fileCount, 0),
    bytes: metrics.reduce((total, metric) => total + metric.bytes, 0),
    oversizedFiles: metrics.flatMap((metric) => metric.oversizedFiles),
  };
}

function formatValidationFailures(failures: string[]): string {
  return [
    'Storybook preview verification failed:',
    ...failures.map((failure) => `- ${failure}`),
  ].join('\n');
}

export async function verifyPreviewArtifact(
  options: VerifyPreviewArtifactOptions,
): Promise<PreviewArtifactMetrics> {
  const maxFileBytes = options.maxFileBytes ?? defaultMaxFileBytes;
  const failures: string[] = [];

  try {
    await validateStorybookDirectory({
      artifactRoot: options.staticRoot,
      directory: options.staticRoot,
      label: 'Composition shell',
      maxFileBytes,
    });
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  for (const entry of storybooks) {
    try {
      await validateStorybookDirectory({
        artifactRoot: options.staticRoot,
        directory: resolve(options.staticRoot, entry.id),
        label: entry.id,
        maxFileBytes,
      });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length > 0) throw new Error(formatValidationFailures(failures));

  const shell = await collectMetrics(
    options.staticRoot,
    options.staticRoot,
    maxFileBytes,
    storybooks.map(({id}) => id),
    ['preview-metadata.json'],
  );
  const children = await Promise.all(
    storybooks.map(
      async (entry): Promise<StorybookMetrics> => ({
        id: entry.id,
        ...(await collectMetrics(
          resolve(options.staticRoot, entry.id),
          options.staticRoot,
          maxFileBytes,
        )),
      }),
    ),
  );
  const total = combineMetrics([shell, ...children]);

  if (total.oversizedFiles.length > 0) {
    const files = total.oversizedFiles
      .map(({path, bytes}) => `${path} (${bytes} bytes)`)
      .join(', ');
    throw new Error(`Storybook preview contains files over ${maxFileBytes} bytes: ${files}`);
  }

  return {shell, children, total};
}

const commitShaEnvironmentVariables = ['CLOUDFLARE_PAGES_COMMIT_SHA', 'GITHUB_SHA'] as const;

export function getCommitShaFromEnv(): string | undefined {
  return commitShaEnvironmentVariables
    .map((name) => process.env[name])
    .find((value) => value !== undefined && value !== '');
}

export function getMaxFileBytes(): number {
  const configuredValue = process.env.STORYBOOK_PREVIEW_MAX_FILE_BYTES;
  if (configuredValue === undefined) return defaultMaxFileBytes;

  const maxFileBytes = Number(configuredValue);
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    throw new Error('STORYBOOK_PREVIEW_MAX_FILE_BYTES must be a positive integer');
  }

  return maxFileBytes;
}

export type PreviewMetadata = {
  version: 1;
  commitSha: string;
  buildTime: string;
  manifestVersion: typeof storybookManifestVersion;
  pullRequest: {
    number: number;
    title: string | null;
    url: string | null;
    headSha: string | null;
    headRef: string | null;
    baseRef: string | null;
  } | null;
  metrics: PreviewArtifactMetrics;
};

export function assertPreviewMetadata(
  metadata: unknown,
  expectedCommitSha?: string,
): asserts metadata is PreviewMetadata {
  if (typeof metadata !== 'object' || metadata === null) {
    throw new Error('preview-metadata.json must contain an object');
  }

  const candidate = metadata as Partial<PreviewMetadata>;
  if (candidate.version !== 1) throw new Error('preview-metadata.json has an unsupported version');
  if (typeof candidate.commitSha !== 'string' || candidate.commitSha.length === 0) {
    throw new Error('preview-metadata.json is missing commitSha');
  }
  if (candidate.manifestVersion !== storybookManifestVersion) {
    throw new Error('preview-metadata.json has an unsupported manifestVersion');
  }
  if (typeof candidate.buildTime !== 'string' || Number.isNaN(Date.parse(candidate.buildTime))) {
    throw new Error('preview-metadata.json has an invalid buildTime');
  }
  if (expectedCommitSha !== undefined && candidate.commitSha !== expectedCommitSha) {
    throw new Error(
      `preview-metadata.json commitSha ${candidate.commitSha} does not match expected ${expectedCommitSha}`,
    );
  }
}

export function formatMetrics(metrics: PreviewArtifactMetrics): string {
  return JSON.stringify(metrics, null, 2);
}
