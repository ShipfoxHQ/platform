import type {DefinitionResponseDto} from '@shipfox/api-definitions-dto';
import type {ProjectResponseDto} from '@shipfox/api-projects-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createAnthropicFakeModelProviderConfig} from '@shipfox/e2e-setup-agent';
import {createGithubConnection} from '@shipfox/e2e-setup-integrations';
import {createProject as createE2eProject} from '@shipfox/e2e-setup-projects';
import {
  attachLocalRunnerLog,
  collectStepLogAttachmentRequests,
  fetchLogAttachment,
} from '#attachments.js';
import {
  GITHUB_GRAPHQL_RESULT_MARKER,
  GITHUB_READ_RESULT_MARKER,
  GITHUB_SEARCH_RESULT_MARKER,
  GITHUB_STATEFUL_INSTALLATION_TOKEN,
  GITHUB_STATELESS_INSTALLATION_TOKEN,
  GITHUB_WRITE_RESULT_MARKER,
  type GithubApiMock,
  startGithubApiMock,
} from '#github-api.js';
import {waitForDefinitionSyncTerminal} from '#polling.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {renderWorkflowYaml, seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const CLAUDE_AGENT_MODEL = 'deterministic-github-tools-agent';
const TERMINAL_TIMEOUT_MS = 60_000;
const GITHUB_REPOSITORY_ID = 42;
const GITHUB_REPOSITORY_EXTERNAL_ID = `github:${GITHUB_REPOSITORY_ID}`;
const GITHUB_OUTSIDE_REPOSITORY_NAME = 'shipfox/outside';
const BEARER_AUTHORIZATION = /^bearer /iu;
const GITHUB_TOKEN_CASES = [
  {
    format: 'stateless',
    token: GITHUB_STATELESS_INSTALLATION_TOKEN,
    authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`,
  },
  {
    format: 'stateful',
    token: GITHUB_STATEFUL_INSTALLATION_TOKEN,
    authorization: `token ${GITHUB_STATEFUL_INSTALLATION_TOKEN}`,
  },
] as const;

test.describe.configure({mode: 'serial'});

for (const tokenCase of GITHUB_TOKEN_CASES) {
  test(`runs selected GitHub tools with a ${tokenCase.format} token`, async ({suite}, testInfo) => {
    const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
    const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
    const githubApi = await startGithubApiMock({
      installationId,
      installationToken: tokenCase.token,
    });
    let fakeModelProvider: Awaited<ReturnType<typeof startFakeOpenAiModelProvider>> | undefined;

    try {
      const scriptId = `${suite.runId}-github-agent-tools-${uniqueId}`;
      fakeModelProvider = await startFakeOpenAiModelProvider({
        runId: `${suite.runId}-github-agent-tools-${uniqueId}`,
      });
      const connection = await createGithubConnection({
        workspaceId: suite.workspaceId,
        installationId,
        accountLogin: `e${uniqueId.slice(0, 5)}`,
        displayName: `GitHub E2E ${uniqueId}`,
        installerUserId: crypto.randomUUID(),
        lifecycleStatus: 'disabled',
      });
      const project = await createE2eProject({
        workspaceId: suite.workspaceId,
        name: `GitHub E2E project ${uniqueId}`,
        sourceConnectionId: connection.id,
        sourceExternalRepositoryId: GITHUB_REPOSITORY_EXTERNAL_ID,
        sourceRepositoryOwner: 'shipfox',
        sourceRepositoryName: 'e2e',
        sourceDefaultBranch: 'main',
      });
      await activateGithubConnection(suite, connection.id);
      await waitForDefinitionSyncTerminal({
        projectId: project.id,
        token: suite.sessionToken,
        timeoutMs: TERMINAL_TIMEOUT_MS,
      });
      githubApi.calls.length = 0;
      const issueReadTool = `mcp__shipfox_integration_tools__${connection.slug}__issue_read`;
      const issueWriteTool = `mcp__shipfox_integration_tools__${connection.slug}__issue_write`;
      const searchIssuesTool = `mcp__shipfox_integration_tools__${connection.slug}__search_issues`;
      const reviewThreadTool = `mcp__shipfox_integration_tools__${connection.slug}__pull_request_review_thread_write`;
      const addIssueCommentTool = `mcp__shipfox_integration_tools__${connection.slug}__add_issue_comment`;
      const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
        workspaceId: suite.workspaceId,
        fakeModelProvider,
        scriptId,
        model: CLAUDE_AGENT_MODEL,
        responses: [
          toolCall(issueReadTool, {
            method: 'get',
            owner: 'shipfox',
            repo: 'e2e',
            issue_number: 1,
          }),
          toolCall(searchIssuesTool, {
            query: 'is:open',
            owner: 'shipfox',
            repo: 'e2e',
          }),
          toolCall(reviewThreadTool, {
            method: 'resolve',
            owner: 'shipfox',
            repo: 'e2e',
            thread_id: 'PRRT_kwDO_e2e',
          }),
          toolCall(issueWriteTool, {
            method: 'create',
            owner: 'shipfox',
            repo: 'e2e',
            title: 'Synthetic GitHub issue',
          }),
          message('done'),
        ],
        assertions: [
          {kind: 'model', equals: CLAUDE_AGENT_MODEL},
          {kind: 'tool_present', name: issueReadTool},
          {kind: 'tool_present', name: issueWriteTool},
          {kind: 'tool_present', name: searchIssuesTool},
          {kind: 'tool_present', name: reviewThreadTool},
          {kind: 'tool_absent', name: addIssueCommentTool},
          {
            kind: 'message_content_includes',
            value: GITHUB_READ_RESULT_MARKER,
            minRequestIndex: 1,
          },
          {
            kind: 'message_content_includes',
            value: GITHUB_SEARCH_RESULT_MARKER,
            minRequestIndex: 2,
          },
          {
            kind: 'message_content_includes',
            value: GITHUB_GRAPHQL_RESULT_MARKER,
            minRequestIndex: 3,
          },
          {
            kind: 'message_content_includes',
            value: GITHUB_WRITE_RESULT_MARKER,
            minRequestIndex: 4,
          },
        ],
        setAsDefault: true,
      });

      const terminal = await runGithubToolsWorkflow({
        suite,
        testInfo,
        uniqueId,
        connectionSlug: connection.slug,
        runnerEnv: fakeAnthropic.runnerEnv,
      });

      expect(terminal.status).toBe('succeeded');
      expect(terminal.jobs.find((job) => job.key === 'tools')?.status).toBe('succeeded');
      const providerRequests = await fakeModelProvider.getRequests(scriptId);
      expect(providerRequests).toHaveLength(6);
      expect(providerRequests[0]).toMatchObject({
        model: `${CLAUDE_AGENT_MODEL}-small-fast`,
        served_response: 'message:non_consuming_model',
      });
      expect(
        providerRequests.filter((request) => request.model === CLAUDE_AGENT_MODEL),
      ).toHaveLength(5);
      expect(providerRequests.every((request) => request.assertion_failures.length === 0)).toBe(
        true,
      );
      expect(githubAgentToolCalls(githubApi)).toEqual([
        {
          kind: 'mint-token',
          authorization: expect.stringMatching(BEARER_AUTHORIZATION),
          tokenFormatOverride: 'enabled',
          installationId,
          body: {permissions: {issues: 'write', pull_requests: 'write'}},
        },
        {
          kind: 'read-issue',
          authorization: tokenCase.authorization,
          owner: 'shipfox',
          repo: 'e2e',
          issueNumber: 1,
        },
        {
          kind: 'search-issues',
          authorization: tokenCase.authorization,
          query: 'is:open repo:shipfox/e2e',
        },
        {
          kind: 'graphql',
          authorization: tokenCase.authorization,
          query: expect.stringContaining('resolveReviewThread'),
          variables: {input: {threadId: 'PRRT_kwDO_e2e'}},
        },
        {
          kind: 'create-issue',
          authorization: tokenCase.authorization,
          owner: 'shipfox',
          repo: 'e2e',
          body: {title: 'Synthetic GitHub issue'},
        },
      ]);
    } finally {
      await Promise.all([
        fakeModelProvider?.stop()?.catch((error: unknown) => {
          process.stderr.write(
            `github-agent-tools-e2e: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
          );
        }) ?? Promise.resolve(),
        githubApi.stop().catch((error: unknown) => {
          process.stderr.write(
            `github-agent-tools-e2e: stopGithubApiMock failed: ${String(error)}\n`,
          );
        }),
      ]);
    }
  });
}

