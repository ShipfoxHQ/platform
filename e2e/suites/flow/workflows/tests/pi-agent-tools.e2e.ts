import type {WorkflowRunDetailResponseDto} from '@shipfox/api-workflows-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {
  createOpenAiCompatibleCustomProvider,
  deleteModelProviderConfig,
} from '@shipfox/e2e-setup-agent';
import {createLinearConnection} from '@shipfox/e2e-setup-integrations';
import {attachLocalRunnerLog} from '#attachments.js';
import {
  LINEAR_READ_RESULT_MARKER,
  LINEAR_WRITE_RESULT_MARKER,
  startLinearMcpMock,
} from '#linear-mcp.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const PI_AGENT_MODEL = 'deterministic-pi-agent-tools';
const TERMINAL_TIMEOUT_MS = 60_000;

test('runs Linear tools through the Pi integration-tools path', async ({suite}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const accessToken = `linear-pi-e2e-token-${uniqueId}`;
  const mcpMock = await startLinearMcpMock();
  let fakeModelProvider: Awaited<ReturnType<typeof startFakeOpenAiModelProvider>> | undefined;
  let providerId: string | undefined;

  try {
    fakeModelProvider = await startFakeOpenAiModelProvider({
      runId: `${suite.runId}-pi-integration-tools-${uniqueId}`,
    });
    const connection = await createLinearConnection({
      workspaceId: suite.workspaceId,
      organizationId: `linear-pi-org-${uniqueId}`,
      organizationUrlKey: `pi-e2e-${uniqueId}`,
      appUserId: `linear-pi-app-user-${uniqueId}`,
      displayName: `Linear Pi E2E ${uniqueId}`,
      accessToken,
    });
    const getIssueTool = `${connection.slug}__get_issue`;
    const saveCommentTool = `${connection.slug}__save_comment`;
    const script = await fakeModelProvider.createScript({
      id: `${suite.runId}-pi-integration-tools-${uniqueId}`,
      model: PI_AGENT_MODEL,
      responses: [
        message('provider probe ok'),
        toolCall('mcp', {tool: getIssueTool, args: JSON.stringify({id: 'ENG-878'})}),
        toolCall('mcp', {
          tool: saveCommentTool,
          args: JSON.stringify({
            issueId: 'ENG-878',
            body: 'Synthetic Pi Linear comment',
          }),
        }),
        message('done'),
      ],
      assertions: [
        {kind: 'model', equals: PI_AGENT_MODEL},
        {kind: 'tool_present', name: 'mcp', minRequestIndex: 1},
        {
          kind: 'message_content_includes',
          value: LINEAR_READ_RESULT_MARKER,
          minRequestIndex: 2,
        },
        {
          kind: 'message_content_includes',
          value: LINEAR_WRITE_RESULT_MARKER,
          minRequestIndex: 3,
        },
      ],
    });
    const provider = await createOpenAiCompatibleCustomProvider({
      workspaceId: suite.workspaceId,
      sessionToken: suite.sessionToken,
      providerId: `fake-pi-integration-tools-${uniqueId}`,
      displayName: `Fake Pi Integration Tools ${uniqueId}`,
      baseUrl: script.modelProviderBaseUrl,
      model: script.model,
    });
    providerId = provider.provider_id;

    const terminal = await runPiAgentWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'pi-integration-tools',
      workflowYaml: piIntegrationToolsWorkflowYaml({
        connectionSlug: connection.slug,
        provider: provider.provider_id,
        model: script.model,
      }),
    });
    await attachPiFailureDiagnostics({
      fakeModelProvider,
      scriptId: script.id,
      terminal,
      testInfo,
    });

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'tools')?.status).toBe('succeeded');
    expect(mcpMock.calls).toEqual([
      {
        authorization: `Bearer ${accessToken}`,
        arguments: {id: 'ENG-878'},
        toolName: 'get_issue',
      },
      {
        authorization: `Bearer ${accessToken}`,
        arguments: {issueId: 'ENG-878', body: 'Synthetic Pi Linear comment'},
        toolName: 'save_comment',
      },
    ]);
  } finally {
    if (providerId !== undefined) {
      await deleteModelProviderConfig({
        workspaceId: suite.workspaceId,
        sessionToken: suite.sessionToken,
        providerId,
      }).catch(() => undefined);
    }
    await Promise.all([
      fakeModelProvider?.stop()?.catch((error: unknown) => {
        process.stderr.write(
          `pi-integration-tools-e2e: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
        );
      }) ?? Promise.resolve(),
      mcpMock.stop().catch((error: unknown) => {
        process.stderr.write(
          `pi-integration-tools-e2e: stopLinearMcpMock failed: ${String(error)}\n`,
        );
      }),
    ]);
  }
});

test('loads the configured Pi web tools into the model request', async ({suite}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const fakeModelProvider = await startFakeOpenAiModelProvider({
    runId: `${suite.runId}-pi-web-tools-${uniqueId}`,
  });
  let providerId: string | undefined;

  try {
    const script = await fakeModelProvider.createScript({
      id: `${suite.runId}-pi-web-tools-${uniqueId}`,
      model: PI_AGENT_MODEL,
      responses: [message('provider probe ok'), message('done')],
      assertions: [
        {kind: 'model', equals: PI_AGENT_MODEL},
        {kind: 'tool_present', name: 'read', minRequestIndex: 1},
        {kind: 'tool_present', name: 'web_search', minRequestIndex: 1},
        {kind: 'tool_present', name: 'fetch_content', minRequestIndex: 1},
      ],
    });
    const provider = await createOpenAiCompatibleCustomProvider({
      workspaceId: suite.workspaceId,
      sessionToken: suite.sessionToken,
      providerId: `fake-pi-web-tools-${uniqueId}`,
      displayName: `Fake Pi Web Tools ${uniqueId}`,
      baseUrl: script.modelProviderBaseUrl,
      model: script.model,
    });
    providerId = provider.provider_id;

    const terminal = await runPiAgentWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'pi-web-tools',
      workflowYaml: piWebToolsWorkflowYaml({
        provider: provider.provider_id,
        model: script.model,
      }),
    });
    await attachPiFailureDiagnostics({
      fakeModelProvider,
      scriptId: script.id,
      terminal,
      testInfo,
    });

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'tools')?.status).toBe('succeeded');
  } finally {
    if (providerId !== undefined) {
      await deleteModelProviderConfig({
        workspaceId: suite.workspaceId,
        sessionToken: suite.sessionToken,
        providerId,
      }).catch(() => undefined);
    }
    await fakeModelProvider.stop().catch((error: unknown) => {
      process.stderr.write(
        `pi-web-tools-e2e: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
      );
    });
  }
});

