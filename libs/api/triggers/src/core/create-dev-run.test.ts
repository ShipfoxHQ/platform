import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {triggersDecisions} from '#db/schema/decisions.js';
import {triggersReceivedEvents} from '#db/schema/received-events.js';
import {triggerSubscriptions} from '#db/schema/subscriptions.js';
import {
  DevRunInputsNotAllowedError,
  DevRunReplayEventRequiredError,
  DevRunTriggerNotFoundError,
} from './errors.js';

const resolveDefinitionAtRef = vi.fn();
const startDevRun = vi.fn();
const devRunsCount = vi.hoisted(() => ({add: vi.fn()}));

vi.mock('#metrics/instance.js', () => ({devRunsCount}));

const {createDevRun} = await import('./create-dev-run.js');

const definitions = {
  resolveDefinitionAtRef: (...args: unknown[]) => resolveDefinitionAtRef(...args),
} as never;
const workflows = {startDevRun: (...args: unknown[]) => startDevRun(...args)} as never;

const COMMIT = 'a'.repeat(40);
const WORKFLOW_ID = crypto.randomUUID();

interface BaseParams {
  workspaceId?: string;
  projectId?: string;
  commit?: string | undefined;
  inputs?: Record<string, unknown> | undefined;
  triggerKey?: string;
  triggers?: Record<string, {source: string; event?: string; with?: Record<string, unknown>}>;
}

function buildParams(overrides: BaseParams = {}) {
  return {
    definitions,
    workflows,
    workspaceId: overrides.workspaceId ?? crypto.randomUUID(),
    projectId: overrides.projectId ?? crypto.randomUUID(),
    ref: 'fix-triage-prompt',
    commit: overrides.commit,
    configPath: '.shipfox/workflows/triage-sentry.yml',
    triggerKey: overrides.triggerKey ?? 'on_demand',
    inputs: overrides.inputs,
    userId: crypto.randomUUID(),
    triggers: overrides.triggers,
  };
}

function resolvedDefinition(triggers: BaseParams['triggers']) {
  return {
    workflow: {id: WORKFLOW_ID, configPath: '.shipfox/workflows/triage-sentry.yml'},
    commit: COMMIT,
    model: {version: 2, model: {kind: 'workflow', name: 'Triage', triggers: [], jobs: []}},
    sourceSnapshot: {content: 'name: Triage\n', format: 'yaml'},
    triggers: triggers ?? {
      on_demand: {source: 'manual', event: 'fire', with: {severity: 'high'}},
    },
    warnings: [],
  };
}

const SYNTHESIZED_EVENT_REF = /^[0-9a-f-]{36}$/;

function eventsForWorkspace(workspaceId: string) {
  return db()
    .select()
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.workspaceId, workspaceId));
}

function decisionsForEvent(receivedEventId: string) {
  return db()
    .select()
    .from(triggersDecisions)
    .where(eq(triggersDecisions.receivedEventId, receivedEventId));
}

function subscriptionsForWorkspace(workspaceId: string) {
  return db()
    .select()
    .from(triggerSubscriptions)
    .where(eq(triggerSubscriptions.workspaceId, workspaceId));
}