test('enforces selected GitHub authorization for deterministic tools', async ({
  suite,
}, testInfo) => {
  const uniqueId = shortId();
  const fixture = await createGithubFixture(suite, uniqueId);

  try {
    const result = await runGithubWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'github-selected-tool',
      workflowYaml: deterministicToolWorkflow({
        connection: fixture.connection.slug,
        tool: 'issue_read.get',
        with: {owner: 'shipfox', repo: 'e2e', issue_number: 1},
        outputs: {marker: `\${{ result.marker }}`},
        verification: {
          env: {MARKER: `\${{ steps.github.outputs.marker }}`},
          run: `test "$MARKER" = "${GITHUB_READ_RESULT_MARKER}"`,
        },
      }),
    });

    expect(result.terminal.status).toBe('succeeded');
    expect(result.terminal.jobs.find((job) => job.key === 'tools')?.status).toBe('succeeded');
    expect(githubAgentToolCalls(fixture.githubApi)).toEqual([
      {
        kind: 'mint-token',
        authorization: expect.any(String),
        tokenFormatOverride: 'enabled',
        installationId: fixture.installationId,
        body: {permissions: {issues: 'read'}},
      },
      {
        kind: 'read-issue',
        authorization: `bearer ${fixture.installationToken}`,
        owner: 'shipfox',
        repo: 'e2e',
        issueNumber: 1,
      },
    ]);
  } finally {
    await fixture.githubApi.stop();
  }
});

