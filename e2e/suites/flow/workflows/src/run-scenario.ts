import {readFile} from 'node:fs/promises';
import {createApiClient} from '@shipfox/e2e-core';
import {readFakeOpenAiModelProviderState} from '@shipfox/e2e-driver-model-provider';
import {type LocalRunnerHandle, stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {fetchStepLogs} from '@shipfox/e2e-observe-logs';
import {createSecret, createVariable} from '@shipfox/e2e-setup-secrets';
import type {Attachment} from './attachments.js';
import {
  attachLocalRunnerLog,
  collectStepLogAttachmentRequests,
  fetchLogAttachment,
} from './attachments.js';
import {evaluateExpectations, evaluateLogs, logText, type Mismatch} from './expect.js';
import {waitForDefinitionSyncTerminal, waitForNoWorkflowRuns} from './polling.js';
import {evaluateRejection} from './reject.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from './runner.js';
import type {Scenario} from './scenarios.js';
import type {SuiteContext} from './suite-context.js';
import {fireManualAndAwaitRun, triggerPushAndAwaitRun} from './triggers.js';
import {
  attachWebhookTriggerDiagnostics,
  createWebhookConnection,
  triggerWebhookAndAwaitRun,
  type WebhookDiagnosticsRequest,
} from './webhook.js';
import {seedAndWaitForDefinition, seedWorkflowProject} from './workflow-project.js';

const REJECTION_NO_RUN_TIMEOUT_MS = 15_000;
const E2E_SECRET_ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const FAKE_MODEL_PROVIDER_REQUEST_TIMEOUT_MS = 5_000;

export interface RunScenarioParams {
  scenario: Scenario;
  suite: SuiteContext;
  // Attaches a debugging artifact to the running test (a thin wrapper over
  // testInfo.attach), so the scenario driver stays free of Playwright types.
  attach: (attachment: Attachment) => Promise<void>;
}

/**
 * Drives one declarative scenario end to end: fresh repo and project, seed commit,
 * definition-resolved poll, trigger, terminal-run poll, then expect.yaml evaluation.
 * Returns every mismatch (empty means the scenario matched) and attaches the run
 * detail, the diff, and fetched logs when it did not.
 */
export async function runScenario(params: RunScenarioParams): Promise<Mismatch[]> {
  const {scenario, suite} = params;
  const token = suite.sessionToken;
  const client = createApiClient({token});

  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const runnerLabel = `e2e-${scenario.name}-${uniqueId}`;
  const repo = `${scenario.name}-${uniqueId}`;
  const webhookSlug = `webhook-${scenario.name}-${uniqueId}`;

  let runner: LocalRunnerHandle | undefined;
  let runnerLogFile: string | undefined;
  let webhookDiagnostics: WebhookDiagnosticsRequest | undefined;

  try {
    const webhookConnection =
      scenario.kind === 'expect' && scenario.expectation.trigger === 'webhook'
        ? await createWebhookConnection({
            client,
            scenario: scenario.name,
            slug: webhookSlug,
            uniqueId,
            workspaceId: suite.workspaceId,
          })
        : undefined;

    let definition: Awaited<ReturnType<typeof seedAndWaitForDefinition>>['definition'] | undefined;
    const seeded =
      scenario.kind === 'reject'
        ? await seedWorkflowProject({
            suite,
            token,
            name: scenario.name,
            repo,
            runnerLabel,
            workflowYaml: scenario.workflowYaml,
            configPath: scenario.configPath,
            webhookSlug,
            extraFiles: scenario.extraFiles,
          })
        : await seedAndWaitForDefinition({
            suite,
            token,
            name: scenario.name,
            repo,
            runnerLabel,
            workflowYaml: scenario.workflowYaml,
            configPath: scenario.configPath,
            webhookSlug,
            extraFiles: scenario.extraFiles,
          }).then((ready) => {
            definition = ready.definition;
            return ready;
          });
    const {project} = seeded;

    for (const secret of scenario.seededSecrets) {
      await createSecret({
        workspaceId: suite.workspaceId,
        actorId: E2E_SECRET_ACTOR_ID,
        key: secret.key,
        value: secret.value,
        ...(secret.scope === 'project' ? {projectId: project.id} : {}),
      });
    }

    for (const variable of scenario.seededVariables) {
      await createVariable({
        workspaceId: suite.workspaceId,
        actorId: E2E_SECRET_ACTOR_ID,
        key: variable.key,
        value: variable.value,
        ...(variable.scope === 'project' ? {projectId: project.id} : {}),
      });
    }

    if (scenario.kind === 'reject') {
      const definitions = await waitForDefinitionSyncTerminal({
        projectId: project.id,
        token,
        timeoutMs: 60_000,
      });
      const runs = await waitForNoWorkflowRuns({
        projectId: project.id,
        token,
        timeoutMs: REJECTION_NO_RUN_TIMEOUT_MS,
      });
      const mismatches = evaluateRejection(
        {sync: definitions.sync, runs: runs.runs},
        scenario.rejection,
      );

      if (mismatches.length > 0) {
        await params.attach({
          name: 'definition-sync.json',
          contentType: 'application/json',
          body: JSON.stringify(definitions, null, 2),
        });
        await params.attach({
          name: 'workflow-runs.json',
          contentType: 'application/json',
          body: JSON.stringify(runs, null, 2),
        });
        await params.attach({
          name: 'mismatches.json',
          contentType: 'application/json',
          body: JSON.stringify(mismatches, null, 2),
        });
      }

      return mismatches;
    }

    if (definition === undefined) {
      throw new Error(`Definition missing for ${scenario.name}`);
    }

    const localRunner = await startSuiteLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: token,
      name: `E2E ${scenario.name} ${uniqueId}`,
      runnerLabel,
    });
    runner = localRunner.runner;
    runnerLogFile = localRunner.logFile;

    let runId: string;
    if (scenario.expectation.trigger === 'manual') {
      runId = await fireManualAndAwaitRun({
        client,
        definitionId: definition.id,
        inputs: scenario.expectation.inputs ?? {},
        scenario: scenario.name,
      });
    } else if (scenario.expectation.trigger === 'webhook') {
      if (!webhookConnection) throw new Error(`Webhook connection missing for ${scenario.name}`);
      const result = await triggerWebhookAndAwaitRun({
        attach: params.attach,
        client,
        connection: webhookConnection,
        projectId: project.id,
        scenario: scenario.name,
        token,
        webhook: scenario.expectation.webhook,
        workspaceId: suite.workspaceId,
      });
      webhookDiagnostics = {deliveryIds: result.deliveryIds, source: webhookConnection.slug};
      runId = result.runId;
    } else {
      runId = await triggerPushAndAwaitRun({
        org: suite.org,
        repo,
        scenario: scenario.name,
        uniqueId,
        message: scenario.expectation.push?.message,
        projectId: project.id,
        token,
      });
    }

    const runDetail = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: scenario.expectation.timeout_seconds * 1000,
      runner,
    });

    const {mismatches, logRequirements} = evaluateExpectations(runDetail, scenario.expectation);
    const allMismatches = [...mismatches];
    const fetchedLogs: Attachment[] = [];
    for (const requirement of logRequirements) {
      let logs: Awaited<ReturnType<typeof fetchStepLogs>>;
      try {
        logs = await fetchStepLogs({
          stepId: requirement.stepId,
          attempt: requirement.attempt,
          token,
        });
      } catch (error) {
        allMismatches.push({
          path: `${requirement.path}.logs`,
          expected: 'readable',
          actual: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      fetchedLogs.push({
        name: `logs-${requirement.path.replaceAll('/', '_')}.ndjson`,
        contentType: 'application/x-ndjson',
        body: logs.ndjson,
      });
      allMismatches.push(
        ...evaluateLogs({
          path: requirement.path,
          text: logText(logs.records),
          include: requirement.include,
          exclude: requirement.exclude,
        }),
      );
    }

    if (scenario.expectation.runner_log) {
      const runnerLog =
        runnerLogFile === undefined ? '' : await readFile(runnerLogFile, 'utf8').catch(() => '');
      allMismatches.push(
        ...evaluateLogs({
          path: 'runner_log',
          text: runnerLog,
          include: scenario.expectation.runner_log.include,
          exclude: scenario.expectation.runner_log.exclude,
        }),
      );
    }

    if (allMismatches.length > 0) {
      await params.attach({
        name: 'run-detail.json',
        contentType: 'application/json',
        body: JSON.stringify(runDetail, null, 2),
      });
      await params.attach({
        name: 'mismatches.json',
        contentType: 'application/json',
        body: JSON.stringify(allMismatches, null, 2),
      });
      for (const log of fetchedLogs) await params.attach(log);
      if (runnerLogFile !== undefined) await attachLocalRunnerLog(params.attach, runnerLogFile);
      await attachFakeModelProviderRequestsBestEffort({attach: params.attach, scenario, suite});
      if (webhookDiagnostics !== undefined) {
        await attachWebhookTriggerDiagnostics({
          attach: params.attach,
          client,
          deliveryIds: webhookDiagnostics.deliveryIds,
          source: webhookDiagnostics.source,
          workspaceId: suite.workspaceId,
        });
      }

      const fetchedLogKeys = new Set(
        logRequirements.map((requirement) => `${requirement.stepId}:${requirement.attempt}`),
      );
      for (const request of collectStepLogAttachmentRequests(runDetail)) {
        const key = `${request.stepId}:${request.attempt}`;
        if (fetchedLogKeys.has(key)) continue;
        await params.attach(await fetchLogAttachment(request, token));
      }
    }

    return allMismatches;
  } catch (error) {
    if (webhookDiagnostics !== undefined) {
      await attachWebhookTriggerDiagnostics({
        attach: params.attach,
        client,
        deliveryIds: webhookDiagnostics.deliveryIds,
        source: webhookDiagnostics.source,
        workspaceId: suite.workspaceId,
      });
    }
    if (runnerLogFile !== undefined) await attachLocalRunnerLog(params.attach, runnerLogFile);
    await attachFakeModelProviderRequestsBestEffort({attach: params.attach, scenario, suite});
    throw error;
  } finally {
    if (runner !== undefined) {
      await stopLocalRunner(runner).catch((error: unknown) => {
        process.stderr.write(`platform-e2e: stopLocalRunner failed: ${String(error)}\n`);
      });
    }
  }
}

async function attachFakeModelProviderRequestsBestEffort(params: {
  attach: (attachment: Attachment) => Promise<void>;
  scenario: Scenario;
  suite: SuiteContext;
}): Promise<void> {
  await attachFakeModelProviderRequests(params).catch((error: unknown) => {
    process.stderr.write(
      `platform-e2e: attachFakeModelProviderRequests failed: ${String(error)}\n`,
    );
  });
}

async function attachFakeModelProviderRequests(params: {
  attach: (attachment: Attachment) => Promise<void>;
  scenario: Scenario;
  suite: SuiteContext;
}): Promise<void> {
  const scriptKey = params.scenario.fakeModelProviderScriptKey;
  if (scriptKey === undefined) return;

  const scriptId = params.suite.fakeModelProviderScripts[scriptKey];
  if (scriptId === undefined) {
    await attachFakeModelProviderError({
      attach: params.attach,
      scenario: params.scenario.name,
      message: `No fake model provider script is registered for key "${scriptKey}".`,
    });
    return;
  }

  try {
    const state = await readFakeOpenAiModelProviderState({
      runId: params.suite.fakeModelProviderRunId,
    });
    const response = await fetchWithTimeout(
      `${state.baseUrl}/scripts/${encodeURIComponent(scriptId)}/requests`,
      {
        headers: {authorization: `Bearer ${state.adminToken}`},
        timeoutMs: FAKE_MODEL_PROVIDER_REQUEST_TIMEOUT_MS,
      },
    );
    const body = await response.text();
    if (!response.ok)
      throw new Error(`GET /scripts/${scriptId}/requests returned ${response.status}: ${body}`);

    await params.attach({
      name: `fake-model-provider-${params.scenario.name}.json`,
      contentType: 'application/json',
      body: formatJsonBody(body),
    });
  } catch (error) {
    await attachFakeModelProviderError({
      attach: params.attach,
      scenario: params.scenario.name,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function attachFakeModelProviderError(params: {
  attach: (attachment: Attachment) => Promise<void>;
  message: string;
  scenario: string;
}): Promise<void> {
  await params.attach({
    name: `fake-model-provider-${params.scenario}-error.txt`,
    contentType: 'text/plain',
    body: params.message,
  });
}

function formatJsonBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & {timeoutMs: number},
): Promise<Response> {
  const {timeoutMs, ...requestInit} = init;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    return await fetch(url, {...requestInit, signal: abortController.signal});
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error(`Fake model provider request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
