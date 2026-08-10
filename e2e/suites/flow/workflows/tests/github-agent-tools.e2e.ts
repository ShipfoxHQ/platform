import {createApiClient} from '@shipfox/e2e-core';
import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createAnthropicFakeModelProviderConfig} from '@shipfox/e2e-setup-agent';
import {createGithubConnection} from '@shipfox/e2e-setup-integrations';
import {
  attachLocalRunnerLog,
  collectStepLogAttachmentRequests,
  fetchLogAttachment,
} from '#attachments.js';
import {
  GITHUB_INSTALLATION_TOKEN,
  GITHUB_READ_RESULT_MARKER,
  GITHUB_WRITE_RESULT_MARKER,
  startGithubApiMock,
} from '#github-api.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const CLAUDE_AGENT_MODEL = 'deterministic-github-tools-agent';
const TERMINAL_TIMEOUT_MS = 60_000;
const BEARER_AUTHORIZATION = /^bearer /iu;

test.describe.configure({mode: 'serial'});

test('runs selected GitHub tools and denies unselected authority', async ({suite}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
  const githubApi = await startGithubApiMock();
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
    });
    const issueReadTool = `mcp__shipfox_integration_tools__${connection.slug}__issue_read`;
    const issueWriteTool = `mcp__shipfox_integration_tools__${connection.slug}__issue_write`;
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
        toolCall(issueWriteTool, {
          method: 'create',
          owner: 'shipfox',
          repo: 'e2e',
          title: 'Synthetic GitHub issue',
        }),
        toolCall(issueReadTool, {
          method: 'get_comments',
          owner: 'shipfox',
          repo: 'e2e',
          issue_number: 1,
        }),
        toolCall(addIssueCommentTool, {
          owner: 'shipfox',
          repo: 'e2e',
          issue_number: 1,
          body: 'This tool was not selected',
        }),
        message('done'),
      ],
      assertions: [
        {kind: 'model', equals: CLAUDE_AGENT_MODEL},
        {kind: 'tool_present', name: issueReadTool},
        {kind: 'tool_present', name: issueWriteTool},
        {kind: 'tool_absent', name: addIssueCommentTool},
        {
          kind: 'message_content_includes',
          value: GITHUB_READ_RESULT_MARKER,
          minRequestIndex: 1,
        },
        {
          kind: 'message_content_includes',
          value: GITHUB_WRITE_RESULT_MARKER,
          minRequestIndex: 2,
        },
        {
          kind: 'message_content_includes',
          value: 'Unauthorized integration tool method: get_comments',
          minRequestIndex: 3,
        },
        {
          kind: 'message_content_includes',
          value: 'No such tool available:',
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
    expect(providerRequests.filter((request) => request.model === CLAUDE_AGENT_MODEL)).toHaveLength(
      5,
    );
    expect(providerRequests.every((request) => request.assertion_failures.length === 0)).toBe(true);
    expect(githubApi.calls).toEqual([
      {
        kind: 'mint-token',
        authorization: expect.stringMatching(BEARER_AUTHORIZATION),
        tokenFormatOverride: 'enabled',
        installationId,
        body: {},
      },
      {
        kind: 'read-issue',
        authorization: `bearer ${GITHUB_INSTALLATION_TOKEN}`,
        owner: 'shipfox',
        repo: 'e2e',
        issueNumber: 1,
      },
      {
        kind: 'create-issue',
        authorization: `bearer ${GITHUB_INSTALLATION_TOKEN}`,
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
            include: [issue_read.get, issue_write.create]
            allow_write: true
`;
}
