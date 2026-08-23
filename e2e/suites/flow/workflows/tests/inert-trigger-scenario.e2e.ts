import {createApiClient} from '@shipfox/e2e-core';
import {type LocalRunnerHandle, stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {waitForDefinitionSyncTerminal} from '#polling.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedWorkflowProject} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

// A definition whose only broken trigger is a cron trigger with a bad schedule
// must still sync: the broken trigger is inert and flagged, and the manual
// trigger in the same file keeps working.
const CONFIG_PATH = '.shipfox/workflows/inert-trigger.yml';

const workflowYaml = `
name: Inert trigger
runner: __RUNNER_LABEL__
triggers:
  nightly:
    source: cron
    event: tick
    config:
      schedule: "not a cron"
  on_demand:
    source: manual
    event: fire
jobs:
  build:
    steps:
      - key: show
        run: echo "manual_fired"
`;

interface AuthoredDocument {
  triggers: Record<string, {source: string}>;
}

test('a broken cron trigger is inert while the manual trigger keeps working', async ({suite}) => {
  const token = suite.sessionToken;
  const client = createApiClient({token});
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const runnerLabel = `e2e-inert-trigger-${uniqueId}`;
  const repo = `inert-trigger-${uniqueId}`;

  let runner: LocalRunnerHandle | undefined;
  try {
    const seeded = await seedWorkflowProject({
      suite,
      token,
      name: 'inert-trigger-scenario',
      repo,
      runnerLabel,
      workflowYaml,
      configPath: CONFIG_PATH,
    });

    const sync = await waitForDefinitionSyncTerminal({
      projectId: seeded.project.id,
      token,
      timeoutMs: 60_000,
    });
    expect(sync.sync?.status).toBe('succeeded');
    expect(sync.sync?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-cron-schedule',
          severity: 'error',
          path: 'triggers.nightly.config.schedule',
          file_path: CONFIG_PATH,
        }),
      ]),
    );

    const definition = sync.definitions.find((candidate) => candidate.config_path === CONFIG_PATH);
    expect(definition).toBeDefined();
    // The authored document keeps the broken entry; the model drops it, so the
    // Run button stays available through the active manual trigger.
    const document = definition?.workflow_document as AuthoredDocument;
    expect(document.triggers.nightly?.source).toBe('cron');
    expect(definition?.manual_trigger).toEqual({name: 'on_demand'});

    const localRunner = await startSuiteLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: token,
      name: `E2E inert trigger ${uniqueId}`,
      runnerLabel,
    });
    runner = localRunner.runner;

    const definitionId = definition?.id;
    if (definitionId === undefined) {
      throw new Error(`Definition missing for ${CONFIG_PATH}`);
    }

    const runId = await fireManualAndAwaitRun({
      client,
      definitionId,
      inputs: {},
      scenario: 'inert-trigger-scenario',
    });
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: 180_000,
      runner,
    });

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'build')?.status).toBe('succeeded');
  } finally {
    if (runner !== undefined) {
      await stopLocalRunner(runner).catch((error: unknown) => {
        process.stderr.write(`platform-e2e: stopLocalRunner failed: ${String(error)}\n`);
      });
    }
  }
});
