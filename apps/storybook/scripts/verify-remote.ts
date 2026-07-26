import {storybookManifest} from '../preview-manifest.js';
import {assertPreviewMetadata} from './artifact.js';

const previewUrl = requiredEnvironment('PREVIEW_URL').replace(/\/$/, '');
const expectedCommitSha = requiredEnvironment('PREVIEW_COMMIT_SHA');
const expectedPullRequest = process.env.PREVIEW_PR_NUMBER;

type StorybookIndex = {
  entries?: Record<string, unknown>;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function getUrl(path: string): string {
  return new URL(path, `${previewUrl}/`).toString();
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(getUrl(path), {
        signal: AbortSignal.timeout(30_000),
        headers: {accept: 'application/json'},
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(attempt * 2_000);
    }
  }

  throw new Error(
    `Failed to fetch ${path}: ${lastError instanceof Error ? lastError.message : lastError}`,
  );
}

async function main(): Promise<void> {
  const rootResponse = await fetch(getUrl('/'), {
    signal: AbortSignal.timeout(30_000),
    redirect: 'follow',
  });
  if (!rootResponse.ok) throw new Error(`Preview root returned ${rootResponse.status}`);

  const metadata = await fetchJson<unknown>('/preview-metadata.json');
  assertPreviewMetadata(metadata, expectedCommitSha);
  if (
    expectedPullRequest !== undefined &&
    expectedPullRequest.length > 0 &&
    metadata.pullRequest?.number !== Number(expectedPullRequest)
  ) {
    throw new Error(`Preview metadata does not match pull request ${expectedPullRequest}`);
  }

  for (const {id} of storybookManifest) {
    const index = await fetchJson<StorybookIndex>(`/${id}/index.json`);
    if (index.entries === undefined || Object.keys(index.entries).length === 0) {
      throw new Error(`Deployed child ${id} has no Storybook entries`);
    }
    process.stdout.write(`Verified ${previewUrl}/${id}/index.json\n`);
  }

  process.stdout.write(
    `Verified ${previewUrl}: root, metadata, and ${storybookManifest.length} child Storybook indexes\n`,
  );
}

await main();
