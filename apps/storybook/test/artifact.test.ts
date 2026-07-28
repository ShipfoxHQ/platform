import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vitest';
import {
  assertPreviewMetadata,
  defaultMaxFileBytes,
  validateStorybookDirectory,
} from '../scripts/artifact.js';

const temporaryDirectories: string[] = [];
const invalidPullRequestPattern = /invalid pullRequest|invalid pull request number/;

async function createFixture(
  index: Record<string, unknown> = {story: {type: 'story'}},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'shipfox-storybook-artifact-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<script src="./assets/app.js"></script>');
  await writeFile(join(root, 'iframe.html'), '<link href="./assets/app.css" rel="stylesheet">');
  await writeFile(join(root, 'index.json'), JSON.stringify({v: 5, entries: index}));
  await writeFile(join(root, 'assets/app.js'), 'export {};');
  await writeFile(join(root, 'assets/app.css'), 'body { color: black; }');
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, {recursive: true, force: true})),
  );
});

describe('Storybook artifact validation', () => {
  it('accepts a complete Storybook output and its local assets', async () => {
    const directory = await createFixture();

    await expect(
      validateStorybookDirectory({
        artifactRoot: directory,
        directory,
        label: 'fixture',
        maxFileBytes: defaultMaxFileBytes,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects an empty Storybook index', async () => {
    const directory = await createFixture({});

    await expect(
      validateStorybookDirectory({
        artifactRoot: directory,
        directory,
        label: 'fixture',
        maxFileBytes: defaultMaxFileBytes,
      }),
    ).rejects.toThrow('contains no stories or documentation entries');
  });

  it('rejects a missing local asset', async () => {
    const directory = await createFixture();
    await rm(join(directory, 'assets/app.js'));

    await expect(
      validateStorybookDirectory({
        artifactRoot: directory,
        directory,
        label: 'fixture',
        maxFileBytes: defaultMaxFileBytes,
      }),
    ).rejects.toThrow('missing local asset');
  });
});

describe('Storybook preview metadata', () => {
  it.each([
    '42',
    {number: 0, headSha: 'current-commit'},
    {number: 1.5, headSha: 'current-commit'},
  ])('rejects malformed pull request metadata %#', (pullRequest) => {
    expect(() =>
      assertPreviewMetadata({
        version: 1,
        commitSha: 'current-commit',
        buildTime: '2026-07-27T00:00:00.000Z',
        manifestVersion: 1,
        pullRequest,
        metrics: {
          shell: {fileCount: 0, bytes: 0, oversizedFiles: []},
          children: [],
          total: {fileCount: 0, bytes: 0, oversizedFiles: []},
        },
      }),
    ).toThrow(invalidPullRequestPattern);
  });

  it('rejects pull request metadata that points at another commit', () => {
    expect(() =>
      assertPreviewMetadata({
        version: 1,
        commitSha: 'current-commit',
        buildTime: '2026-07-27T00:00:00.000Z',
        manifestVersion: 1,
        pullRequest: {
          number: 42,
          title: null,
          url: null,
          headSha: 'older-commit',
          headRef: 'feature/preview',
          baseRef: 'main',
        },
        metrics: {
          shell: {fileCount: 0, bytes: 0, oversizedFiles: []},
          children: [],
          total: {fileCount: 0, bytes: 0, oversizedFiles: []},
        },
      }),
    ).toThrow('headSha older-commit does not match commitSha current-commit');
  });
});