test('denies a selected GitHub tool target outside Shipfox projects', async ({suite}, testInfo) => {
  const uniqueId = shortId();
  const fixture = await createGithubFixture(suite, uniqueId);

  try {
    const result = await runGithubWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'github-selected-tool-denied',
      workflowYaml: deterministicToolWorkflow({
        connection: fixture.connection.slug,
        tool: 'issue_read.get',
        with: {owner: 'shipfox', repo: 'outside', issue_number: 1},
      }),
    });

    expect(result.terminal.status).toBe('failed');
    expect(result.terminal.jobs.find((job) => job.key === 'tools')?.status).toBe('failed');
    expect(result.failureLogs).toContain(
      'Repository is not authorized for this integration connection',
    );
    expect(result.failureLogs).not.toContain(fixture.installationToken);
    expect(githubAgentToolCalls(fixture.githubApi)).toEqual([]);
  } finally {
    await fixture.githubApi.stop();
  }
});

test('requires an explicit repository for selected GitHub search', async ({suite}, testInfo) => {
  const uniqueId = shortId();
  const fixture = await createGithubFixture(suite, uniqueId);

  try {
    const result = await runGithubWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'github-search-repository-required',
      workflowYaml: deterministicToolWorkflow({
        connection: fixture.connection.slug,
        tool: 'search_issues',
        with: {query: 'is:open'},
      }),
    });

    expect(result.terminal.status).toBe('failed');
    expect(result.failureLogs).toContain(
      'Selected repository access requires owner and repo parameters',
    );
    expect(result.failureLogs).not.toContain(fixture.installationToken);
    expect(githubAgentToolCalls(fixture.githubApi)).toEqual([]);
  } finally {
    await fixture.githubApi.stop();
  }
});

test('rejects GitHub search qualifiers before provider dispatch', async ({suite}, testInfo) => {
  const uniqueId = shortId();
  const fixture = await createGithubFixture(suite, uniqueId);

  try {
    const result = await runGithubWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'github-search-qualifier',
      workflowYaml: deterministicToolWorkflow({
        connection: fixture.connection.slug,
        tool: 'search_issues',
        with: {query: 'repo:outside', owner: 'shipfox', repo: 'e2e'},
      }),
    });

    expect(result.terminal.status).toBe('failed');
    expect(result.failureLogs).toContain(
      'Search query cannot contain repo:, org:, or user: qualifiers',
    );
    expect(result.failureLogs).not.toContain(fixture.installationToken);
    expect(githubAgentToolCalls(fixture.githubApi)).toEqual([]);
  } finally {
    await fixture.githubApi.stop();
  }
});

