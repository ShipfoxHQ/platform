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
import {
  evaluateExpectations,
  evaluateLogs,
  logText,
  type Mismatch,
  type StepLogRequirement,
} from './expect.js';
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

type RunDetail = Awaited<ReturnType<typeof waitForRunTerminalOrFailedRunner>>;

async function evaluateScenarioResult(params: {
  expectation: Extract<Scenario, {kind: 'expect'}>['expectation'];
  logRequirements: StepLogRequirement[];
  mismatches: Mismatch[];
  runnerLogFile: string | undefined;
  token: string;
}): Promise<{allMismatches: Mismatch[]; fetchedLogs: Attachment[]}> {
  const allMismatches = [...params.mismatches];
  const fetchedLogs: Attachment[] = [];
  for (const requirement of params.logRequirements) {
    let logs: Awaited<ReturnType<typeof fetchStepLogs>>;
    try {
      logs = await fetchStepLogs({
        stepId: requirement.stepId,
        attempt: requirement.attempt,
        token: params.token,
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

  if (params.expectation.runner_log) {
    const runnerLog =
      params.runnerLogFile === undefined
        ? ''
        : await readFile(params.runnerLogFile, 'utf8').catch(() => '');
    allMismatches.push(
      ...evaluateLogs({
        path: 'runner_log',
        text: runnerLog,
        include: params.expectation.runner_log.include,
        exclude: params.expectation.runner_log.exclude,
      }),
    );
  }

  return {allMismatches, fetchedLogs};
}

async function attachScenarioMismatches(params: {
  attach: RunScenarioParams['attach'];
  client: ReturnType<typeof createApiClient>;
  fetchedLogs: Attachment[];
  logRequirements: StepLogRequirement[];
  mismatches: Mismatch[];
  runDetail: RunDetail;
  runnerLogFile: string | undefined;
  scenario: Extract<Scenario, {kind: 'expect'}>;
  suite: SuiteContext;
  token: string;
  webhookDiagnostics: WebhookDiagnosticsRequest | undefined;
}): Promise<void> {
  await params.attach({
    name: 'run-detail.json',
    contentType: 'application/json',
    body: JSON.stringify(params.runDetail, null, 2),
  });
  await params.attach({
    name: 'mismatches.json',
    contentType: 'application/json',
    body: JSON.stringify(params.mismatches, null, 2),
  });
  for (const log of params.fetchedLogs) await params.attach(log);
  if (params.runnerLogFile !== undefined) {
    await attachLocalRunnerLog(params.attach, params.runnerLogFile);
  }
  await attachFakeModelProviderRequestsBestEffort(params);
  if (params.webhookDiagnostics !== undefined) {
    await attachWebhookTriggerDiagnostics({
      attach: params.attach,
      client: params.client,
      deliveryIds: params.webhookDiagnostics.deliveryIds,
      source: params.webhookDiagnostics.source,
      workspaceId: params.suite.workspaceId,
    });
  }

  const fetchedLogKeys = new Set(
    params.logRequirements.map((requirement) => `${requirement.stepId}:${requirement.attempt}`),
  );
  for (const request of collectStepLogAttachmentRequests(params.runDetail)) {
    const key = `${request.stepId}:${request.attempt}`;
    if (fetchedLogKeys.has(key)) continue;
    await params.attach(await fetchLogAttachment(request, params.token));
  }
}

async function attachFailureDiagnostics(params: {
  attach: RunScenarioParams['attach'];
  client: ReturnType<typeof createApiClient>;
  runnerLogFile: string | undefined;
  scenario: Scenario;
  suite: SuiteContext;
  webhookDiagnostics: WebhookDiagnosticsRequest | undefined;
}): Promise<void> {
  if (params.webhookDiagnostics !== undefined) {
    await attachWebhookTriggerDiagnostics({
      attach: params.attach,
      client: params.client,
      deliveryIds: params.webhookDiagnostics.deliveryIds,
      source: params.webhookDiagnostics.source,
      workspaceId: params.suite.workspaceId,
    });
  }
  if (params.runnerLogFile !== undefined) {
    await attachLocalRunnerLog(params.attach, params.runnerLogFile);
  }
  await attachFakeModelProviderRequestsBestEffort(params);
}

async function createScenarioWebhook(params: {
  client: ReturnType<typeof createApiClient>;
  scenario: Scenario;
  suite: SuiteContext;
  uniqueId: string;
  webhookSlug: string;
}): Promise<Awaited<ReturnType<typeof createWebhookConnection>> | undefined> {
  if (params.scenario.kind !== 'expect' || params.scenario.expectation.trigger !== 'webhook') {
    return undefined;
  }
  return await createWebhookConnection({
    client: params.client,
    scenario: params.scenario.name,
    slug: params.webhookSlug,
    uniqueId: params.uniqueId,
    workspaceId: params.suite.workspaceId,
  });
}

async function seedScenarioProject(params: {
  repo: string;
  runnerLabel: string;
  scenario: Scenario;
  suite: SuiteContext;
  token: string;
  webhookSlug: string;
}) {
  const seedParams = {
    suite: params.suite,
    token: params.token,
    name: params.scenario.name,
    repo: params.repo,
    runnerLabel: params.runnerLabel,
    workflowYaml: params.scenario.workflowYaml,
    configPath: params.scenario.configPath,
    webhookSlug: params.webhookSlug,
    extraFiles: params.scenario.extraFiles,
  };
  if (params.scenario.kind === 'reject') {
    const seeded = await seedWorkflowProject(seedParams);
    return {definition: undefined, project: seeded.project};
  }
  const seeded = await seedAndWaitForDefinition(seedParams);
  return {definition: seeded.definition, project: seeded.project};
}

async function seedScenarioValues(params: {
  projectId: string;
  scenario: Scenario;
  workspaceId: string;
}): Promise<void> {
  for (const secret of params.scenario.seededSecrets) {
    await createSecret({
      workspaceId: params.workspaceId,
      actorId: E2E_SECRET_ACTOR_ID,
      key: secret.key,
      value: secret.value,
      ...(secret.scope === 'project' ? {projectId: params.projectId} : {}),
    });
  }

  for (const variable of params.scenario.seededVariables) {
    await createVariable({
      workspaceId: params.workspaceId,
      actorId: E2E_SECRET_ACTOR_ID,
      key: variable.key,
      value: variable.value,
      ...(variable.scope === 'project' ? {projectId: params.projectId} : {}),
    });
  }
}

async function evaluateRejectedScenario(params: {
  attach: RunScenarioParams['attach'];
  projectId: string;
  scenario: Extract<Scenario, {kind: 'reject'}>;
  token: string;
}): Promise<Mismatch[]> {
  const definitions = await waitForDefinitionSyncTerminal({
    projectId: params.projectId,
    token: params.token,
    timeoutMs: 60_000,
  });
  const runs = await waitForNoWorkflowRuns({
    projectId: params.projectId,
    token: params.token,
    timeoutMs: REJECTION_NO_RUN_TIMEOUT_MS,
  });
  const mismatches = evaluateRejection(
    {sync: definitions.sync, runs: runs.runs},
    params.scenario.rejection,
  );
  if (mismatches.length === 0) return mismatches;

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
  return mismatches;
}

async function triggerScenario(params: {
  attach: RunScenarioParams['attach'];
  client: ReturnType<typeof createApiClient>;
  definitionId: string;
  projectId: string;
  repo: string;
  scenario: Extract<Scenario, {kind: 'expect'}>;
  suite: SuiteContext;
  token: string;
  uniqueId: string;
  webhookConnection: Awaited<ReturnType<typeof createWebhookConnection>> | undefined;
}): Promise<{runId: string; webhookDiagnostics: WebhookDiagnosticsRequest | undefined}> {
  if (params.scenario.expectation.trigger === 'manual') {
    const runId = await fireManualAndAwaitRun({
      client: params.client,
      definitionId: params.definitionId,
      inputs: params.scenario.expectation.inputs ?? {},
      scenario: params.scenario.name,
    });
    return {runId, webhookDiagnostics: undefined};
  }
  if (params.scenario.expectation.trigger === 'webhook') {
    if (!params.webhookConnection) {
      throw new Error(`Webhook connection missing for ${params.scenario.name}`);
    }
    const result = await triggerWebhookAndAwaitRun({
      attach: params.attach,
      client: params.client,
      connection: params.webhookConnection,
      projectId: params.projectId,
      scenario: params.scenario.name,
      token: params.token,
      webhook: params.scenario.expectation.webhook,
      workspaceId: params.suite.workspaceId,
    });
    return {
      runId: result.runId,
      webhookDiagnostics: {
        deliveryIds: result.deliveryIds,
        source: params.webhookConnection.slug,
      },
    };
  }

  const runId = await triggerPushAndAwaitRun({
    org: params.suite.org,
    repo: params.repo,
    scenario: params.scenario.name,
    uniqueId: params.uniqueId,
    message: params.scenario.expectation.push?.message,
    projectId: params.projectId,
    token: params.token,
  });
  return {runId, webhookDiagnostics: undefined};
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
    const webhookConnection = await createScenarioWebhook({
      client,
      scenario,
      suite,
      uniqueId,
      webhookSlug,
    });
    const {definition, project} = await seedScenarioProject({
      repo,
      runnerLabel,
      scenario,
      suite,
      token,
      webhookSlug,
    });
    await seedScenarioValues({projectId: project.id, scenario, workspaceId: suite.workspaceId});

    if (scenario.kind === 'reject') {
      return await evaluateRejectedScenario({
        attach: params.attach,
        projectId: project.id,
        scenario,
        token,
      });
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

    const triggered = await triggerScenario({
      attach: params.attach,
      client,
      definitionId: definition.id,
      projectId: project.id,
      repo,
      scenario,
      suite,
      token,
      uniqueId,
      webhookConnection,
    });
    webhookDiagnostics = triggered.webhookDiagnostics;

    const runDetail = await waitForRunTerminalOrFailedRunner({
      runId: triggered.runId,
      token,
      timeoutMs: scenario.expectation.timeout_seconds * 1000,
      runner,
    });

    const {mismatches, logRequirements} = evaluateExpectations(runDetail, scenario.expectation);
    const {allMismatches, fetchedLogs} = await evaluateScenarioResult({
      expectation: scenario.expectation,
      logRequirements,
      mismatches,
      runnerLogFile,
      token,
    });

    if (allMismatches.length > 0) {
      await attachScenarioMismatches({
        attach: params.attach,
        client,
        fetchedLogs,
        logRequirements,
        mismatches: allMismatches,
        runDetail,
        runnerLogFile,
        scenario,
        suite,
        token,
        webhookDiagnostics,
      });
    }

    return allMismatches;
  } catch (error) {
    await attachFailureDiagnostics({
      attach: params.attach,
      client,
      runnerLogFile,
      scenario,
      suite,
      webhookDiagnostics,
    });
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
