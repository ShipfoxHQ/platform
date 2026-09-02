import {readFile} from 'node:fs/promises';
import type {WorkflowRunDetailResponseDto} from '@shipfox/api-workflows-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {waitForDefinition} from '@shipfox/e2e-observe-definitions';
import {
  createTestVcsConnection,
  createTestVcsRepository,
  failNextTestVcsMints,
  getTestVcsStats,
  type TestVcsStats,
  testVcsExternalRepositoryId,
} from '@shipfox/e2e-setup-integrations';
import {attachLocalRunnerLog} from '#attachments.js';
import {createProject} from '#create-project.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {expect, test} from './fixtures.js';

const RUNNER_TERMINAL_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 300_000;
const TEST_VCS_TOKEN_PATTERN = /test-vcs-[0-9a-f-]{20,}/u;

const ON_REJECTION_WORKFLOW = `
name: Renewable Git on rejection
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  build:
    checkout:
      permissions:
        contents: write
      persist-credentials: true
    steps:
      - key: verify-primary-checkout
        run: |
          test -d .git
          command -v git-credential-shipfox
          test -n "$GIT_CONFIG_GLOBAL"
          test -f "$GIT_CONFIG_GLOBAL"
          git config --global --list --show-origin
          git config --global --get-urlmatch credential.helper "$(git remote get-url origin)" || true
      - key: secondary-checkout
        checkout:
          connection: __TEST_VCS_CONNECTION__
          repository: __TEST_VCS_SECONDARY_REPOSITORY__
          ref: main
          path: secondary
          permissions:
            contents: read
          persist-credentials: true
      - key: use-renewed-credentials
        run: |
          sleep 4
          if git ls-remote origin main; then
            echo 'expected the expired primary credential to be rejected' >&2
            exit 1
          fi
          git ls-remote origin main
          if git -C secondary ls-remote origin main; then
            echo 'expected the expired secondary credential to be rejected' >&2
            exit 1
          fi
          git -C secondary ls-remote origin main
          git config --local commit.gpgsign false
          printf '\\nrenewed\\n' >> README.md
          git add README.md
          git commit -m "renewed credentials"
          git push origin HEAD:main
          test "$(git log -1 --format=%ae)" = "test-vcs@shipfox.test"
`;

const REFRESH_AT_WORKFLOW = `
name: Renewable Git refresh at
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  build:
    checkout:
      permissions:
        contents: read
      persist-credentials: true
    steps:
      - key: use-refreshed-credentials
        run: |
          sleep 2
          git ls-remote origin main
`;

const NON_PERSISTED_WORKFLOW = `
name: Renewable Git without persistence
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  build:
    checkout:
      permissions:
        contents: write
      persist-credentials: false
    steps:
      - key: inspect-authorship-only-config
        run: |
          test -n "$GIT_CONFIG_GLOBAL"
          test "$(git config --global user.name)" = "Shipfox Test VCS"
          test "$(git config --global user.email)" = "test-vcs@shipfox.test"
          remote_url="$(git remote get-url origin)"
          test -z "$(git config --global --get-urlmatch credential.helper "$remote_url" || true)"
          test -z "$(git config --global --get-urlmatch http.extraHeader "$remote_url" || true)"
          sleep 4
`;

const CONCURRENT_WORKFLOW = `
name: Concurrent renewable Git checkouts
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  first:
    checkout:
      permissions:
        contents: read
      persist-credentials: true
    steps:
      - key: first-checkout
        run: |
          sleep 1
          git ls-remote origin main
  second:
    checkout:
      permissions:
        contents: read
      persist-credentials: true
    steps:
      - key: second-checkout
        run: |
          sleep 1
          git ls-remote origin main
`;

const PROVIDER_FAILURE_WORKFLOW = `
name: Renewable Git provider failure
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  build:
    checkout:
      permissions:
        contents: read
      persist-credentials: true
    steps:
      - key: should-not-run
        run: exit 1
`;

test.describe.configure({mode: 'serial'});

