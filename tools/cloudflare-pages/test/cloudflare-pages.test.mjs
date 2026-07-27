import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {runCommand} from '../dist/deploy.js';
import {
  assertCurrentCommit,
  buildCloudflarePagesApps,
  createCloudflarePagesPlan,
  createGitHubDeployment,
  createGitHubDeployments,
  deployCloudflarePages,
  deployCloudflarePagesApps,
  finishGitHubDeployment,
  finishGitHubDeployments,
  getWorkflowQueueSeconds,
  readCloudflarePagesConfig,
  resolvePagesBranch,
  verifyCloudflarePagesApps,
  verifyPagesDeployment,
} from '../dist/index.js';

const headMovedPattern = /no longer current/;
const timeoutPattern = /timed out after 20ms/;
const missingCiEnvironmentPattern = /missing CI environment variable PREVIEW_SENTRY_DSN/;
const missingPullRequestPattern = /pull request number is required/;
const productionBranchPattern = /production branch is production, expected main/;
const invalidEndpointConfigurationPattern = /endpoints must define paths/;
const validationOkPattern = /validation_ok=true/;
const unsafeAppIdPattern = /not safe/;
const workingDirectoryArchivePattern = /cannot contain the working directory/;
const emptyArchiveSelectionPattern = /No applications were selected/;
const partialDeploymentPattern = /other: Cloudflare Pages Direct Upload failed/;
const archivedWorkerPattern = /contains executable Pages worker code/;
const invalidPullRequestLifecyclePattern = /not an open pull request targeting main/;
const cliPath = fileURLToPath(new URL('../bin/cloudflare-pages.js', import.meta.url));
const execFileAsync = promisify(execFile);
const exampleApps = [
  {
    id: 'example',
    target: '@shipfox/example',
    directory: 'dist/example',
    project: 'example',
    verify: {metadataPath: '/preview-metadata.json', endpoints: ['/index.json']},
  },
  {
    id: 'other',
    target: '@shipfox/other',
    directory: 'dist/other',
    project: 'other',
    verify: {metadataPath: '/preview-metadata.json', endpoints: ['/index.json']},
  },
];

function runCli(args, cwd) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd,
    env: {...process.env},
  });
}

test('plans a Pages deployment from affected targets and forced paths', () => {
  const plan = createCloudflarePagesPlan({
    apps: exampleApps,
    forcePaths: ['.github/workflows/preview.yml'],
    eventName: 'pull_request',
    affectedPackages: ['@shipfox/example', '@shipfox/unrelated'],
    changedFiles: ['libs/example/src/index.ts'],
  });

  assert.equal(plan.shouldDeploy, true);
  assert.deepEqual(plan.affectedTargets, ['@shipfox/example']);
  assert.deepEqual(plan.affectedApps, ['example']);
  assert.deepEqual(plan.selectedApps, ['example']);
  assert.equal(plan.reason, 'Turbo affected Pages target detected');
});

test('forces a Pages deployment when a configured path changes', () => {
  const plan = createCloudflarePagesPlan({
    apps: exampleApps,
    forcePaths: ['.github/workflows/preview.yml'],
    eventName: 'pull_request',
    affectedPackages: [],
    changedFiles: ['.github/workflows/preview.yml'],
  });

  assert.equal(plan.shouldDeploy, true);
  assert.equal(plan.reason, 'Pages workflow or application configuration changed');
  assert.deepEqual(plan.selectedApps, ['example', 'other']);
});

test('selects every configured app for a main push', () => {
  const plan = createCloudflarePagesPlan({
    apps: exampleApps,
    forcePaths: [],
    eventName: 'push',
    affectedPackages: [],
    changedFiles: [],
  });

  assert.deepEqual(plan.selectedApps, ['example', 'other']);
});

test('selects every configured app for an explicit deployment', () => {
  const plan = createCloudflarePagesPlan({
    apps: exampleApps,
    forcePaths: [],
    eventName: 'deployment',
    affectedPackages: [],
    changedFiles: [],
  });

  assert.equal(plan.shouldDeploy, true);
  assert.equal(plan.reason, 'explicit deployment');
  assert.deepEqual(plan.selectedApps, ['example', 'other']);
});