async function runPiAgentWorkflow(params: {
  suite: SuiteContext;
  testInfo: {
    attach: (name: string, options: {body: Buffer | string; contentType: string}) => Promise<void>;
  };
  uniqueId: string;
  scenario: string;
  workflowYaml: string;
}): Promise<WorkflowRunDetailResponseDto> {
  const token = params.suite.sessionToken;
  const client = createApiClient({token});
  const runnerLabel = `e2e-${params.scenario}-${params.uniqueId}`;
  const localRunner = await startSuiteLocalRunner({
    workspaceId: params.suite.workspaceId,
    userToken: token,
    name: `E2E ${params.scenario} ${params.uniqueId}`,
    runnerLabel,
    extraEnv: {
      SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS),
    },
  });

  try {
    const {definition} = await seedAndWaitForDefinition({
      suite: params.suite,
      token,
      name: params.scenario,
      repo: `${params.scenario}-${params.uniqueId}`,
      runnerLabel,
      workflowYaml: params.workflowYaml,
      configPath: `.shipfox/workflows/${params.scenario}.yml`,
    });
    const runId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs: {},
      scenario: params.scenario,
    });

    return await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
    });
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

async function attachPiFailureDiagnostics(params: {
  fakeModelProvider: Awaited<ReturnType<typeof startFakeOpenAiModelProvider>>;
  scriptId: string;
  terminal: WorkflowRunDetailResponseDto;
  testInfo: {
    attach: (name: string, options: {body: Buffer | string; contentType: string}) => Promise<void>;
  };
}): Promise<void> {
  if (params.terminal.status === 'succeeded') return;

  const requests = await params.fakeModelProvider.getRequests(params.scriptId);
  await Promise.all([
    params.testInfo.attach('pi-agent-run.json', {
      body: JSON.stringify(params.terminal, null, 2),
      contentType: 'application/json',
    }),
    params.testInfo.attach('pi-agent-model-requests.json', {
      body: JSON.stringify(requests, null, 2),
      contentType: 'application/json',
    }),
  ]);
}

function piIntegrationToolsWorkflowYaml(params: {
  connectionSlug: string;
  provider: string;
  model: string;
}): string {
  return `
name: Pi integration tools
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  tools:
    steps:
      - key: linear
        harness: pi
        provider: ${params.provider}
        model: ${params.model}
        thinking: off
        prompt: Use the selected Linear tools.
        integrations:
          - connection: ${params.connectionSlug}
            include: [get_issue, save_comment]
            allow_write: true
`;
}

function piWebToolsWorkflowYaml(params: {provider: string; model: string}): string {
  return `
name: Pi web tools
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  tools:
    steps:
      - key: inspect
        harness: pi
        provider: ${params.provider}
        model: ${params.model}
        thinking: off
        tools: [read, web_search, fetch_content]
        prompt: Confirm the configured tools are available.
`;
}