test('renews on Git rejection across a long step and multiple checkouts', async ({
  suite,
}, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const uniqueId = shortId();
  const runnerLabel = `e2e-renewable-rejection-${uniqueId}`;
  const repositoryName = `renewal-${uniqueId}`;
  const secondaryRepositoryName = `renewal-secondary-${uniqueId}`;
  const configPath = `.shipfox/workflows/${repositoryName}.yml`;
  const before = await getTestVcsStats({connectionId: suite.testVcsConnectionId});

  const secondary = await createTestVcsRepository({
    connectionId: suite.testVcsConnectionId,
    name: secondaryRepositoryName,
    files: [{path: 'README.md', content: '# Secondary test VCS repository\n'}],
  });
  const workflow = await seedTestVcsWorkflow({
    suite,
    token: suite.sessionToken,
    connectionId: suite.testVcsConnectionId,
    connectionSlug: suite.testVcsConnectionSlug,
    owner: suite.testVcsAccountId,
    repositoryName,
    runnerLabel,
    configPath,
    workflowYaml: ON_REJECTION_WORKFLOW,
    secondaryRepositoryName,
  });
  expect(secondary.external_repository_id).toBe(
    testVcsExternalRepositoryId(suite.testVcsAccountId, secondaryRepositoryName),
  );

  const {terminal, logFiles} = await runWorkflow({
    suite,
    testInfo,
    definitionId: workflow.definition.id,
    scenario: 'renewable-credentials-on-rejection',
    runnerLabel,
    renewableGit: true,
  });
  const after = await getTestVcsStats({connectionId: suite.testVcsConnectionId});

  expect(terminal.status).toBe('succeeded');
  expect(terminal.jobs.find((job) => job.key === 'build')?.status).toBe('succeeded');
  expect(after.mint_count - before.mint_count).toBe(4);
  expect(after.generations.length - before.generations.length).toBe(4);
  expect(rejectedCredentialRequestCount(before, after)).toBeGreaterThanOrEqual(2);
  expect(after.accepted_request_count - before.accepted_request_count).toBeGreaterThan(0);
  await assertNoCredentialLeak(after, logFiles);
});

test('refreshes before Git needs an expired credential', async ({suite}, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const uniqueId = shortId();
  const accountId = `test-vcs-refresh-${uniqueId}`;
  const connection = await createTestVcsConnection({
    workspaceId: suite.workspaceId,
    accountId,
    displayName: `Test VCS refresh-at ${uniqueId}`,
    renewalMode: 'refresh-at',
  });
  const runnerLabel = `e2e-renewable-refresh-${uniqueId}`;
  const repositoryName = `refresh-${uniqueId}`;
  const configPath = `.shipfox/workflows/${repositoryName}.yml`;
  const before = await getTestVcsStats({connectionId: connection.id});
  const workflow = await seedTestVcsWorkflow({
    suite,
    token: suite.sessionToken,
    connectionId: connection.id,
    connectionSlug: connection.slug,
    owner: connection.external_account_id,
    repositoryName,
    runnerLabel,
    configPath,
    workflowYaml: REFRESH_AT_WORKFLOW,
  });

  const {terminal, logFiles} = await runWorkflow({
    suite,
    testInfo,
    definitionId: workflow.definition.id,
    scenario: 'renewable-credentials-refresh-at',
    runnerLabel,
    renewableGit: true,
  });
  const after = await getTestVcsStats({connectionId: connection.id});

  expect(terminal.status).toBe('succeeded');
  expect(terminal.jobs.find((job) => job.key === 'build')?.status).toBe('succeeded');
  expect(after.mint_count - before.mint_count).toBe(2);
  expect(after.generations.length - before.generations.length).toBe(2);
  expect(rejectedCredentialRequestCount(before, after)).toBe(0);
  expect(after.accepted_request_count - before.accepted_request_count).toBeGreaterThan(0);
  await assertNoCredentialLeak(after, logFiles);
});

test('keeps author identity without persisting credentials when disabled', async ({
  suite,
}, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const uniqueId = shortId();
  const runnerLabel = `e2e-renewable-no-persistence-${uniqueId}`;
  const repositoryName = `no-persistence-${uniqueId}`;
  const configPath = `.shipfox/workflows/${repositoryName}.yml`;
  const before = await getTestVcsStats({connectionId: suite.testVcsConnectionId});
  const workflow = await seedTestVcsWorkflow({
    suite,
    token: suite.sessionToken,
    connectionId: suite.testVcsConnectionId,
    connectionSlug: suite.testVcsConnectionSlug,
    owner: suite.testVcsAccountId,
    repositoryName,
    runnerLabel,
    configPath,
    workflowYaml: NON_PERSISTED_WORKFLOW,
  });

  const {terminal, logFiles} = await runWorkflow({
    suite,
    testInfo,
    definitionId: workflow.definition.id,
    scenario: 'renewable-credentials-no-persistence',
    runnerLabel,
    renewableGit: true,
  });
  const after = await getTestVcsStats({connectionId: suite.testVcsConnectionId});

  expect(terminal.status).toBe('succeeded');
  expect(terminal.jobs.find((job) => job.key === 'build')?.status).toBe('succeeded');
  expect(after.mint_count - before.mint_count).toBe(1);
  expect(after.generations.length - before.generations.length).toBe(1);
  expect(after.rejected_request_count - before.rejected_request_count).toBe(0);
  await assertNoCredentialLeak(after, logFiles);
});

