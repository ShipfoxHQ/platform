import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {storybookManifestVersion, storybooks} from '../preview-manifest.js';
import {
  assertPreviewMetadata,
  formatMetrics,
  getCommitShaFromEnv,
  getMaxFileBytes,
  type PreviewMetadata,
  validateStorybookDirectory,
  verifyPreviewArtifact,
} from './artifact.js';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(appRoot, '../..');
const shellOutput = resolve(appRoot, 'storybook-static');
const outputParent = appRoot;
const outputRoot = resolve(appRoot, 'storybook-output');

type StorybookIndex = {
  entries?: Record<string, Record<string, unknown>>;
};

async function writeCompositionCompatibilityFiles(directory: string): Promise<void> {
  const index = JSON.parse(
    await readFile(resolve(directory, 'index.json'), 'utf8'),
  ) as StorybookIndex;
  const entries = index.entries ?? {};
  const stories = Object.fromEntries(
    Object.values(entries).map((entry) => {
      if (typeof entry.id !== 'string')
        throw new Error(`Storybook entry in ${directory} is missing an id`);

      return [
        entry.id,
        {
          ...entry,
          kind: entry.title,
          story: entry.name,
          parameters: {fileName: entry.importPath},
        },
      ];
    }),
  );

  await writeFile(
    resolve(directory, 'stories.json'),
    `${JSON.stringify({v: 3, stories}, null, 2)}\n`,
    'utf8',
  );
  await writeFile(resolve(directory, 'metadata.json'), '{}\n', 'utf8');
}

async function writeCloudflarePagesRedirects(directory: string): Promise<void> {
  const redirects = storybooks.map(({id}) => `/${id}/* /${id}/index.html 200`).join('\n');
  await writeFile(resolve(directory, '_redirects'), `${redirects}\n`, 'utf8');
}

function getCommitSha(): string {
  const configuredSha = getCommitShaFromEnv();
  if (configuredSha !== undefined) return configuredSha;

  return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repositoryRoot, encoding: 'utf8'}).trim();
}

async function getGitHubEvent(): Promise<Record<string, unknown> | null> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath === undefined || eventPath.length === 0) return null;

  try {
    return JSON.parse(await readFile(eventPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getPullRequestNumber(event: Record<string, unknown> | null): number | null {
  const eventPullRequest = event?.pull_request;
  const eventNumber =
    typeof eventPullRequest === 'object' &&
    eventPullRequest !== null &&
    'number' in eventPullRequest
      ? (eventPullRequest as {number?: unknown}).number
      : undefined;
  const configuredNumber = process.env.CLOUDFLARE_PAGES_PR_NUMBER ?? process.env.GITHUB_PR_NUMBER;
  const number =
    eventNumber ?? (configuredNumber === undefined ? undefined : Number(configuredNumber));

  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : null;
}

async function getPullRequestMetadata(): Promise<PreviewMetadata['pullRequest']> {
  const event = await getGitHubEvent();
  const eventPullRequest = event?.pull_request;
  const pullRequest =
    typeof eventPullRequest === 'object' && eventPullRequest !== null
      ? (eventPullRequest as Record<string, unknown>)
      : null;
  const number = getPullRequestNumber(event);

  if (number === null) return null;

  const head =
    typeof pullRequest?.head === 'object' && pullRequest.head !== null
      ? (pullRequest.head as Record<string, unknown>)
      : null;
  const base =
    typeof pullRequest?.base === 'object' && pullRequest.base !== null
      ? (pullRequest.base as Record<string, unknown>)
      : null;

  return {
    number,
    title:
      typeof pullRequest?.title === 'string'
        ? pullRequest.title
        : (process.env.CLOUDFLARE_PAGES_PR_TITLE ?? null),
    url:
      typeof pullRequest?.html_url === 'string'
        ? pullRequest.html_url
        : (process.env.CLOUDFLARE_PAGES_PR_URL ?? null),
    headSha:
      typeof head?.sha === 'string'
        ? head.sha
        : process.env.CLOUDFLARE_PAGES_PR_HEAD_SHA || getCommitShaFromEnv() || null,
    headRef:
      typeof head?.ref === 'string'
        ? head.ref
        : (process.env.CLOUDFLARE_PAGES_PR_HEAD_REF ?? process.env.GITHUB_HEAD_REF ?? null),
    baseRef:
      typeof base?.ref === 'string'
        ? base.ref
        : (process.env.CLOUDFLARE_PAGES_PR_BASE_REF ?? process.env.GITHUB_BASE_REF ?? null),
  };
}

async function buildMetadata(metrics: PreviewMetadata['metrics']): Promise<PreviewMetadata> {
  return {
    version: 1,
    commitSha: getCommitSha(),
    buildTime: process.env.CLOUDFLARE_PAGES_BUILD_TIME ?? new Date().toISOString(),
    manifestVersion: storybookManifestVersion,
    pullRequest: await getPullRequestMetadata(),
    metrics,
  };
}

async function replaceOutputAtomically(stagedOutput: string): Promise<void> {
  const previousOutput = resolve(outputParent, `.storybook-output-previous-${randomUUID()}`);
  let movedPreviousOutput = false;

  try {
    await rename(outputRoot, previousOutput);
    movedPreviousOutput = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  try {
    await rename(stagedOutput, outputRoot);
  } catch (error) {
    if (movedPreviousOutput) await rename(previousOutput, outputRoot);
    throw error;
  }

  if (movedPreviousOutput) {
    try {
      await rm(previousOutput, {recursive: true, force: true});
    } catch (error) {
      process.stderr.write(
        `Warning: failed to remove previous preview output at ${previousOutput}: ${error instanceof Error ? error.message : error}\n`,
      );
    }
  }
}

async function main(): Promise<void> {
  const maxFileBytes = getMaxFileBytes();
  await mkdir(outputParent, {recursive: true});

  let stagedOutput: string | undefined;
  try {
    stagedOutput = await mkdtemp(resolve(outputParent, '.storybook-output-staging-'));
    const stagedStaticRoot = stagedOutput;

    await cp(shellOutput, stagedStaticRoot, {recursive: true});

    for (const entry of storybooks) {
      const source = resolve(repositoryRoot, entry.source);
      await validateStorybookDirectory({
        artifactRoot: source,
        directory: source,
        label: entry.id,
        maxFileBytes,
      });

      const destination = resolve(stagedStaticRoot, entry.id);
      await rm(destination, {recursive: true, force: true});
      await cp(source, destination, {recursive: true});
    }

    await writeCloudflarePagesRedirects(stagedStaticRoot);

    await writeCompositionCompatibilityFiles(stagedStaticRoot);
    for (const entry of storybooks) {
      await writeCompositionCompatibilityFiles(resolve(stagedStaticRoot, entry.id));
    }

    const metrics = await verifyPreviewArtifact({staticRoot: stagedStaticRoot, maxFileBytes});
    const metadata = await buildMetadata(metrics);
    assertPreviewMetadata(metadata);
    await writeFile(
      resolve(stagedStaticRoot, 'preview-metadata.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
      'utf8',
    );
    const verifiedMetrics = await verifyPreviewArtifact({
      staticRoot: stagedStaticRoot,
      maxFileBytes,
    });
    process.stdout.write(`Assembled Storybook artifact for Cloudflare Pages at ${outputRoot}\n`);
    process.stdout.write(`${formatMetrics(verifiedMetrics)}\n`);

    await replaceOutputAtomically(stagedOutput);
    stagedOutput = undefined;
  } finally {
    if (stagedOutput !== undefined) await rm(stagedOutput, {recursive: true, force: true});
  }
}

await main();