test('allows an all-mode GitHub tool target outside Shipfox projects', async ({
  suite,
}, testInfo) => {
  const uniqueId = shortId();
  const fixture = await createGithubFixture(suite, uniqueId);

  try {
    await setRepositoryAccessMode(suite, fixture.connection.id, 'all');
    const result = await runGithubWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'github-all-tool',
      workflowYaml: deterministicToolWorkflow({
        connection: fixture.connection.slug,
        tool: 'issue_read.get',
        with: {owner: 'shipfox', repo: 'outside', issue_number: 1},
      }),
    });

    expect(result.terminal.status).toBe('succeeded');
    expect(githubAgentToolCalls(fixture.githubApi)).toEqual([
      {
        kind: 'mint-token',
        authorization: expect.any(String),
        tokenFormatOverride: 'enabled',
        installationId: fixture.installationId,
        body: {permissions: {issues: 'read'}},
      },
      {
        kind: 'read-issue',
        authorization: `bearer ${fixture.installationToken}`,
        owner: 'shipfox',
        repo: 'outside',
        issueNumber: 1,
      },
    ]);
  } finally {
    await fixture.githubApi.stop();
  }
});

test('mints a GitHub checkout token for a selected project repository by ID', async ({
  suite,
}, testInfo) => {
  const uniqueId = shortId();
  const fixture = await createGithubFixture(suite, uniqueId);

  try {
    const result = await runGithubWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'github-checkout-selected-id',
      workflowYaml: checkoutWorkflow({}),
      project: fixture.project,
    });

    expect(result.terminal.status).toBe('failed');
    expect(result.failureLogs).not.toContain(fixture.installationToken);
    expect(githubAgentToolCalls(fixture.githubApi)).toEqual([
      {
        kind: 'mint-token',
        authorization: expect.any(String),
        tokenFormatOverride: 'enabled',
        installationId: fixture.installationId,
        body: {
          repository_ids: [GITHUB_REPOSITORY_ID],
          permissions: {contents: 'read'},
        },
      },
    ]);
  } finally {
    await fixture.githubApi.stop();
  }
});

test('denies a selected GitHub checkout target outside Shipfox projects', async ({
  suite,
}, testInfo) => {
  const uniqueId = shortId();
  const fixture = await createGithubFixture(suite, uniqueId);

  try {
    const result = await runGithubWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'github-checkout-selected-denied',
      workflowYaml: checkoutWorkflow({
        connection: fixture.connection.slug,
        repository: GITHUB_OUTSIDE_REPOSITORY_NAME,
      }),
    });

    expect(result.terminal.status).toBe('failed');
    expect(result.failureLogs).toContain(
      'Checkout step failed because Shipfox could not grant repository access.',
    );
    expect(result.failureLogs).not.toContain(fixture.installationToken);
    expect(githubAgentToolCalls(fixture.githubApi)).toEqual([]);
  } finally {
    await fixture.githubApi.stop();
  }
});

test('mints a GitHub checkout token for an all-mode repository name', async ({suite}, testInfo) => {
  const uniqueId = shortId();
  const fixture = await createGithubFixture(suite, uniqueId);

  try {
    await setRepositoryAccessMode(suite, fixture.connection.id, 'all');
    const result = await runGithubWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'github-checkout-all-name',
      workflowYaml: checkoutWorkflow({
        connection: fixture.connection.slug,
        repository: GITHUB_OUTSIDE_REPOSITORY_NAME,
      }),
    });

    expect(result.terminal.status).toBe('failed');
    expect(result.failureLogs).not.toContain(fixture.installationToken);
    expect(githubAgentToolCalls(fixture.githubApi)).toEqual([
      {
        kind: 'mint-token',
        authorization: expect.any(String),
        tokenFormatOverride: 'enabled',
        installationId: fixture.installationId,
        body: {
          repositories: ['outside'],
          permissions: {contents: 'read'},
        },
      },
    ]);
  } finally {
    await fixture.githubApi.stop();
  }
});

