import {setTimeout as delay} from 'node:timers/promises';
import type {
  TriggerEventDetailResponseDto,
  TriggerEventListResponseDto,
  TriggerEventOutcomeDto,
} from '@shipfox/api-triggers-dto';
import type {WorkflowRunListResponseDto} from '@shipfox/api-workflows-dto';
import {createApiClient, pollUntil} from '@shipfox/e2e-core';
import {
  type CommitFile,
  type CreatedRepo,
  commitFiles,
  createRepo,
} from '@shipfox/e2e-driver-gitea';
import {type LocalRunnerHandle, stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {
  observeRun,
  type WorkflowRunObservation,
  type WorkflowRunObservationSelection,
  waitForRunByCommit,
} from '@shipfox/e2e-observe-workflows';
import {attachLocalRunnerLog} from '#attachments.js';
import {
  findListenerJob,
  listenerDeliveryObserved,
  listenerExecutionCountMatches,
  listenerStatusMatches,
  sendWebhookDeliveryUntilObserved,
  waitForListenerResolution,
} from '#listener-helpers.js';
import {
  cleanupListenerCase,
  fireManualRun,
  LISTENER_JOB,
  type ListenerCase,
  setupListenerCase,
  stopRunner,
} from '#listener-jobs.js';
import {waitForRunObservationMatching} from '#polling.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {postWebhookDelivery} from '#webhook.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const TRIGGER_FILTER_NO_RUN_TIMEOUT_MS = 8_000;
const LISTENER_NEGATIVE_ASSERTION_MS = 5_000;
const MATCHING_PR_NUMBER = '42';
const NONMATCHING_PR_NUMBER = '41';

const triggerFilterWorkflow = `
name: Trigger filter
runner: __RUNNER_LABEL__
triggers:
  on_push:
    source: __GITEA_SOURCE__
    event: push
    filter: 'event.ref == "refs/heads/main" && event.repository.full_name == "__GITEA_REPOSITORY__"'
jobs:
  build:
    steps:
      - key: show
        run: echo "trigger_filter_matched"
`;

const listenerFilterWorkflow = `
name: Listener filter
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  create_pr:
    steps:
      - key: produce
        run: echo "pr_number=${MATCHING_PR_NUMBER}" >> "$SHIPFOX_OUTPUT"
    outputs:
      pr_number: \${{ steps.produce.outputs.pr_number }}
  listen:
    needs: [create_pr]
    listening:
      on:
        - source: __FIRE_WEBHOOK_SOURCE__
          event: received
          filter: 'event.body.issue.number == jobs.create_pr.outputs.pr_number'
      until:
        - source: __RESOLVE_WEBHOOK_SOURCE__
          event: received
          filter: 'event.body.pull_request.number == jobs.create_pr.outputs.pr_number'
    steps:
      - key: show_event
        env:
          ISSUE_NUMBER: '\${{ execution.events[0].data.body.issue.number }}'
          DELIVERY_ID: '\${{ execution.events[0].delivery_id }}'
        run: |
          echo "listener_issue=$ISSUE_NUMBER"
          echo "listener_delivery=$DELIVERY_ID"
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nestedString(value: unknown, path: string[]): string | undefined {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

function eventPayloadAfter(detail: TriggerEventDetailResponseDto): string | undefined {
  return nestedString(detail.payload, ['after']);
}

function eventPayloadRepositoryFullName(detail: TriggerEventDetailResponseDto): string | undefined {
  return nestedString(detail.payload, ['repository', 'full_name']);
}

async function waitForTriggerEvent(params: {
  token: string;
  workspaceId: string;
  source: string;
  event: string;
  outcome: TriggerEventOutcomeDto;
  timeoutMs: number;
  deliveryId?: string | undefined;
  payloadMatches?: (detail: TriggerEventDetailResponseDto) => boolean;
}): Promise<TriggerEventDetailResponseDto> {
  const client = createApiClient({token: params.token});
  let lastObserved = 'no trigger events observed';

  return await pollUntil<TriggerEventDetailResponseDto>(
    {
      timeoutMs: params.timeoutMs,
      intervalMs: 250,
      maxIntervalMs: 1_000,
      describe: () => `Timed out waiting for trigger event: ${lastObserved}`,
    },
    async () => {
      const search = new URLSearchParams({
        workspace_id: params.workspaceId,
        source: params.source,
        event: params.event,
        outcome: params.outcome,
        limit: '100',
      });
      const events = await client.requestJson<TriggerEventListResponseDto>(
        'get',
        `/trigger-events?${search}`,
      );
      lastObserved = `count=${events.trigger_events.length}`;

      for (const event of events.trigger_events) {
        if (params.deliveryId !== undefined && event.delivery_id !== params.deliveryId) continue;
        const detail = await client.requestJson<TriggerEventDetailResponseDto>(
          'get',
          `/trigger-events/${event.id}`,
        );
        if (!params.payloadMatches || params.payloadMatches(detail)) return detail;
      }

      return null;
    },
  );
}

async function assertNoRunsForProject(params: {
  projectId: string;
  token: string;
  timeoutMs: number;
  headCommitSha: string;
}): Promise<void> {
  const client = createApiClient({token: params.token});
  const deadline = Date.now() + params.timeoutMs;

  while (Date.now() <= deadline) {
    const search = new URLSearchParams({project_id: params.projectId, limit: '100'});
    const response = await client.requestJson<WorkflowRunListResponseDto>(
      'get',
      `/workflows/runs?${search}`,
    );
    const matchingRun = response.runs.find(
      (run) => run.trigger_reference?.commit === params.headCommitSha,
    );
    expect(matchingRun).toBeUndefined();
    await delay(250);
  }
}

async function assertListenerRemains(params: {
  token: string;
  runId: string;
  jobKey: string;
  timeoutMs: number;
  description: string;
  selection?: WorkflowRunObservationSelection | undefined;
  matches: (observation: WorkflowRunObservation) => {matched: boolean; diagnostic: string};
}): Promise<WorkflowRunObservation> {
  const deadline = Date.now() + params.timeoutMs;
  let lastObservation: WorkflowRunObservation | undefined;

  while (Date.now() <= deadline) {
    lastObservation = await observeRun({
      runId: params.runId,
      selection: params.selection ?? {jobs: [{jobKey: params.jobKey}]},
      token: params.token,
    });
    const result = params.matches(lastObservation);
    if (!result.matched) {
      throw new Error(`${params.description} changed unexpectedly: ${result.diagnostic}`);
    }
    await delay(250);
  }

  if (!lastObservation) throw new Error(`${params.description} was not observed`);
  return lastObservation;
}

async function pushCommit(params: {
  org: string;
  repo: string;
  message: string;
  files: CommitFile[];
}): Promise<string> {
  return await commitFiles({
    org: params.org,
    repo: params.repo,
    message: params.message,
    files: params.files,
  });
}

async function createWrongRepo(suite: SuiteContext, name: string): Promise<CreatedRepo> {
  return await createRepo({org: suite.org, name});
}

test.describe('filter scenarios', () => {
  test('trigger filter discards nonmatching pushes and starts a run for matching pushes', async ({
    suite,
  }, testInfo) => {
    const token = suite.sessionToken;
    const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
    const repo = `trigger-filter-${uniqueId}`;
    const runnerLabel = `e2e-trigger-filter-${uniqueId}`;
    let runner: LocalRunnerHandle | undefined;
    let runnerLogFile: string | undefined;

    try {
      const {project} = await seedAndWaitForDefinition({
        suite,
        token,
        name: 'trigger-filter',
        repo,
        runnerLabel,
        workflowYaml: triggerFilterWorkflow,
        configPath: '.shipfox/workflows/trigger-filter.yml',
      });
      const wrongRepo = await createWrongRepo(suite, `trigger-filter-other-${uniqueId}`);

      const wrongRepoSha = await pushCommit({
        org: suite.org,
        repo: wrongRepo.name,
        message: `nonmatching trigger filter ${uniqueId}`,
        files: [{path: `.shipfox-e2e-nonmatching-${uniqueId}`, content: `${uniqueId}\n`}],
      });
      const discarded = await waitForTriggerEvent({
        token,
        workspaceId: suite.workspaceId,
        source: suite.connectionSlug,
        event: 'push',
        outcome: 'discarded',
        timeoutMs: 30_000,
        payloadMatches: (detail) =>
          eventPayloadAfter(detail) === wrongRepoSha &&
          eventPayloadRepositoryFullName(detail) === wrongRepo.fullName,
      });
      await assertNoRunsForProject({
        projectId: project.id,
        token,
        timeoutMs: TRIGGER_FILTER_NO_RUN_TIMEOUT_MS,
        headCommitSha: wrongRepoSha,
      });

      expect(discarded.matched_count).toBe(0);
      expect(discarded.decisions).toEqual([]);

      const localRunner = await startSuiteLocalRunner({
        workspaceId: suite.workspaceId,
        userToken: token,
        name: `E2E trigger filter ${uniqueId}`,
        runnerLabel,
      });
      runner = localRunner.runner;
      runnerLogFile = localRunner.logFile;

      const matchingSha = await pushCommit({
        org: suite.org,
        repo,
        message: `matching trigger filter ${uniqueId}`,
        files: [{path: `.shipfox-e2e-matching-${uniqueId}`, content: `${uniqueId}\n`}],
      });
      const run = await waitForRunByCommit({
        projectId: project.id,
        headCommitSha: matchingSha,
        token,
        timeoutMs: 60_000,
      });
      const terminal = await waitForRunTerminalOrFailedRunner({
        runId: run.id,
        token,
        timeoutMs: 180_000,
        runner,
      });

      expect(terminal.status).toBe('succeeded');
    } catch (error) {
      if (runnerLogFile !== undefined) {
        await attachLocalRunnerLog(
          (attachment) =>
            testInfo.attach(attachment.name, {
              body: attachment.body,
              contentType: attachment.contentType,
            }),
          runnerLogFile,
        );
      }
      throw error;
    } finally {
      if (runner !== undefined) {
        await stopLocalRunner(runner).catch((error: unknown) => {
          process.stderr.write(`filter-scenarios-e2e: stopLocalRunner failed: ${String(error)}\n`);
        });
      }
    }
  });

  test('listener filters fire and resolve only for matching webhook payloads', async ({
    suite,
  }, testInfo) => {
    let testCase: (ListenerCase & {definitionId: string}) | undefined;
    let runId: string | undefined;
    try {
      testCase = await setupListenerCase({
        suite,
        testName: 'listener-filter',
        workflowYaml: listenerFilterWorkflow,
        attach: (attachment) =>
          testInfo.attach(attachment.name, {
            body: attachment.body,
            contentType: attachment.contentType,
          }),
      });
      runId = await fireManualRun(testCase);

      await waitForRunObservationMatching({
        token: testCase.token,
        runId,
        timeoutMs: 90_000,
        description: 'listener filter job to start listening',
        selection: {jobs: [{jobKey: LISTENER_JOB}]},
        matches: (observation) =>
          listenerStatusMatches({
            observation,
            jobKey: LISTENER_JOB,
            listenerStatus: 'listening',
          }),
      });

      const nonmatchingFireDeliveryId = `${testCase.uniqueId}-fire-filtered`;
      testCase.fireDiagnostics.deliveryIds.push(nonmatchingFireDeliveryId);
      await postWebhookDelivery({
        client: testCase.client,
        connection: testCase.fireConnection,
        deliveryId: nonmatchingFireDeliveryId,
        webhook: {
          body: {
            issue: {number: NONMATCHING_PR_NUMBER},
            delivery_id: nonmatchingFireDeliveryId,
          },
        },
      });
      const discardedFire = await waitForTriggerEvent({
        token: testCase.token,
        workspaceId: testCase.workspaceId,
        source: testCase.fireConnection.slug,
        event: 'received',
        outcome: 'discarded',
        deliveryId: nonmatchingFireDeliveryId,
        timeoutMs: 30_000,
      });
      await assertListenerRemains({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        timeoutMs: LISTENER_NEGATIVE_ASSERTION_MS,
        description: 'listener execution count after nonmatching on filter',
        matches: (observation) =>
          listenerExecutionCountMatches({
            observation,
            jobKey: LISTENER_JOB,
            count: 0,
          }),
      });

      expect(discardedFire.matched_count).toBe(0);
      expect(discardedFire.decisions).toEqual([]);

      const matchingFire = await sendWebhookDeliveryUntilObserved({
        client: testCase.client,
        connection: testCase.fireConnection,
        runId,
        token: testCase.token,
        jobKey: LISTENER_JOB,
        deliveryIdPrefix: `${testCase.uniqueId}-fire-matching`,
        attemptTimeoutMs: 15_000,
        body: (_attempt, deliveryId) => ({
          issue: {number: MATCHING_PR_NUMBER},
          delivery_id: deliveryId,
        }),
      });
      testCase.fireDiagnostics.deliveryIds.push(...matchingFire.deliveryIds);

      const nonmatchingResolveDeliveryId = `${testCase.uniqueId}-resolve-filtered`;
      testCase.resolveDiagnostics.deliveryIds.push(nonmatchingResolveDeliveryId);
      await postWebhookDelivery({
        client: testCase.client,
        connection: testCase.resolveConnection,
        deliveryId: nonmatchingResolveDeliveryId,
        webhook: {
          body: {
            pull_request: {number: NONMATCHING_PR_NUMBER},
            delivery_id: nonmatchingResolveDeliveryId,
          },
        },
      });
      const discardedResolve = await waitForTriggerEvent({
        token: testCase.token,
        workspaceId: testCase.workspaceId,
        source: testCase.resolveConnection.slug,
        event: 'received',
        outcome: 'discarded',
        deliveryId: nonmatchingResolveDeliveryId,
        timeoutMs: 30_000,
      });
      await assertListenerRemains({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        timeoutMs: LISTENER_NEGATIVE_ASSERTION_MS,
        description: 'listener status after nonmatching until filter',
        matches: (observation) =>
          listenerStatusMatches({
            observation,
            jobKey: LISTENER_JOB,
            listenerStatus: 'listening',
          }),
      });

      expect(discardedResolve.matched_count).toBe(0);
      expect(discardedResolve.decisions).toEqual([]);

      const matchingResolveDeliveryId = `${testCase.uniqueId}-resolve-matching`;
      testCase.resolveDiagnostics.deliveryIds.push(matchingResolveDeliveryId);
      await postWebhookDelivery({
        client: testCase.client,
        connection: testCase.resolveConnection,
        deliveryId: matchingResolveDeliveryId,
        webhook: {
          body: {
            pull_request: {number: MATCHING_PR_NUMBER},
            delivery_id: matchingResolveDeliveryId,
          },
        },
      });
      await waitForListenerResolution({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        status: 'succeeded',
        reason: 'until',
        timeoutMs: 90_000,
      });

      const terminal = await waitForRunTerminalOrFailedRunner({
        runId,
        token: testCase.token,
        timeoutMs: 180_000,
        runner: testCase.runner,
        selection: {
          jobs: [{jobKey: LISTENER_JOB, executionSequences: 'all', includeContext: true}],
        },
      });
      const listen = findListenerJob(terminal, LISTENER_JOB);

      expect(
        listenerDeliveryObserved({
          observation: terminal,
          jobKey: LISTENER_JOB,
          deliveryId: matchingFire.deliveryId,
        }).matched,
      ).toBe(true);
      expect(terminal.status).toBe('succeeded');
      expect(listen?.listener_status).toBe('resolved');
      expect(listen?.executions).toHaveLength(1);
      expect(listen?.executions[0]?.trigger_events[0]?.delivery_id).toBe(matchingFire.deliveryId);
    } catch (error) {
      await cleanupListenerCase(testCase, runId);
      throw error;
    } finally {
      await stopRunner(testCase);
    }
  });
});