test('selects a composed app when one of its affected targets changes', () => {
  const plan = createCloudflarePagesPlan({
    apps: [{...exampleApps[0], affectedTargets: ['@shipfox/example-child']}],
    forcePaths: [],
    eventName: 'pull_request',
    affectedPackages: ['@shipfox/example-child'],
    changedFiles: ['libs/example-child/src/index.ts'],
  });

  assert.deepEqual(plan.affectedApps, ['example']);
  assert.deepEqual(plan.selectedApps, ['example']);
});

test('rejects invalid endpoint verification configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shipfox-cloudflare-pages-config-'));
  try {
    for (const endpoint of [
      {path: '/index.json', id: ''},
      {path: '/index.json', requireNonEmpty: 'yes'},
    ]) {
      await writeFile(
        join(directory, 'config.json'),
        JSON.stringify({
          apps: [
            {
              id: 'example',
              target: '@shipfox/example',
              directory: 'dist/example',
              project: 'example',
              verify: {endpoints: [endpoint]},
            },
          ],
        }),
      );
      await assert.rejects(
        readCloudflarePagesConfig('config.json', directory),
        invalidEndpointConfigurationPattern,
      );
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('rejects invalid artifact and validation configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shipfox-cloudflare-pages-config-'));
  try {
    for (const invalidConfig of [
      {artifact: []},
      {artifact: {metadataPath: ''}},
      {validation: []},
      {validation: {command: ''}},
      {validation: {command: 'pnpm', args: ['test', 42]}},
      {validation: {command: 'pnpm', setup: {command: ''}}},
    ]) {
      await writeFile(
        join(directory, 'config.json'),
        JSON.stringify({
          ...invalidConfig,
          apps: [
            {
              id: 'example',
              target: '@shipfox/example',
              directory: 'dist/example',
              project: 'example',
            },
          ],
        }),
      );
      await assert.rejects(readCloudflarePagesConfig('config.json', directory));
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('keeps application outputs relative to the caller working directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shipfox-cloudflare-pages-config-'));
  try {
    await mkdir(join(directory, 'config'));
    await writeFile(
      join(directory, 'config/config.json'),
      JSON.stringify({
        artifact: {metadataPath: 'dist/example/metadata.json'},
        validation: {
          setup: {command: 'pnpm', args: ['prepare']},
          command: 'pnpm',
          args: ['test'],
        },
        apps: [
          {
            id: 'example',
            target: '@shipfox/example',
            directory: 'dist/example',
            project: 'example',
          },
        ],
      }),
    );

    const config = await readCloudflarePagesConfig('config/config.json', directory);
    assert.equal(config.apps[0].directory, 'dist/example');
    assert.deepEqual(config.artifact, {
      metadataPath: 'dist/example/metadata.json',
    });
    assert.deepEqual(config.validation, {
      setup: {command: 'pnpm', args: ['prepare']},
      command: 'pnpm',
      args: ['test'],
    });
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('runs configured validation commands and records failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shipfox-cloudflare-pages-cli-'));
  try {
    const marker = join(directory, 'setup-complete');
    const output = join(directory, 'validation.json');
    const githubOutput = join(directory, 'github-output');
    await writeFile(
      join(directory, 'config.json'),
      JSON.stringify({
        validation: {
          setup: {
            command: process.execPath,
            args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ready')`],
          },
          command: process.execPath,
          args: [
            '-e',
            `if (require('node:fs').readFileSync(${JSON.stringify(marker)}, 'utf8') !== 'ready') process.exit(2)`,
          ],
        },
        apps: [
          {
            id: 'example',
            target: '@shipfox/example',
            directory: 'dist/example',
            project: 'example',
          },
        ],
      }),
    );

    await runCli(
      ['validate', '--config', 'config.json', '--output', output, '--github-output', githubOutput],
      directory,
    );
    assert.equal(JSON.parse(await readFile(output, 'utf8')).ok, true);
    assert.match(await readFile(githubOutput, 'utf8'), validationOkPattern);

    await writeFile(
      join(directory, 'config.json'),
      JSON.stringify({
        validation: {command: process.execPath, args: ['-e', 'process.exit(3)']},
        apps: [
          {
            id: 'example',
            target: '@shipfox/example',
            directory: 'dist/example',
            project: 'example',
          },
        ],
      }),
    );
    await assert.rejects(
      runCli(['validate', '--config', 'config.json', '--output', output], directory),
    );
    assert.equal(JSON.parse(await readFile(output, 'utf8')).ok, false);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('skips validation when no command is configured', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shipfox-cloudflare-pages-cli-'));
  try {
    const output = join(directory, 'validation.json');
    await writeFile(
      join(directory, 'config.json'),
      JSON.stringify({
        apps: [
          {
            id: 'example',
            target: '@shipfox/example',
            directory: 'dist/example',
            project: 'example',
          },
        ],
      }),
    );

    await runCli(['validate', '--config', 'config.json', '--output', output], directory);

    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {
      ok: true,
      skipped: true,
      reason: 'no validation command configured',
    });
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('archives selected outputs while replacing stale artifact contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shipfox-cloudflare-pages-cli-'));
  try {
    await mkdir(join(directory, 'dist/example'), {recursive: true});
    await writeFile(join(directory, 'dist/example/index.html'), 'current');
    await mkdir(join(directory, 'artifact'), {recursive: true});
    await writeFile(join(directory, 'artifact/stale.txt'), 'stale');
    await writeFile(
      join(directory, 'config.json'),
      JSON.stringify({
        apps: [
          {
            id: 'example',
            target: '@shipfox/example',
            directory: 'dist/example',
            project: 'example',
          },
        ],
      }),
    );

    await runCli(
      [
        'archive-all',
        '--config',
        'config.json',
        '--artifact-directory',
        'artifact',
        '--output',
        'artifact/.shipfox-pages-plan.json',
      ],
      directory,
    );

    assert.equal(await readFile(join(directory, 'artifact/example/index.html'), 'utf8'), 'current');
    await assert.rejects(readFile(join(directory, 'artifact/stale.txt'), 'utf8'));
    const manifest = JSON.parse(
      await readFile(join(directory, 'artifact/.shipfox-pages-plan.json'), 'utf8'),
    );
    assert.equal(manifest.shouldDeploy, true);
    assert.equal(manifest.reason, 'verified artifact');
    assert.deepEqual(manifest.selectedApps, ['example']);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('rejects unsafe archive roots, application ids, and empty selections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shipfox-cloudflare-pages-cli-'));
  try {
    await mkdir(join(directory, 'dist/example'), {recursive: true});
    await writeFile(join(directory, 'dist/example/index.html'), 'current');
    await writeFile(
      join(directory, 'config.json'),
      JSON.stringify({
        apps: [
          {
            id: '../escape',
            target: '@shipfox/example',
            directory: 'dist/example',
            project: 'example',
          },
        ],
      }),
    );
    await assert.rejects(
      runCli(
        ['archive-all', '--config', 'config.json', '--artifact-directory', 'artifact'],
        directory,
      ),
      unsafeAppIdPattern,
    );

    await writeFile(
      join(directory, 'config.json'),
      JSON.stringify({
        apps: [
          {
            id: 'example',
            target: '@shipfox/example',
            directory: 'dist/example',
            project: 'example',
          },
        ],
      }),
    );
    await assert.rejects(
      runCli(['archive-all', '--config', 'config.json', '--artifact-directory', '.'], directory),
      workingDirectoryArchivePattern,
    );
    await writeFile(join(directory, 'plan.json'), JSON.stringify({selectedApps: ['missing']}));
    await assert.rejects(
      runCli(
        [
          'archive-all',
          '--config',
          'config.json',
          '--plan-file',
          'plan.json',
          '--artifact-directory',
          'artifact',
        ],
        directory,
      ),
      emptyArchiveSelectionPattern,
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('rejects executable worker code in a promoted preview artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shipfox-cloudflare-pages-cli-'));
  try {
    await mkdir(join(directory, 'artifact/example'), {recursive: true});
    await writeFile(join(directory, 'artifact/example/_worker.js'), 'export default {};');
    await writeFile(
      join(directory, 'config.json'),
      JSON.stringify({
        apps: [
          {
            id: 'example',
            target: '@shipfox/example',
            directory: 'dist/example',
            project: 'example',
          },
        ],
      }),
    );
    await writeFile(join(directory, 'plan.json'), JSON.stringify({selectedApps: ['example']}));

    await assert.rejects(
      runCli(
        [
          'deploy-all',
          '--config',
          'config.json',
          '--plan-file',
          'plan.json',
          '--artifact-directory',
          'artifact',
          '--commit',
          'abc123',
        ],
        directory,
      ),
      archivedWorkerPattern,
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('uploads through Cloudflare Pages and retries transient failures', async () => {
  const calls = [];
  let attempts = 0;
  const deployment = await deployCloudflarePages({
    directory: 'dist',
    project: 'example',
    branch: 'pr-42',
    commitSha: 'abc123',
    retryDelayMs: 0,
    runner: (command, args) => {
      calls.push({command, args});
      attempts += 1;
      if (attempts === 1) throw new Error('temporary provider error');
      return {output: 'https://abc.example-previews.pages.dev'};
    },
  });

  assert.equal(deployment.url, 'https://abc.example-previews.pages.dev');
  assert.equal(deployment.attempts, 2);
  assert.deepEqual(calls[1].args, [
    'pages',
    'deploy',
    'dist',
    '--project-name=example',
    '--branch=pr-42',
    '--commit-hash=abc123',
  ]);
});

test('terminates commands that exceed their timeout', async () => {
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], {
      stream: false,
      timeoutMs: 20,
    }),
    timeoutPattern,
  );
});

test('does not wait for inherited pipes after the command exits', async () => {
  if (process.platform === 'win32') return;
  const startedAt = Date.now();
  await runCommand('/bin/sh', ['-c', 'sleep 2 &'], {stream: false, timeoutMs: 100});
  assert.equal(Date.now() - startedAt < 1_800, true);
});

test('records the immutable deployment URL when Wrangler also prints a branch alias', async () => {
  const deployment = await deployCloudflarePages({
    directory: 'dist',
    project: 'example',
    branch: 'pr-42',
    commitSha: 'abc123',
    retryDelayMs: 0,
    runner: async (_command, _args, options) => {
      await writeFile(
        options.env.WRANGLER_OUTPUT_FILE_PATH,
        `${JSON.stringify({
          type: 'pages-deploy-detailed',
          url: 'https://immutable-42.example.pages.dev',
          alias: 'https://pr-42.example.pages.dev',
        })}\n`,
      );
      return {
        output:
          'Deployment complete! https://immutable-42.example.pages.dev\nDeployment alias URL: https://pr-42.example.pages.dev',
      };
    },
  });

  assert.equal(deployment.url, 'https://immutable-42.example.pages.dev');
});

test('uploads selected apps to their configured projects', async () => {
  const calls = [];
  const result = await deployCloudflarePagesApps({
    apps: exampleApps,
    selectedAppIds: ['other'],
    branch: 'pr-42',
    commitSha: 'abc123',
    retryDelayMs: 0,
    runner: (command, args) => {
      calls.push({command, args});
      return {output: 'https://other.example.pages.dev'};
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.apps.map(({appId, project, url}) => ({appId, project, url})),
    [{appId: 'other', project: 'other', url: 'https://other.example.pages.dev'}],
  );
  assert.deepEqual(calls[0].args, [
    'pages',
    'deploy',
    'dist/other',
    '--project-name=other',
    '--branch=pr-42',
    '--commit-hash=abc123',
  ]);
});

test('reports successful uploads when another selected app fails', async () => {
  const result = await deployCloudflarePagesApps({
    apps: exampleApps,
    branch: 'pr-42',
    commitSha: 'abc123',
    attempts: 1,
    retryDelayMs: 0,
    runner: (_command, args) => {
      if (args.includes('--project-name=other')) throw new Error('provider rejected other');
      return {output: 'https://example.example.pages.dev'};
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.apps[0].ok, true);
  assert.equal(result.apps[0].url, 'https://example.example.pages.dev');
  assert.equal(result.apps[1].ok, false);
  assert.match(result.errors[0], partialDeploymentPattern);
});

test('rejects deployments when no configured app matches the plan', async () => {
  const result = await deployCloudflarePagesApps({
    apps: exampleApps,
    selectedAppIds: ['missing'],
    commitSha: 'abc123',
    runner: () => {
      throw new Error('runner should not be called');
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['No applications were selected for deployment']);
});

test('deploys production through the explicit Pages production branch', async () => {
  const calls = [];
  const deployment = await deployCloudflarePages({
    directory: 'dist',
    project: 'example',
    environment: 'production',
    branch: 'main',
    commitSha: 'abc123',
    runner: async (command, args, options) => {
      calls.push({command, args});
      await writeFile(
        options.env.WRANGLER_OUTPUT_FILE_PATH,
        `${JSON.stringify({
          type: 'pages-deploy-detailed',
          url: 'https://example.pages.dev',
          environment: 'production',
          production_branch: 'main',
        })}\n`,
      );
      return {output: 'https://example.pages.dev'};
    },
  });

  assert.equal(deployment.branch, 'main');
  assert.deepEqual(calls[0].args, [
    'pages',
    'deploy',
    'dist',
    '--project-name=example',
    '--branch=main',
    '--commit-hash=abc123',
  ]);
});

test('rejects production uploads when the Pages production branch differs', async () => {
  await assert.rejects(
    deployCloudflarePages({
      directory: 'dist',
      project: 'example',
      environment: 'production',
      branch: 'main',
      commitSha: 'abc123',
      attempts: 1,
      retryDelayMs: 0,
      runner: async (_command, _args, options) => {
        await writeFile(
          options.env.WRANGLER_OUTPUT_FILE_PATH,
          `${JSON.stringify({
            type: 'pages-deploy-detailed',
            url: 'https://example.pages.dev',
            environment: 'production',
            production_branch: 'production',
          })}\n`,
        );
        return {output: 'https://example.pages.dev'};
      },
    }),
    productionBranchPattern,
  );
});

test('resolves environment branches and project overrides', async () => {
  assert.equal(resolvePagesBranch({environment: 'preview', pullRequest: '42'}), 'pr-42');
  assert.throws(() => resolvePagesBranch({environment: 'preview'}), missingPullRequestPattern);
  assert.equal(resolvePagesBranch({environment: 'staging'}), 'staging');
  assert.equal(resolvePagesBranch({environment: 'production'}), 'main');

  const result = await deployCloudflarePagesApps({
    apps: [{...exampleApps[0], projects: {staging: 'example-staging'}}],
    environment: 'staging',
    selectedAppIds: ['example'],
    commitSha: 'abc123',
    retryDelayMs: 0,
    runner: (_command, args) => {
      assert.equal(args.includes('--project-name=example-staging'), true);
      assert.equal(args.includes('--branch=staging'), true);
      return {output: 'https://example-staging.pages.dev'};
    },
  });

  assert.equal(result.ok, true);
});

test('resolves configured build inputs and CI environment references', async () => {
  const calls = [];
  const result = await buildCloudflarePagesApps({
    apps: [
      {
        ...exampleApps[0],
        build: {
          env: {
            preview: {VITE_API_URL: 'https://api-pr-{pullRequest}.shipfox.dev'},
          },
          fromEnv: {VITE_SENTRY_DSN: 'PREVIEW_SENTRY_DSN'},
        },
      },
    ],
    selectedAppIds: ['example'],
    environment: 'preview',
    pullRequest: '42',
    branch: 'feature/config',
    commitSha: 'abc123',
    env: {PREVIEW_SENTRY_DSN: 'https://sentry.example/1'},
    runner: (command, args, options) => {
      calls.push({command, args, env: options.env});
      return {output: ''};
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].args, [
    'run',
    'build',
    '--filter=@shipfox/example...',
    '--concurrency=4',
  ]);
  assert.equal(calls[0].env.VITE_API_URL, 'https://api-pr-42.shipfox.dev');
  assert.equal(calls[0].env.VITE_SENTRY_DSN, 'https://sentry.example/1');
  assert.deepEqual(result.apps[0].env, ['VITE_API_URL', 'VITE_SENTRY_DSN']);
});

test('rejects missing CI environment references before building', async () => {
  await assert.rejects(
    buildCloudflarePagesApps({
      apps: [
        {
          ...exampleApps[0],
          build: {fromEnv: {VITE_SENTRY_DSN: 'PREVIEW_SENTRY_DSN'}},
        },
      ],
      selectedAppIds: ['example'],
      environment: 'preview',
      env: {},
      runner: () => {
        throw new Error('runner should not be called');
      },
    }),
    missingCiEnvironmentPattern,
  );
});

test('rejects builds when no configured app matches the plan', async () => {
  const result = await buildCloudflarePagesApps({
    apps: exampleApps,
    selectedAppIds: ['missing'],
    environment: 'preview',
    runner: () => {
      throw new Error('runner should not be called');
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['No applications were selected for build']);
});

test('verifies metadata and configured endpoints', async () => {
  const requested = [];
  const result = await verifyPagesDeployment({
    baseUrl: 'https://example.pages.dev',
    expectedCommitSha: 'abc123',
    expectedPullRequest: '42',
    retryDelayMs: 0,
    endpoints: [{path: '/child/index.json', requireNonEmpty: true}],
    fetchImpl: (url) => {
      requested.push(url);
      if (url.endsWith('/preview-metadata.json')) {
        return new Response(JSON.stringify({commitSha: 'abc123', pullRequest: {number: 42}}), {
          status: 200,
          headers: {'content-type': 'application/json'},
        });
      }
      if (url.endsWith('/child/index.json')) {
        return new Response(JSON.stringify({entries: {story: {}}}), {status: 200});
      }
      return new Response('<html></html>', {status: 200});
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.endpoints, [
    {id: '/child/index.json', path: '/child/index.json', ok: true, status: 200},
  ]);
  assert.deepEqual(requested, [
    'https://example.pages.dev/',
    'https://example.pages.dev/preview-metadata.json',
    'https://example.pages.dev/child/index.json',
  ]);
});

test('accepts non-empty JSON arrays for required endpoints', async () => {
  const result = await verifyPagesDeployment({
    baseUrl: 'https://example.pages.dev',
    expectedCommitSha: 'abc123',
    retryDelayMs: 0,
    attempts: 1,
    endpoints: [{path: '/stories.json', requireNonEmpty: true}],
    fetchImpl: (url) => {
      if (url.endsWith('/preview-metadata.json')) {
        return new Response(JSON.stringify({commitSha: 'abc123'}), {status: 200});
      }
      if (url.endsWith('/stories.json')) {
        return new Response(JSON.stringify([{id: 'story'}]), {status: 200});
      }
      return new Response('<html></html>', {status: 200});
    },
  });

  assert.equal(result.ok, true);
});

test('reports every failed endpoint without stopping at the first failure', async () => {
  const result = await verifyPagesDeployment({
    baseUrl: 'https://example.pages.dev',
    expectedCommitSha: 'abc123',
    retryDelayMs: 0,
    attempts: 1,
    endpoints: [
      {id: 'missing', path: '/missing/index.json', requireNonEmpty: true},
      {id: 'empty', path: '/empty/index.json', requireNonEmpty: true},
    ],
    fetchImpl: (url) => {
      if (url.endsWith('/preview-metadata.json')) {
        return new Response(JSON.stringify({commitSha: 'abc123'}), {status: 200});
      }
      if (url.endsWith('/missing/index.json')) return new Response('missing', {status: 404});
      if (url.endsWith('/empty/index.json')) return new Response('{}', {status: 200});
      return new Response('<html></html>', {status: 200});
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.endpoints.length, 2);
  assert.equal(result.endpoints[0].id, 'missing');
  assert.equal(result.endpoints[0].ok, false);
  assert.equal(result.endpoints[1].id, 'empty');
  assert.equal(result.endpoints[1].ok, false);
  assert.equal(result.errors.length, 2);
});

test('verifies each selected app against its own deployment URL', async () => {
  const result = await verifyCloudflarePagesApps({
    apps: exampleApps,
    deployments: [
      {
        appId: 'example',
        ok: true,
        directory: 'dist/example',
        project: 'example',
        environment: 'preview',
        branch: 'pr-42',
        commitSha: 'abc123',
        url: 'https://example.example.pages.dev',
      },
      {
        appId: 'other',
        ok: true,
        directory: 'dist/other',
        project: 'other',
        environment: 'preview',
        branch: 'pr-42',
        commitSha: 'abc123',
        url: 'https://other.example.pages.dev',
      },
    ],
    expectedCommitSha: 'abc123',
    expectedPullRequest: '42',
    retryDelayMs: 0,
    fetchImpl: (url) => {
      if (url.endsWith('/preview-metadata.json')) {
        return new Response(JSON.stringify({commitSha: 'abc123', pullRequest: {number: 42}}), {
          status: 200,
        });
      }
      if (url.endsWith('/index.json')) {
        return new Response(JSON.stringify({entries: {story: {}}}), {status: 200});
      }
      return new Response('<html></html>', {status: 200});
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.apps.map(({appId, ok, url}) => ({appId, ok, url})),
    [
      {appId: 'example', ok: true, url: 'https://example.example.pages.dev'},
      {appId: 'other', ok: true, url: 'https://other.example.pages.dev'},
    ],
  );
});

test('fails verification when requested app ids do not match the config', async () => {
  const result = await verifyCloudflarePagesApps({
    apps: exampleApps,
    deployments: [],
    selectedAppIds: ['missing'],
    expectedCommitSha: 'abc123',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['No applications were selected for verification']);
});

test('creates and finalizes GitHub deployments through the API adapter', async () => {
  const requests = [];
  const runner = (_command, args, options) => {
    requests.push({args, payload: JSON.parse(options.input)});
    return {output: JSON.stringify({id: 123})};
  };

  await createGitHubDeployment({
    repository: 'ShipfoxHQ/example',
    ref: 'abc123',
    url: 'https://example.pages.dev',
    runner,
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].payload.ref, 'abc123');
  assert.equal(requests[0].payload.transient_environment, true);
  assert.equal(requests[1].payload.state, 'in_progress');

  await finishGitHubDeployment({
    repository: 'ShipfoxHQ/example',
    deploymentId: '123',
    state: 'success',
    url: 'https://example.pages.dev',
    runner,
  });
  assert.equal(requests[2].payload.state, 'success');
});

test('names app GitHub deployments with a readable preview label', async () => {
  const requests = [];
  const runner = (_command, args, options) => {
    requests.push({args, payload: JSON.parse(options.input)});
    return {output: JSON.stringify({id: 123})};
  };

  await createGitHubDeployments({
    deployments: [{appId: 'storybook', ok: true, url: 'https://storybook.pages.dev'}],
    repository: 'ShipfoxHQ/example',
    ref: 'abc123',
    pullRequest: '42',
    runner,
  });

  assert.equal(requests[0].payload.environment, 'Preview – storybook – PR 42');
});

test('registers successful applications from a partial deployment manifest', async () => {
  const requests = [];
  const result = await createGitHubDeployments({
    deployments: [
      {appId: 'storybook', ok: true, url: 'https://storybook.pages.dev'},
      {appId: 'docs', ok: false},
    ],
    repository: 'ShipfoxHQ/example',
    ref: 'abc123',
    runner: (_command, args, options) => {
      requests.push({args, payload: JSON.parse(options.input)});
      return {output: JSON.stringify({id: 123})};
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.apps.length, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].payload.environment, 'Preview – storybook');
});

test('uses the GitHub repository from the CI environment for deployment registration', async () => {
  const previousRepository = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = 'ShipfoxHQ/example';
  const requests = [];
  try {
    const result = await createGitHubDeployments({
      deployments: [{appId: 'storybook', ok: true, url: 'https://storybook.pages.dev'}],
      ref: 'abc123',
      runner: (_command, args, options) => {
        requests.push({args, payload: JSON.parse(options.input)});
        return {output: JSON.stringify({id: 123})};
      },
    });

    assert.equal(result.ok, true);
    assert.equal(requests[0].args[3], 'repos/ShipfoxHQ/example/deployments');
  } finally {
    if (previousRepository === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = previousRepository;
  }
});

test('marks production GitHub deployments as non-transient production deployments', async () => {
  const requests = [];
  const runner = (_command, args, options) => {
    requests.push({args, payload: JSON.parse(options.input)});
    return {output: JSON.stringify({id: 123})};
  };

  await createGitHubDeployments({
    deployments: [{appId: 'storybook', ok: true, url: 'https://storybook.pages.dev'}],
    environment: 'production',
    repository: 'ShipfoxHQ/example',
    ref: 'abc123',
    runner,
  });

  assert.equal(requests[0].payload.environment, 'Production – storybook');
  assert.equal(requests[0].payload.transient_environment, false);
  assert.equal(requests[0].payload.production_environment, true);
});

test('retains a created GitHub deployment when its in-progress status fails', async () => {
  let callCount = 0;
  const result = await createGitHubDeployments({
    deployments: [{appId: 'storybook', ok: true, url: 'https://storybook.pages.dev'}],
    repository: 'ShipfoxHQ/example',
    ref: 'abc123',
    runner: () => {
      callCount += 1;
      if (callCount === 2) throw new Error('status endpoint unavailable');
      return {output: JSON.stringify({id: 123})};
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.apps, [
    {
      appId: 'storybook',
      id: '123',
      url: 'https://storybook.pages.dev',
      environment: 'Preview – storybook',
      repository: 'ShipfoxHQ/example',
    },
  ]);
});

test('finalizes pending GitHub deployments as failures without a verification report', async () => {
  const requests = [];
  const result = await finishGitHubDeployments({
    deployments: [
      {
        appId: 'storybook',
        id: '123',
        repository: 'ShipfoxHQ/example',
        url: 'https://storybook.pages.dev',
      },
    ],
    verification: {apps: []},
    runner: (_command, args, options) => {
      requests.push({args, payload: JSON.parse(options.input)});
      return {output: '{}'};
    },
  });

  assert.equal(result.ok, true);
  assert.equal(requests[0].payload.state, 'failure');
});

test('calculates GitHub Actions queue time', async () => {
  const queueSeconds = await getWorkflowQueueSeconds({
    repository: 'ShipfoxHQ/example',
    runId: '42',
    runner: async () => ({
      output: JSON.stringify({
        created_at: '2026-07-26T10:00:00Z',
        run_started_at: '2026-07-26T10:00:07Z',
      }),
    }),
  });

  assert.equal(queueSeconds, 7);
});

test('rejects a deployment when the pull request head has moved', async () => {
  await assert.rejects(
    assertCurrentCommit({
      repository: 'ShipfoxHQ/example',
      pullRequest: '42',
      commit: 'abc123',
      runner: (_command, args) => {
        assert.deepEqual(args, [
          'api',
          'repos/ShipfoxHQ/example/pulls/42',
          '--jq',
          '{headSha: .head.sha, state: .state, baseRef: .base.ref}',
        ]);
        return {output: '{"headSha":"def456","state":"open","baseRef":"main"}\n'};
      },
    }),
    headMovedPattern,
  );
});

test('rejects a closed or retargeted pull request before deployment', async () => {
  await assert.rejects(
    assertCurrentCommit({
      repository: 'ShipfoxHQ/example',
      pullRequest: '42',
      commit: 'abc123',
      runner: () => ({
        output: '{"headSha":"abc123","state":"closed","baseRef":"main"}\n',
      }),
    }),
    invalidPullRequestLifecyclePattern,
  );
});