async function createGithubFixture(suite: SuiteContext, uniqueId: string): Promise<GithubFixture> {
  const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
  const installationToken = `ghs_${uniqueId}.${'e'.repeat(36)}.${'f'.repeat(36)}`;
  const githubApi = await startGithubApiMock({installationId, installationToken});

  try {
    const connection = await createGithubConnection({
      workspaceId: suite.workspaceId,
      installationId,
      accountLogin: `e${uniqueId.slice(0, 5)}`,
      displayName: `GitHub authorization ${uniqueId}`,
      installerUserId: crypto.randomUUID(),
      lifecycleStatus: 'disabled',
    });
    const project = await createE2eProject({
      workspaceId: suite.workspaceId,
      name: `GitHub authorization project ${uniqueId}`,
      sourceConnectionId: connection.id,
      sourceExternalRepositoryId: GITHUB_REPOSITORY_EXTERNAL_ID,
      sourceRepositoryOwner: 'shipfox',
      sourceRepositoryName: 'e2e',
      sourceDefaultBranch: 'main',
    });
    await activateGithubConnection(suite, connection.id);
    await waitForDefinitionSyncTerminal({
      projectId: project.id,
      token: suite.sessionToken,
      timeoutMs: TERMINAL_TIMEOUT_MS,
    });
    githubApi.calls.length = 0;
    return {connection, githubApi, installationId, installationToken, project};
  } catch (error) {
    await githubApi.stop();
    throw error;
  }
}

interface GithubFixture {
  connection: {id: string; slug: string};
  githubApi: GithubApiMock;
  installationId: number;
  installationToken: string;
  project: ProjectResponseDto;
}

async function activateGithubConnection(suite: SuiteContext, connectionId: string): Promise<void> {
  const client = createApiClient({token: suite.sessionToken});
  await client.request('patch', `/integration-connections/${connectionId}`, {
    json: {lifecycle_status: 'active'},
  });
}

async function setRepositoryAccessMode(
  suite: SuiteContext,
  connectionId: string,
  mode: 'selected' | 'all',
): Promise<void> {
  const client = createApiClient({token: suite.sessionToken});
  await client.request('put', `/integration-connections/${connectionId}/repository-access`, {
    json: {mode},
  });
}

async function runGithubWorkflow(params: {
  suite: SuiteContext;
  testInfo: {
    attach: (name: string, options: {body: Buffer | string; contentType: string}) => Promise<void>;
  };
  uniqueId: string;
  scenario: string;
  workflowYaml: string;
  project?: ProjectResponseDto | undefined;
  replacements?: Record<string, string> | undefined;
}): Promise<{
  terminal: Awaited<ReturnType<typeof waitForRunTerminalOrFailedRunner>>;
  failureLogs: string;
}> {
  const token = params.suite.sessionToken;
  const client = createApiClient({token});
  const runnerLabel = `e2e-${params.scenario}-${params.uniqueId}`;
  const repo = `${params.scenario}-${params.uniqueId}`;
  const localRunner = await startSuiteLocalRunner({
    workspaceId: params.suite.workspaceId,
    userToken: token,
    name: `E2E ${params.scenario} ${params.uniqueId}`,
    runnerLabel,
    extraEnv: {SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS)},
  });

  let failureLogs = '';
  try {
    const definition =
      params.project === undefined
        ? (
            await seedAndWaitForDefinition({
              suite: params.suite,
              token,
              name: params.scenario,
              repo,
              runnerLabel,
              workflowYaml: params.workflowYaml,
              configPath: `.shipfox/workflows/${params.scenario}.yml`,
              replacements: params.replacements,
            })
          ).definition
        : await createManualDefinition({
            client,
            project: params.project,
            workflowYaml: renderWorkflowYaml({
              suite: params.suite,
              repo,
              runnerLabel,
              workflowYaml: params.workflowYaml,
              replacements: params.replacements,
            }),
          });
    const runId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs: {},
      scenario: params.scenario,
    });
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
    });

    if (terminal.status !== 'succeeded') {
      for (const request of collectStepLogAttachmentRequests(terminal)) {
        const attachment = await fetchLogAttachment(request, token);
        failureLogs += `\n${attachment.body}`;
        await params.testInfo.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        });
      }
    }
    return {terminal, failureLogs};
  } finally {
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

async function createManualDefinition(params: {
  client: ReturnType<typeof createApiClient>;
  project: ProjectResponseDto;
  workflowYaml: string;
}): Promise<DefinitionResponseDto> {
  return await params.client.requestJson<DefinitionResponseDto>('post', '/definitions', {
    json: {
      project_id: params.project.id,
      source: 'manual',
      yaml: params.workflowYaml,
    },
  });
}

function deterministicToolWorkflow(params: {
  connection: string;
  tool: string;
  with: Record<string, string | number>;
  outputs?: Record<string, string> | undefined;
  verification?: {env: Record<string, string>; run: string} | undefined;
}): string {
  const outputs =
    params.outputs === undefined ? '' : `\n        outputs: ${JSON.stringify(params.outputs)}`;
  const verification =
    params.verification === undefined
      ? ''
      : `\n      - key: verify\n        env: ${JSON.stringify(params.verification.env)}\n        run: ${JSON.stringify(params.verification.run)}`;
  return `
name: GitHub deterministic tool
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  tools:
    steps:
      - key: github
        tool: ${params.tool}
        connection: ${params.connection}
        with: ${JSON.stringify(params.with)}${outputs}${verification}
`;
}

function checkoutWorkflow(params: {
  connection?: string | undefined;
  repository?: string | undefined;
}): string {
  if (params.connection === undefined || params.repository === undefined) {
    return `
name: GitHub checkout
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  checkout:
    checkout:
      permissions:
        contents: read
    steps:
      - key: fail-after-checkout
        run: exit 1
`;
  }

  return `
name: GitHub checkout
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  checkout:
    checkout: false
    steps:
      - key: repository
        checkout:
          connection: ${JSON.stringify(params.connection)}
          repository: ${JSON.stringify(params.repository)}
          permissions:
            contents: read
`;
}

function shortId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 10);
}

