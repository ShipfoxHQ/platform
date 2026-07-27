import {createApiClient} from '@shipfox/e2e-core';
import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {fetchStepLogs} from '@shipfox/e2e-observe-logs';
import {createAnthropicFakeModelProviderConfig} from '@shipfox/e2e-setup-agent';
import {attachLocalRunnerLog} from '#attachments.js';
import {logText} from '#expect.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const CLAUDE_AGENT_MODEL = 'deterministic-claude-agent';
const TERMINAL_TIMEOUT_MS = 60_000;

const SMOKE_WORKFLOW_YAML = `
name: Claude deterministic agent
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  fix:
    steps:
      - key: reply
        harness: claude
        thinking: low
        prompt: 'Reply with exactly: ok'
`;

const OUTPUT_WORKFLOW_YAML = `
name: Claude deterministic output tool
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  fix:
    steps:
      - key: produce
        harness: claude
        thinking: low
        prompt: |
          Set the message output.
        outputs:
          message: string
      - key: consume
        env:
          MESSAGE: \${{ steps.produce.outputs.message }}
        run: |
          echo "agent_message=$MESSAGE"
`;

test('runs a Claude harness step against the deterministic Anthropic endpoint', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const fakeModelProvider = await startFakeOpenAiModelProvider({
    runId: `${suite.runId}-claude-smoke-${uniqueId}`,
  });

  try {
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId: `${suite.runId}-claude-smoke-${uniqueId}`,
      model: CLAUDE_AGENT_MODEL,
      responses: [message('ok')],
      assertions: [{kind: 'model', equals: CLAUDE_AGENT_MODEL}],
      setAsDefault: true,
    });

    const terminal = await runClaudeWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'claude-agent',
      workflowYaml: SMOKE_WORKFLOW_YAML,
      runnerEnv: fakeAnthropic.runnerEnv,
    });

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'fix')?.status).toBe('succeeded');
  } finally {
    await fakeModelProvider.stop().catch((error: unknown) => {
      process.stderr.write(
        `claude-agent-e2e: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
      );
    });
  }
});

test('runs Claude set_output through downstream interpolation', async ({suite}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const fakeModelProvider = await startFakeOpenAiModelProvider({
    runId: `${suite.runId}-claude-output-${uniqueId}`,
  });

  try {
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId: `${suite.runId}-claude-output-${uniqueId}`,
      model: CLAUDE_AGENT_MODEL,
      responses: [
        toolCall('mcp__shipfox_outputs__set_output', {
          key: 'message',
          value: 'claude-tool-output-ok',
        }),
        message('done'),
      ],
      assertions: [
        {kind: 'model', equals: CLAUDE_AGENT_MODEL},
        {kind: 'tool_present', name: 'mcp__shipfox_outputs__set_output'},
        {kind: 'message_content_includes', value: 'repository-instruction-marker'},
      ],
      setAsDefault: true,
    });

    const terminal = await runClaudeWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'claude-agent-output-tool',
      workflowYaml: OUTPUT_WORKFLOW_YAML,
      runnerEnv: fakeAnthropic.runnerEnv,
      extraFiles: [
        {
          path: '.claude/settings.json',
          content: JSON.stringify({permissions: {disableBypassPermissionsMode: 'disable'}}),
        },
        {path: 'CLAUDE.md', content: 'repository-instruction-marker'},
      ],
    });
    const fixJob = terminal.jobs.find((job) => job.key === 'fix');
    const steps = fixJob?.job_executions.flatMap((execution) => execution.steps) ?? [];
    const produceStep = steps.find((step) => step.key === 'produce');
    const consumeStep = steps.find((step) => step.key === 'consume');
    const executionSucceeded =
      terminal.status === 'succeeded' &&
      fixJob?.status === 'succeeded' &&
      produceStep?.status === 'succeeded' &&
      consumeStep?.status === 'succeeded';

    if (!executionSucceeded) {
      await testInfo.attach('run-detail.json', {
        body: JSON.stringify(terminal, null, 2),
        contentType: 'application/json',
      });
    }

    expect(terminal.status).toBe('succeeded');
    expect(fixJob?.status).toBe('succeeded');
    expect(produceStep?.status).toBe('succeeded');
    expect(consumeStep?.status).toBe('succeeded');

    if (consumeStep === undefined) throw new Error('consume step missing from run detail');
    const logs = await fetchStepLogs({
      stepId: consumeStep.id,
      attempt: consumeStep.current_attempt,
      token: suite.sessionToken,
    });

    expect(logText(logs.records)).toContain('agent_message=claude-tool-output-ok');
  } finally {
    await fakeModelProvider.stop().catch((error: unknown) => {
      process.stderr.write(
        `claude-agent-output-e2e: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
      );
    });
  }
});

async function runClaudeWorkflow(params: {
  suite: SuiteContext;
  testInfo: {
    attach: (name: string, options: {body: Buffer | string; contentType: string}) => Promise<void>;
  };
  uniqueId: string;
  scenario: string;
  workflowYaml: string;
  runnerEnv: Record<string, string>;
  extraFiles?: Array<{path: string; content: string}>;
}) {
  const token = params.suite.sessionToken;
  const client = createApiClient({token});
  const runnerLabel = `e2e-${params.scenario}-${params.uniqueId}`;
  const repo = `${params.scenario}-${params.uniqueId}`;
  const localRunner = await startSuiteLocalRunner({
    workspaceId: params.suite.workspaceId,
    userToken: token,
    name: `E2E ${params.scenario} ${params.uniqueId}`,
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
      name: params.scenario,
      repo,
      runnerLabel,
      workflowYaml: params.workflowYaml,
      configPath: `.shipfox/workflows/${params.scenario}.yml`,
      extraFiles: params.extraFiles,
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
