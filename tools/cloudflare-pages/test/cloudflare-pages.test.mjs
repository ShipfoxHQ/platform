import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import test from 'node:test';

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
  resolvePagesBranch,
  verifyCloudflarePagesApps,
  verifyPagesDeployment,
} from '../dist/index.js';

const headMovedPattern = /no longer current/;
const timeoutPattern = /timed out after 20ms/;
const missingCiEnvironmentPattern = /missing CI environment variable PREVIEW_SENTRY_DSN/;
const missingPullRequestPattern = /pull request number is required/;
const productionBranchPattern = /production branch is production, expected main/;
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
        assert.deepEqual(args, ['api', 'repos/ShipfoxHQ/example/pulls/42', '--jq', '.head.sha']);
        return {output: 'def456\n'};
      },
    }),
    headMovedPattern,
  );
});