test('shares one provider mint across concurrent jobs with the same scope', async ({
  suite,
}, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const uniqueId = shortId();
  const runnerLabel = `e2e-renewable-concurrent-${uniqueId}`;
  const repositoryName = `concurrent-${uniqueId}`;
  const configPath = `.shipfox/workflows/${repositoryName}.yml`;
  const before = await getTestVcsStats({connectionId: suite.testVcsConnectionId});
  const workflow = await seedTestVcsWorkflow({
    suite,
    token: suite.sessionToken,
    connectionId: suite.testVcsConnectionId,
    connectionSlug: suite.testVcsConnectionSlug,
    owner: suite.testVcsAccountId,
    repositoryName,
    runnerLabel,
    configPath,
    workflowYaml: CONCURRENT_WORKFLOW,
  });

  const {terminal, logFiles} = await runWorkflow({
    suite,
    testInfo,
    definitionId: workflow.definition.id,
    scenario: 'renewable-credentials-concurrent',
    runnerLabel,
    runnerCount: 2,
    renewableGit: true,
  });
  const after = await getTestVcsStats({connectionId: suite.testVcsConnectionId});

  expect(terminal.status).toBe('succeeded');
  expect(terminal.jobs.find((job) => job.key === 'first')?.status).toBe('succeeded');
  expect(terminal.jobs.find((job) => job.key === 'second')?.status).toBe('succeeded');
  expect(after.mint_count - before.mint_count).toBe(1);
  expect(after.generations.length - before.generations.length).toBe(1);
  expect(rejectedCredentialRequestCount(before, after)).toBe(0);
  expect(after.accepted_request_count - before.accepted_request_count).toBeGreaterThan(0);
  await assertNoCredentialLeak(after, logFiles);
});

test('fails the workflow promptly when the provider cannot mint credentials', async ({
  suite,
}, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const uniqueId = shortId();
  const runnerLabel = `e2e-renewable-provider-failure-${uniqueId}`;
  const repositoryName = `provider-failure-${uniqueId}`;
  const configPath = `.shipfox/workflows/${repositoryName}.yml`;
  const before = await getTestVcsStats({connectionId: suite.testVcsConnectionId});
  const workflow = await seedTestVcsWorkflow({
    suite,
    token: suite.sessionToken,
    connectionId: suite.testVcsConnectionId,
    connectionSlug: suite.testVcsConnectionSlug,
    owner: suite.testVcsAccountId,
    repositoryName,
    runnerLabel,
    configPath,
    workflowYaml: PROVIDER_FAILURE_WORKFLOW,
  });
  // The lease client retries transient 503 responses twice before surfacing the failure.
  await failNextTestVcsMints(3);

  const {terminal, logFiles} = await runWorkflow({
    suite,
    testInfo,
    definitionId: workflow.definition.id,
    scenario: 'renewable-credentials-provider-failure',
    runnerLabel,
    renewableGit: true,
  });
  const after = await getTestVcsStats({connectionId: suite.testVcsConnectionId});

  expect(terminal.status).toBe('failed');
  expect(terminal.jobs.find((job) => job.key === 'build')?.status).toBe('failed');
  expect(after.mint_count - before.mint_count).toBe(0);
  expect(after.generations.length - before.generations.length).toBe(0);
  expect(after.rejected_request_count - before.rejected_request_count).toBe(0);
  await assertNoCredentialLeak(after, logFiles);
});

async function seedTestVcsWorkflow(params: {
  suite: SuiteContext;
  token: string;
  connectionId: string;
  connectionSlug: string;
  owner: string;
  repositoryName: string;
  runnerLabel: string;
  configPath: string;
  workflowYaml: string;
  secondaryRepositoryName?: string | undefined;
}): Promise<{definition: Awaited<ReturnType<typeof waitForDefinition>>}> {
  const renderedWorkflowYaml = renderTestVcsWorkflow(params);
  const repository = await createTestVcsRepository({
    connectionId: params.connectionId,
    name: params.repositoryName,
    files: [
      {path: params.configPath, content: renderedWorkflowYaml},
      {path: 'README.md', content: '# Renewable credentials test VCS repository\n'},
    ],
  });
  const project = await createProject({
    workspaceId: params.suite.workspaceId,
    sessionToken: params.token,
    name: `Test VCS ${params.repositoryName}`,
    connectionId: params.connectionId,
    externalRepositoryId: repository.external_repository_id,
  });
  const definition = await waitForDefinition({
    projectId: project.id,
    configPath: params.configPath,
    token: params.token,
  });
  return {definition};
}

