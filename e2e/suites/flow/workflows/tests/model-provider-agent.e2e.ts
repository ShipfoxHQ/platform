import {createApiClient} from '@shipfox/e2e-core';
import {message, startFakeOpenAiModelProvider} from '@shipfox/e2e-driver-model-provider';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import type {WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';
import {
  createAnthropicFakeModelProviderConfig,
  createOpenAiCompatibleCustomProvider,
  deleteModelProviderConfig,
} from '@shipfox/e2e-setup-agent';
import {attachLocalRunnerLog} from '#attachments.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const CLAUDE_CONFIG_MODEL = 'claude-opus-4-8';
const CLAUDE_FAKE_MODEL = 'deterministic-claude-smoke-agent';
const OPENAI_FAKE_MODEL = 'deterministic-openai-smoke-agent';
const OPENAI_SMOKE_MAX_OUTPUT_TOKENS = 64;
const OPENAI_SMOKE_RESPONSE_COUNT = 4;
const TERMINAL_TIMEOUT_MS = 60_000;

test.describe.configure({mode: 'serial'});

test('runs a Claude harness smoke workflow against the fake Anthropic endpoint', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const fakeModelProvider = await startFakeOpenAiModelProvider({
    runId: `${suite.runId}-claude-provider-smoke-${uniqueId}`,
  });

  try {
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId: `${suite.runId}-claude-provider-smoke-${uniqueId}`,
      model: CLAUDE_FAKE_MODEL,
      configDefaultModel: CLAUDE_CONFIG_MODEL,
      responses: [message('ok')],
      assertions: [{kind: 'model', equals: CLAUDE_FAKE_MODEL}],
    });

    const terminal = await runFakeModelProviderWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'claude-fake-model-agent',
      workflowYaml: workflowYaml({
        name: 'Claude fake model agent',
        harness: 'claude',
        thinking: 'low',
        provider: 'anthropic',
        model: CLAUDE_CONFIG_MODEL,
      }),
      runnerEnv: fakeAnthropic.runnerEnv,
    });

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'fix')?.status).toBe('succeeded');
    expect(stepResponse(terminal, 'fix', 'reply').trim()).toBe('ok');
  } finally {
    await fakeModelProvider.stop().catch((error: unknown) => {
      process.stderr.write(
        `claude-fake-model-agent-e2e: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
      );
    });
  }
});

test('runs a Pi harness smoke workflow against the fake OpenAI-compatible endpoint', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const fakeModelProvider = await startFakeOpenAiModelProvider({
    runId: `${suite.runId}-pi-provider-smoke-${uniqueId}`,
  });

  let providerId: string | undefined;
  try {
    const script = await fakeModelProvider.createScript({
      id: `${suite.runId}-pi-provider-smoke-${uniqueId}`,
      model: OPENAI_FAKE_MODEL,
      responses: openAiSmokeResponses(),
      assertions: [{kind: 'model', equals: OPENAI_FAKE_MODEL}],
    });
    const provider = await createOpenAiCompatibleCustomProvider({
      workspaceId: suite.workspaceId,
      sessionToken: suite.sessionToken,
      providerId: `fake-openai-smoke-${uniqueId}`,
      displayName: `Fake OpenAI Smoke ${uniqueId}`,
      baseUrl: script.modelProviderBaseUrl,
      model: script.model,
      modelMetadata: {max_output_tokens: OPENAI_SMOKE_MAX_OUTPUT_TOKENS},
    });
    providerId = provider.provider_id;

    const terminal = await runFakeModelProviderWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'pi-fake-model-agent',
      workflowYaml: workflowYaml({
        name: 'Pi fake model agent',
        harness: 'pi',
        thinking: 'off',
        provider: provider.provider_id,
        model: script.model,
      }),
      runnerEnv: {},
    });

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'fix')?.status).toBe('succeeded');
    expect(stepResponse(terminal, 'fix', 'reply').trim()).toBe('ok');
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
        `pi-fake-model-agent-e2e: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
      );
    });
  }
});

function workflowYaml(params: {
  name: string;
  harness: 'claude' | 'pi';
  thinking: 'low' | 'off';
  provider: string;
  model: string;
}): string {
  return `
name: ${params.name}
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  fix:
    steps:
      - key: reply
        harness: ${params.harness}
        provider: ${params.provider}
        model: ${params.model}
        thinking: ${params.thinking}
        prompt: |
          Reply with exactly the word: ok
          Do not include any other text.
`;
}

async function runFakeModelProviderWorkflow(params: {
  suite: SuiteContext;
  testInfo: {
    attach: (name: string, options: {body: Buffer | string; contentType: string}) => Promise<void>;
  };
  uniqueId: string;
  scenario: string;
  workflowYaml: string;
  runnerEnv: Record<string, string>;
}): Promise<WorkflowRunObservation> {
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
      selection: {
        jobs: [{jobKey: 'fix', includeDefaultExecution: true, stepKeys: ['reply']}],
      },
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

function stepResponse(run: WorkflowRunObservation, jobKey: string, stepKey: string): string {
  const step = run.jobs
    .find((job) => job.key === jobKey)
    ?.executions.flatMap((execution) => execution.steps)
    .find((candidate) => candidate.key === stepKey);
  if (step === undefined)
    throw new Error(`Step ${jobKey}.${stepKey} missing from workflow observation`);
  if (step.response === null)
    throw new Error(`Step ${jobKey}.${stepKey} did not record a response`);
  return step.response;
}

function openAiSmokeResponses() {
  return Array.from({length: OPENAI_SMOKE_RESPONSE_COUNT}, () => message('ok'));
}