function githubAgentToolCalls(githubApi: GithubApiMock): GithubApiMock['calls'] {
  // Source metadata lookups can finish after definition sync reports terminal, so keep
  // background repository-resolution calls out of the agent-tool request trace.
  return githubApi.calls.filter((call) => call.kind !== 'resolve-repository');
}

async function runGithubToolsWorkflow(params: {
  suite: SuiteContext;
  testInfo: {
    attach: (name: string, options: {body: Buffer | string; contentType: string}) => Promise<void>;
  };
  uniqueId: string;
  connectionSlug: string;
  runnerEnv: Record<string, string>;
}) {
  const token = params.suite.sessionToken;
  const client = createApiClient({token});
  const scenario = 'github-agent-tools';
  const runnerLabel = `e2e-${scenario}-${params.uniqueId}`;
  const repo = `${scenario}-${params.uniqueId}`;
  const localRunner = await startSuiteLocalRunner({
    workspaceId: params.suite.workspaceId,
    userToken: token,
    name: `E2E ${scenario} ${params.uniqueId}`,
    runnerLabel,
    extraEnv: {
      ...params.runnerEnv,
      SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS),
    },
  });

  try {
    const {definition} = await seedAndWaitForDefinition({
      suite: params.suite,
      token,
      name: scenario,
      repo,
      runnerLabel,
      workflowYaml: githubToolsWorkflowYaml(params.connectionSlug),
      configPath: `.shipfox/workflows/${scenario}.yml`,
    });
    const runId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs: {},
      scenario,
    });

    const terminal = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
    });
    if (terminal.status !== 'succeeded') {
      for (const request of collectStepLogAttachmentRequests(terminal)) {
        const attachment = await fetchLogAttachment(request, token);
        await params.testInfo.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        });
      }
    }

    return terminal;
  } finally {
    await attachLocalRunnerLog(
      (attachment) =>
        params.testInfo.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        }),
      localRunner.logFile,
    );
    await stopLocalRunner(localRunner.runner).catch((error: unknown) => {
      process.stderr.write(`${scenario}-e2e: stopLocalRunner failed: ${String(error)}\n`);
    });
  }
}

function githubToolsWorkflowYaml(connectionSlug: string): string {
  return `
name: GitHub agent tools
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  tools:
    steps:
      - key: github
        harness: claude
        thinking: low
        prompt: Use the selected GitHub tools.
        integrations:
          - connection: ${connectionSlug}
            include:
              - issue_read.get
              - issue_write.create
              - search_issues
              - pull_request_review_thread_write.resolve
            allow_write: true
`;
}