function renderTestVcsWorkflow(params: {
  connectionSlug: string;
  owner: string;
  repositoryName: string;
  runnerLabel: string;
  secondaryRepositoryName?: string | undefined;
  workflowYaml: string;
}): string {
  let rendered = params.workflowYaml
    .replaceAll('__RUNNER_LABEL__', params.runnerLabel)
    .replaceAll('__TEST_VCS_CONNECTION__', params.connectionSlug)
    .replaceAll('__TEST_VCS_REPOSITORY__', `${params.owner}/${params.repositoryName}`);
  if (params.secondaryRepositoryName !== undefined) {
    rendered = rendered.replaceAll(
      '__TEST_VCS_SECONDARY_REPOSITORY__',
      `${params.owner}/${params.secondaryRepositoryName}`,
    );
  }
  return rendered;
}

async function runWorkflow(params: {
  suite: SuiteContext;
  testInfo: {
    attach(name: string, options: {body: Buffer | string; contentType: string}): Promise<void>;
  };
  definitionId: string;
  scenario: string;
  runnerLabel: string;
  runnerCount?: number | undefined;
  renewableGit: boolean;
}): Promise<{terminal: WorkflowRunDetailResponseDto; logFiles: string[]}> {
  const token = params.suite.sessionToken;
  const client = createApiClient({token});
  const localRunners: Array<Awaited<ReturnType<typeof startSuiteLocalRunner>>> = [];

  try {
    for (let index = 0; index < (params.runnerCount ?? 1); index += 1) {
      localRunners.push(
        await startSuiteLocalRunner({
          workspaceId: params.suite.workspaceId,
          userToken: token,
          name: `E2E ${params.scenario} ${params.runnerCount === undefined ? '' : index + 1}`,
          runnerLabel: params.runnerLabel,
          runnerInstanceId:
            params.runnerCount === undefined || params.runnerCount === 1
              ? undefined
              : String(index + 1),
          extraEnv: {
            GIT_SSL_NO_VERIFY: 'true',
            SHIPFOX_POLL_MAX_DURATION_MS: String(RUNNER_TERMINAL_TIMEOUT_MS),
          },
          renewableGit: params.renewableGit,
        }),
      );
    }

    const runId = await fireManualAndAwaitRun({
      client,
      definitionId: params.definitionId,
      inputs: {},
      scenario: params.scenario,
    });
    const firstRunner = localRunners[0];
    if (firstRunner === undefined) {
      throw new Error('No local runner started');
    }
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: RUNNER_TERMINAL_TIMEOUT_MS,
      runner: firstRunner.runner,
    });
    return {terminal, logFiles: localRunners.map((localRunner) => localRunner.logFile)};
  } finally {
    for (const localRunner of localRunners) {
      await attachLocalRunnerLog(
        (attachment) =>
          params.testInfo.attach(attachment.name, {
            body: attachment.body,
            contentType: attachment.contentType,
          }),
        localRunner.logFile,
      );
      await stopLocalRunner(localRunner.runner).catch((error: unknown) => {
        process.stderr.write(`${params.scenario}-e2e: stopLocalRunner failed: ${String(error)}\n`);
      });
    }
  }
}

async function assertNoCredentialLeak(stats: TestVcsStats, logFiles: string[]): Promise<void> {
  const logs = await Promise.all(logFiles.map((logFile) => readFile(logFile, 'utf8')));
  expect(JSON.stringify(stats.requests)).not.toMatch(TEST_VCS_TOKEN_PATTERN);
  expect(logs.join('\n')).not.toMatch(TEST_VCS_TOKEN_PATTERN);
  expect(stats.requests.every((request) => !request.path.includes('Authorization:'))).toBe(true);
}

function shortId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 10);
}

function rejectedCredentialRequestCount(before: TestVcsStats, after: TestVcsStats): number {
  return after.requests.slice(before.request_count).filter((request) => {
    return request.status === 'rejected' && request.generation !== undefined;
  }).length;
}