describe('createDevRun', () => {
  beforeEach(() => {
    resolveDefinitionAtRef.mockReset();
    startDevRun.mockReset();
    devRunsCount.add.mockReset();
  });

  test('creates a manual dev run with the trigger `with` inputs and journals one dev decision', async () => {
    const params = buildParams();
    resolveDefinitionAtRef.mockResolvedValue(resolvedDefinition(undefined));
    const run = {id: crypto.randomUUID(), name: 'Dev run'};
    startDevRun.mockResolvedValue(run);

    const result = await createDevRun(params);

    expect(result).toEqual({id: run.id, commit: COMMIT});
    expect(devRunsCount.add).toHaveBeenCalledWith(1, {
      trigger_kind: 'manual',
      outcome: 'routed',
    });
    expect(resolveDefinitionAtRef).toHaveBeenCalledWith({
      projectId: params.projectId,
      ref: params.ref,
      configPath: params.configPath,
    });
    const [payload] = startDevRun.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      workflowId: WORKFLOW_ID,
      inputs: {severity: 'high'},
      triggerPayload: {provider: 'manual', source: 'manual', event: 'fire', userId: params.userId},
      devSource: {
        ref: params.ref,
        commit: COMMIT,
        configPath: params.configPath,
        initiatedByUserId: params.userId,
      },
    });
    expect(payload).not.toHaveProperty('idempotencyKey');

    const [event] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, run.id));
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('dev');
    expect(event.provider).toBeNull();
    expect(event.source).toBe('manual');
    expect(event.event).toBe('fire');
    expect(event.payload).toBeNull();
    expect(event.outcome).toBe('routed');
    expect(event.matchedCount).toBe(1);

    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      subscriptionKind: 'dev',
      subscriptionId: null,
      subscriptionName: 'on_demand',
      workflowDefinitionId: WORKFLOW_ID,
      projectId: null,
      decision: 'triggered',
      runId: run.id,
      runName: 'Dev run',
      reason: null,
    });

    expect(await subscriptionsForWorkspace(params.workspaceId)).toHaveLength(0);
  });

  test('pins the expected commit on the resolution when the body carries one', async () => {
    const params = buildParams({commit: COMMIT});
    resolveDefinitionAtRef.mockResolvedValue(resolvedDefinition(undefined));
    startDevRun.mockResolvedValue({id: crypto.randomUUID(), name: 'Dev run'});

    await createDevRun(params);

    expect(resolveDefinitionAtRef).toHaveBeenCalledWith({
      projectId: params.projectId,
      ref: params.ref,
      configPath: params.configPath,
      expectedCommit: COMMIT,
    });
  });

  test('request inputs override the trigger `with` block for manual triggers', async () => {
    const params = buildParams({inputs: {severity: 'critical'}});
    resolveDefinitionAtRef.mockResolvedValue(resolvedDefinition(undefined));
    startDevRun.mockResolvedValue({id: crypto.randomUUID(), name: 'Dev run'});

    await createDevRun(params);

    const [payload] = startDevRun.mock.calls[0] as [Record<string, unknown>];
    expect(payload.inputs).toEqual({severity: 'critical'});
  });

  test('creates a cron dev run from the trigger `with` inputs', async () => {
    const params = buildParams({
      triggerKey: 'nightly',
      triggers: {nightly: {source: 'cron', event: 'tick', with: {timeout: 600}}},
    });
    resolveDefinitionAtRef.mockResolvedValue(resolvedDefinition(params.triggers));
    const run = {id: crypto.randomUUID(), name: 'Dev cron run'};
    startDevRun.mockResolvedValue(run);

    const result = await createDevRun(params);

    expect(result.id).toBe(run.id);
    const [payload] = startDevRun.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      inputs: {timeout: 600},
      triggerPayload: {provider: 'cron', source: 'cron', event: 'tick'},
    });
    expect(payload.triggerPayload).not.toHaveProperty('scheduleId');

    const [event] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, run.id));
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('dev');
    expect(event.source).toBe('cron');
    expect(event.event).toBe('tick');
    expect(event.payload).toBeNull();
    expect(event.outcome).toBe('routed');
    expect(devRunsCount.add).toHaveBeenCalledWith(1, {
      trigger_kind: 'cron',
      outcome: 'routed',
    });
  });

  test('refuses request inputs for cron triggers', async () => {
    const params = buildParams({
      triggerKey: 'nightly',
      triggers: {nightly: {source: 'cron', with: {timeout: 600}}},
      inputs: {timeout: 1},
    });
    resolveDefinitionAtRef.mockResolvedValue(resolvedDefinition(params.triggers));

    await expect(createDevRun(params)).rejects.toThrow(DevRunInputsNotAllowedError);
    expect(startDevRun).not.toHaveBeenCalled();
    expect(await eventsForWorkspace(params.workspaceId)).toHaveLength(0);
  });

  test('refuses a missing trigger key', async () => {
    const params = buildParams({triggerKey: 'missing'});
    resolveDefinitionAtRef.mockResolvedValue(resolvedDefinition(undefined));

    await expect(createDevRun(params)).rejects.toThrow(DevRunTriggerNotFoundError);
    expect(startDevRun).not.toHaveBeenCalled();
    expect(await eventsForWorkspace(params.workspaceId)).toHaveLength(0);
  });

  test('refuses integration triggers until targeted replay lands', async () => {
    const params = buildParams({
      triggerKey: 'on_issue',
      triggers: {on_issue: {source: 'sentry_acme', event: 'issue.created'}},
    });
    resolveDefinitionAtRef.mockResolvedValue(resolvedDefinition(params.triggers));

    await expect(createDevRun(params)).rejects.toThrow(DevRunReplayEventRequiredError);
    expect(startDevRun).not.toHaveBeenCalled();
    expect(await eventsForWorkspace(params.workspaceId)).toHaveLength(0);
  });

  test('rethrows a ref-moved resolution without journaling', async () => {
    const params = buildParams({commit: COMMIT});
    resolveDefinitionAtRef.mockRejectedValue(
      createInterModuleKnownError(
        definitionsInterModuleContract.methods.resolveDefinitionAtRef,
        'ref-moved',
        {ref: params.ref, expectedCommit: COMMIT},
      ),
    );

    await expect(createDevRun(params)).rejects.toMatchObject({code: 'ref-moved'});
    expect(startDevRun).not.toHaveBeenCalled();
    expect(await eventsForWorkspace(params.workspaceId)).toHaveLength(0);
  });

  test('rethrows an invalid-definition resolution without journaling', async () => {
    const params = buildParams();
    resolveDefinitionAtRef.mockRejectedValue(
      createInterModuleKnownError(
        definitionsInterModuleContract.methods.resolveDefinitionAtRef,
        'invalid-definition',
        {errors: [{message: 'jobs must not be empty', path: 'jobs'}]},
      ),
    );

    await expect(createDevRun(params)).rejects.toMatchObject({code: 'invalid-definition'});
    expect(startDevRun).not.toHaveBeenCalled();
    expect(await eventsForWorkspace(params.workspaceId)).toHaveLength(0);
  });

  test('journals a dev failure row with a synthesized event ref when startDevRun fails permanently', async () => {
    const params = buildParams();
    resolveDefinitionAtRef.mockResolvedValue(resolvedDefinition(undefined));
    startDevRun.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startDevRun,
        'workspace-suspended',
        {workspaceId: params.workspaceId},
      ),
    );

    await expect(createDevRun(params)).rejects.toMatchObject({code: 'workspace-suspended'});

    const events = await eventsForWorkspace(params.workspaceId);
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('dev');
    // No run was created, so the failure row keys on a synthesized event ref.
    expect(event.eventRef).toEqual(expect.stringMatching(SYNTHESIZED_EVENT_REF));
    expect(event.outcome).toBe('errored');
    expect(event.matchedCount).toBe(1);
    expect(event.processedAt).toBeInstanceOf(Date);
    expect(devRunsCount.add).toHaveBeenCalledWith(1, {
      trigger_kind: 'manual',
      outcome: 'errored',
    });
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      subscriptionKind: 'dev',
      subscriptionId: null,
      subscriptionName: 'on_demand',
      workflowDefinitionId: WORKFLOW_ID,
      decision: 'dispatch-error',
      runId: null,
      runName: null,
    });
    expect(decisions[0]?.reason).toContain('workspace-suspended');
    expect(await subscriptionsForWorkspace(params.workspaceId)).toHaveLength(0);
  });

  test('journals a retryable dev failure and rethrows the original error', async () => {
    const params = buildParams();
    resolveDefinitionAtRef.mockResolvedValue(resolvedDefinition(undefined));
    const failure = new Error('workflow transport unavailable');
    startDevRun.mockRejectedValue(failure);

    await expect(createDevRun(params)).rejects.toBe(failure);

    const events = await eventsForWorkspace(params.workspaceId);
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('dev');
    expect(event.eventRef).toEqual(expect.stringMatching(SYNTHESIZED_EVENT_REF));
    expect(event.outcome).toBe('failed');
    expect(event.matchedCount).toBe(1);

    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      subscriptionKind: 'dev',
      subscriptionId: null,
      subscriptionName: 'on_demand',
      workflowDefinitionId: WORKFLOW_ID,
      decision: 'dispatch-error',
      runId: null,
      runName: null,
    });
    expect(decisions[0]?.reason).toContain('workflow transport unavailable');
    expect(devRunsCount.add).toHaveBeenCalledWith(1, {
      trigger_kind: 'manual',
      outcome: 'failed',
    });
  });
});
