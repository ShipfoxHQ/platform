import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workflowTool = resolve(
  packageDirectory,
  '../../../.github/scripts/package-release-workflow.mjs',
);
const authorizedPattern = /authorized=true/;
const createdPattern = /"result":"created"/;
const releasePattern = /revision=release/;
const releasePrPattern = /Release PR: #42/;
const reusableImagesSummaryPattern = /image bytes can be reused/;
const unavailableImagesPattern = /version_only_main=false/;
const unavailableImagesReasonPattern = /reason=prior-application-images-unavailable/;
const versionOnlyMainPattern = /version_only_main=true/;
const versionOnlyReleasePrPattern =
  /version_only_release_pr=https:\/\/github\.com\/ShipfoxHQ\/shipfox\/pull\/999/;
const versionOnlySummaryPattern = /version-only/;
const imageDigest = `sha256:${'a'.repeat(64)}`;

describe('package release workflow tool', () => {
  test('authorizes only merged release-App pull requests from the release branch', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-release-workflow-test-'));
    const outputPath = join(temporaryRoot, 'output');

    try {
      await execFileAsync('node', [
        workflowTool,
        'authorize',
        '--event-name',
        'pull_request',
        '--merged',
        'true',
        '--revision',
        'release',
        '--base',
        'base',
        '--head-repository',
        'ShipfoxHQ/shipfox',
        '--head-ref',
        'changeset-release/main',
        '--author-id',
        '123',
        '--repository',
        'ShipfoxHQ/shipfox',
        '--release-app-id',
        '123',
        '--github-output',
        outputPath,
      ]);

      assert.match(await readFile(outputPath, 'utf8'), authorizedPattern);
      assert.match(await readFile(outputPath, 'utf8'), releasePattern);
    } finally {
      await rm(temporaryRoot, {force: true, recursive: true});
    }
  });

  test('records whether a release PR was created, updated, or unchanged', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-release-workflow-test-'));
    const beforePath = join(temporaryRoot, 'before.json');
    const afterPath = join(temporaryRoot, 'after.json');
    const summaryPath = join(temporaryRoot, 'summary');
    try {
      await writeFile(beforePath, '[]');
      await writeFile(afterPath, '[{"number": 42, "headRefOid": "head"}]');

      const {stdout} = await execFileAsync('node', [
        workflowTool,
        'summarize-update',
        '--before',
        beforePath,
        '--after',
        afterPath,
        '--trigger',
        'revision',
        '--github-summary',
        summaryPath,
      ]);

      assert.match(stdout, createdPattern);
      assert.match(await readFile(summaryPath, 'utf8'), releasePrPattern);
    } finally {
      await rm(temporaryRoot, {force: true, recursive: true});
    }
  });

  test('classifies a main commit only after merged release metadata and tree verification', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-main-classification-test-'));
    const binDirectory = join(temporaryRoot, 'bin');
    const outputPath = join(temporaryRoot, 'output');
    const summaryPath = join(temporaryRoot, 'summary');
    const revision = '0123456789abcdef0123456789abcdef01234567';
    const previousRevision = 'fedcba9876543210fedcba9876543210fedcba98';
    const pullRequest = JSON.stringify([
      {
        base: {ref: 'main'},
        head: {ref: 'changeset-release/main', repo: {full_name: 'ShipfoxHQ/shipfox'}},
        html_url: 'https://github.com/ShipfoxHQ/shipfox/pull/999',
        merge_commit_sha: revision,
        merged_at: '2026-07-23T10:00:00Z',
        number: 999,
        user: {id: 123},
      },
    ]);

    try {
      await mkdir(binDirectory);
      await writeExecutable(
        join(binDirectory, 'git'),
        `#!/bin/sh\nprintf '%s\\n' '${previousRevision}'\n`,
      );
      await writeExecutable(
        join(binDirectory, 'gh'),
        `#!/bin/sh\nprintf '%s\\n' '${pullRequest}'\n`,
      );
      await writeExecutable(
        join(binDirectory, 'pnpm'),
        '#!/bin/sh\nprintf \'%s\\n\' \'{"classification":"generated-release","reason":"generated-tree-matches"}\'\n',
      );

      await execFileAsync(
        'node',
        [
          workflowTool,
          'classify-main',
          '--revision',
          revision,
          '--repository',
          'ShipfoxHQ/shipfox',
          '--release-app-id',
          '123',
          '--github-output',
          outputPath,
          '--github-summary',
          summaryPath,
        ],
        {env: {...process.env, PATH: `${binDirectory}:${process.env.PATH}`}},
      );

      const output = await readFile(outputPath, 'utf8');
      assert.match(output, versionOnlyMainPattern);
      assert.match(output, new RegExp(`version_only_previous_revision=${previousRevision}`));
      assert.match(output, versionOnlyReleasePrPattern);
      assert.match(await readFile(summaryPath, 'utf8'), versionOnlySummaryPattern);
    } finally {
      await rm(temporaryRoot, {force: true, recursive: true});
    }
  });

  test('keeps version-only CI when every prior application image is available', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-image-reuse-test-'));
    const binDirectory = join(temporaryRoot, 'bin');
    const outputPath = join(temporaryRoot, 'output');
    const summaryPath = join(temporaryRoot, 'summary');
    const revision = 'fedcba9876543210fedcba9876543210fedcba98';

    try {
      await mkdir(binDirectory);
      await writeExecutable(
        join(binDirectory, 'oras'),
        `#!/bin/sh\nprintf '%s\\n' '${imageDigest}'\n`,
      );

      await execFileAsync(
        'node',
        [
          workflowTool,
          'verify-image-reuse',
          '--revision',
          revision,
          '--image-repository',
          'ghcr.io/shipfoxhq/api',
          '--image-repository',
          'ghcr.io/shipfoxhq/client',
          '--github-output',
          outputPath,
          '--github-summary',
          summaryPath,
        ],
        {env: {...process.env, PATH: `${binDirectory}:${process.env.PATH}`}},
      );

      assert.match(await readFile(outputPath, 'utf8'), versionOnlyMainPattern);
      assert.match(await readFile(summaryPath, 'utf8'), reusableImagesSummaryPattern);
    } finally {
      await rm(temporaryRoot, {force: true, recursive: true});
    }
  });

  test('falls back to normal CI when a prior application image is unavailable', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-image-reuse-test-'));
    const binDirectory = join(temporaryRoot, 'bin');
    const outputPath = join(temporaryRoot, 'output');
    const summaryPath = join(temporaryRoot, 'summary');
    const revision = 'fedcba9876543210fedcba9876543210fedcba98';
    const unavailableReference = `ghcr.io/shipfoxhq/client:revision-${revision}`;

    try {
      await mkdir(binDirectory);
      await writeExecutable(
        join(binDirectory, 'oras'),
        `#!/bin/sh
if [ "$2" = "${unavailableReference}" ]; then
  exit 1
fi
printf '%s\\n' '${imageDigest}'
`,
      );

      await execFileAsync(
        'node',
        [
          workflowTool,
          'verify-image-reuse',
          '--revision',
          revision,
          '--image-repository',
          'ghcr.io/shipfoxhq/api',
          '--image-repository',
          'ghcr.io/shipfoxhq/client',
          '--github-output',
          outputPath,
          '--github-summary',
          summaryPath,
        ],
        {env: {...process.env, PATH: `${binDirectory}:${process.env.PATH}`}},
      );

      const output = await readFile(outputPath, 'utf8');
      assert.match(output, unavailableImagesPattern);
      assert.match(output, unavailableImagesReasonPattern);
      assert.match(await readFile(summaryPath, 'utf8'), new RegExp(unavailableReference));
    } finally {
      await rm(temporaryRoot, {force: true, recursive: true});
    }
  });

  test('falls back to normal CI when a resolved image digest is malformed', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-image-reuse-test-'));
    const binDirectory = join(temporaryRoot, 'bin');
    const outputPath = join(temporaryRoot, 'output');
    const summaryPath = join(temporaryRoot, 'summary');
    const revision = 'fedcba9876543210fedcba9876543210fedcba98';
    const imageReference = `ghcr.io/shipfoxhq/api:revision-${revision}`;

    try {
      await mkdir(binDirectory);
      await writeExecutable(
        join(binDirectory, 'oras'),
        "#!/bin/sh\nprintf '%s\\n' 'sha256:not-an-immutable-digest'\n",
      );

      await execFileAsync(
        'node',
        [
          workflowTool,
          'verify-image-reuse',
          '--revision',
          revision,
          '--image-repository',
          'ghcr.io/shipfoxhq/api',
          '--github-output',
          outputPath,
          '--github-summary',
          summaryPath,
        ],
        {env: {...process.env, PATH: `${binDirectory}:${process.env.PATH}`}},
      );

      const output = await readFile(outputPath, 'utf8');
      assert.match(output, unavailableImagesPattern);
      assert.match(output, unavailableImagesReasonPattern);
      assert.match(await readFile(summaryPath, 'utf8'), new RegExp(imageReference));
    } finally {
      await rm(temporaryRoot, {force: true, recursive: true});
    }
  });

  test.each([
    {
      arguments: ['--revision', 'invalid-revision', '--image-repository', 'ghcr.io/shipfoxhq/api'],
      reason: 'prior-image-revision-invalid',
      scenario: 'the prior revision is invalid',
    },
    {
      arguments: ['--revision', 'fedcba9876543210fedcba9876543210fedcba98'],
      reason: 'application-image-repositories-missing',
      scenario: 'no image repositories are provided',
    },
  ])('falls back to normal CI when $scenario', async ({arguments: commandArguments, reason}) => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-image-reuse-test-'));
    const outputPath = join(temporaryRoot, 'output');
    const summaryPath = join(temporaryRoot, 'summary');

    try {
      await execFileAsync('node', [
        workflowTool,
        'verify-image-reuse',
        ...commandArguments,
        '--github-output',
        outputPath,
        '--github-summary',
        summaryPath,
      ]);

      const output = await readFile(outputPath, 'utf8');
      assert.match(output, unavailableImagesPattern);
      assert.ok(output.includes(`reason=${reason}`));
      assert.ok(!(await readFile(summaryPath, 'utf8')).includes('Unavailable image references:'));
    } finally {
      await rm(temporaryRoot, {force: true, recursive: true});
    }
  });
});

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content);
  await chmod(path, 0o755);
}
