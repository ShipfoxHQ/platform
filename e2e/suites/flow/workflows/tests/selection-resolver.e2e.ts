import {workflowRunSelectionResponseSchema} from '@shipfox/api-workflows-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {waitForRunTerminal} from '@shipfox/e2e-observe-workflows';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const SELECTION_RESOLVER_WORKFLOW = `
name: Selection resolver smoke
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  build:
    steps:
      - key: selection
        run: echo "selection resolver smoke"
`;

test('resolves an older step identity through the public selection API', async ({suite}) => {
  const token = suite.sessionToken;
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const repo = `selection-resolver-${uniqueId}`;
  const runnerLabel = `e2e-selection-resolver-${uniqueId}`;
  const client = createApiClient({token});
  const localRunner = await startSuiteLocalRunner({
    workspaceId: suite.workspaceId,
    userToken: token,
    name: `E2E selection resolver ${uniqueId}`,
    runnerLabel,
  });

  try {
    const {definition} = await seedProjectWithApiDefinition({
      suite,
      token,
      name: 'selection-resolver',
      repo,
      runnerLabel,
      workflowYaml: SELECTION_RESOLVER_WORKFLOW,
      configPath: '.shipfox/workflows/selection-resolver.yml',
    });
    const runId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs: {},
      scenario: repo,
    });
    const firstAttempt = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: 180_000,
      runner: localRunner.runner,
      selection: {
        jobs: [{jobKey: 'build', includeDefaultExecution: true, stepKeys: ['selection']}],
      },
    });
    const oldStepId = firstAttempt.jobs
      .find((job) => job.key === 'build')
      ?.executions[0]?.steps.find((step) => step.key === 'selection')?.id;
    if (!oldStepId) throw new Error('Expected the first-attempt selection step');

    await client.requestJson('post', `/workflows/runs/${encodeURIComponent(runId)}/rerun`, {
      json: {mode: 'all'},
    });
    const rerun = await waitForRunTerminal({runId, token, timeoutMs: 180_000});
    expect(rerun).toMatchObject({
      current_attempt: 2,
      latest_attempt: 2,
      attempt: {attempt: 2},
    });

    const selectionQuery = new URLSearchParams({step_id: oldStepId});
    const selection = workflowRunSelectionResponseSchema.parse(
      await client.requestJson(
        'get',
        `/workflows/runs/${encodeURIComponent(runId)}/selection?${selectionQuery}`,
      ),
    );

    expect(selection).toMatchObject({
      workflow_run_id: runId,
      workflow_run_attempt: 1,
      step_id: oldStepId,
    });
  } finally {
    await stopLocalRunner(localRunner.runner).catch(() => undefined);
  }
});
