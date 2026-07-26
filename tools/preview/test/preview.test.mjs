import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCurrentPreviewCommit,
  createGitHubDeployment,
  createPreviewPlan,
  deployPreview,
  finishGitHubDeployment,
  getWorkflowQueueSeconds,
  verifyPreview,
} from '../dist/index.js';

const headMovedPattern = /no longer current/;

test('plans a preview from affected targets and forced paths', () => {
  const plan = createPreviewPlan({
    targets: ['@shipfox/example'],
    forcePaths: ['.github/workflows/preview.yml'],
    eventName: 'pull_request',
    affectedPackages: ['@shipfox/example', '@shipfox/unrelated'],
    changedFiles: ['libs/example/src/index.ts'],
  });

  assert.equal(plan.shouldDeploy, true);
  assert.deepEqual(plan.affectedTargets, ['@shipfox/example']);
  assert.equal(plan.reason, 'Turbo affected preview target detected');
});

test('forces a preview when a configured path changes', () => {
  const plan = createPreviewPlan({
    targets: ['@shipfox/example'],
    forcePaths: ['.github/workflows/preview.yml'],
    eventName: 'pull_request',
    affectedPackages: [],
    changedFiles: ['.github/workflows/preview.yml'],
  });

  assert.equal(plan.shouldDeploy, true);
  assert.equal(plan.reason, 'preview workflow or application configuration changed');
});

test('uploads through the Cloudflare adapter and retries transient failures', async () => {
  const calls = [];
  let attempts = 0;
  const deployment = await deployPreview({
    provider: 'cloudflare-pages',
    directory: 'dist',
    project: 'example-previews',
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
    '--project-name=example-previews',
    '--branch=pr-42',
    '--commit-hash=abc123',
  ]);
});

test('verifies metadata and configured endpoints', async () => {
  const requested = [];
  const result = await verifyPreview({
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
  const result = await verifyPreview({
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

test('rejects a preview when the pull request head has moved', async () => {
  await assert.rejects(
    assertCurrentPreviewCommit({
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
