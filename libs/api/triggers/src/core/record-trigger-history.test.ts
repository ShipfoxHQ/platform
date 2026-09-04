import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {jobListenerSubscriptionFactory, triggerSubscriptionFactory} from '#test/index.js';

const runWorkflow = vi.fn();
const insertReceivedEvent = vi.fn();
const markReceivedEventRouted = vi.fn();
const upsertTriggeredDecision = vi.fn();
const upsertDevTriggeredDecision = vi.fn();
const upsertDevFilterErrorDecision = vi.fn();
const upsertDevDispatchErrorDecision = vi.fn();

vi.mock('#db/event-history.js', () => ({
  insertReceivedEvent: (...args: unknown[]) => insertReceivedEvent(...args),
  markReceivedEventDiscarded: vi.fn(),
  markReceivedEventRouted: (...args: unknown[]) => markReceivedEventRouted(...args),
  markReceivedEventFailed: vi.fn(),
  markReceivedEventErrored: vi.fn(),
  upsertTriggeredDecision: (...args: unknown[]) => upsertTriggeredDecision(...args),
  upsertDevTriggeredDecision: (...args: unknown[]) => upsertDevTriggeredDecision(...args),
  upsertDevFilterErrorDecision: (...args: unknown[]) => upsertDevFilterErrorDecision(...args),
  upsertDevDispatchErrorDecision: (...args: unknown[]) => upsertDevDispatchErrorDecision(...args),
  upsertDispatchErrorDecision: vi.fn(),
  upsertFilterErrorDecision: vi.fn(),
  upsertListenerTriggeredDecision: vi.fn(),
  upsertListenerDispatchErrorDecision: vi.fn(),
  upsertListenerFilterErrorDecision: vi.fn(),
}));

// Import after mocks so the code under test sees the spies.
const {beginTriggerHistory, toReason} = await import('./record-trigger-history.js');
const {fireManualSubscription} = await import('./fire-manual.js');

const workflows = {startRunFromTrigger: (...args: unknown[]) => runWorkflow(...args)} as never;

describe('trigger history is best-effort and never blocks triggering', () => {
  beforeEach(() => {
    runWorkflow.mockReset();
    insertReceivedEvent.mockReset();
    insertReceivedEvent.mockRejectedValue(new Error('history db down'));
  });

  test('beginTriggerHistory resolves and its methods never throw when the insert fails', async () => {
    const recorder = await beginTriggerHistory({
      eventRef: crypto.randomUUID(),
      origin: 'integration',
      workspaceId: crypto.randomUUID(),
      provider: 'github',
      source: 'github',
      event: 'push',
      replayOfEventId: null,
      deliveryId: null,
      connectionId: null,
      connectionName: null,
      payload: null,
      receivedAt: new Date(),
    });
    const subscription = triggerSubscriptionFactory.build();
    const listenerSubscription = jobListenerSubscriptionFactory.build();

    await expect(
      recorder.triggered(subscription, {id: crypto.randomUUID(), name: 'r'}),
    ).resolves.toBeUndefined();
    await expect(
      recorder.devTriggered('on_issue', crypto.randomUUID(), {id: crypto.randomUUID(), name: 'r'}),
    ).resolves.toBeUndefined();
    await expect(
      recorder.devFilterErrored('on_issue', crypto.randomUUID(), 'filter is false'),
    ).resolves.toBeUndefined();
    await expect(
      recorder.devDispatchErrored('on_issue', crypto.randomUUID(), 'dispatch boom'),
    ).resolves.toBeUndefined();
    await expect(recorder.dispatchErrored(subscription, 'boom')).resolves.toBeUndefined();
    await expect(recorder.filterErrored(subscription, 'bad filter')).resolves.toBeUndefined();
    await expect(recorder.listenerTriggered(listenerSubscription)).resolves.toBeUndefined();
    await expect(
      recorder.listenerDispatchErrored(listenerSubscription, 'boom'),
    ).resolves.toBeUndefined();
    await expect(
      recorder.listenerFilterErrored(listenerSubscription, 'bad filter'),
    ).resolves.toBeUndefined();
    await expect(recorder.discarded()).resolves.toBeUndefined();
    await expect(recorder.routed(1)).resolves.toBeUndefined();
    await expect(recorder.failed(1)).resolves.toBeUndefined();
    await expect(recorder.allErrored(1)).resolves.toBeUndefined();
  });

  test('fireManualSubscription still returns the run when history recording fails', async () => {
    const run = {id: crypto.randomUUID(), name: 'Manual run'};
    runWorkflow.mockResolvedValue(run);
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });

    const result = await fireManualSubscription({
      workflows,
      subscriptionId: subscription.id,
      callerWorkspaceId: subscription.workspaceId,
      userId: crypto.randomUUID(),
    });

    expect(result).toEqual(run);
    expect(runWorkflow).toHaveBeenCalledTimes(1);
  });
});

describe('a per-write failure after a successful insert is swallowed', () => {
  beforeEach(() => {
    insertReceivedEvent.mockReset();
    markReceivedEventRouted.mockReset();
    upsertTriggeredDecision.mockReset();
    insertReceivedEvent.mockResolvedValue(crypto.randomUUID());
    markReceivedEventRouted.mockRejectedValue(new Error('route write failed'));
    upsertTriggeredDecision.mockRejectedValue(new Error('decision write failed'));
  });

  test('recorder methods resolve when the insert succeeds but a later write throws', async () => {
    const recorder = await beginTriggerHistory({
      eventRef: crypto.randomUUID(),
      origin: 'integration',
      workspaceId: crypto.randomUUID(),
      provider: 'github',
      source: 'github',
      event: 'push',
      replayOfEventId: null,
      deliveryId: null,
      connectionId: null,
      connectionName: null,
      payload: null,
      receivedAt: new Date(),
    });
    const subscription = triggerSubscriptionFactory.build();

    await expect(
      recorder.triggered(subscription, {id: crypto.randomUUID(), name: 'r'}),
    ).resolves.toBeUndefined();
    await expect(recorder.routed(1)).resolves.toBeUndefined();

    // Prove the post-insert writes were actually attempted (not skipped by the
    // missing-id no-op), so the assertions exercise the swallow path they claim to.
    expect(upsertTriggeredDecision).toHaveBeenCalledTimes(1);
    expect(markReceivedEventRouted).toHaveBeenCalledTimes(1);
  });
});

describe('dev recorder variants', () => {
  beforeEach(() => {
    insertReceivedEvent.mockReset();
    upsertDevTriggeredDecision.mockReset();
    upsertDevFilterErrorDecision.mockReset();
    upsertDevDispatchErrorDecision.mockReset();
    insertReceivedEvent.mockResolvedValue(crypto.randomUUID());
  });

  test('devTriggered writes a dev decision with the trigger key, lineage id, and run', async () => {
    const recorder = await beginTriggerHistory({
      eventRef: crypto.randomUUID(),
      origin: 'dev',
      workspaceId: crypto.randomUUID(),
      provider: null,
      source: 'manual',
      event: 'fire',
      replayOfEventId: null,
      deliveryId: null,
      connectionId: null,
      connectionName: null,
      payload: null,
      receivedAt: new Date(),
    });
    const run = {id: crypto.randomUUID(), name: 'Dev run'};

    await recorder.devTriggered('on_issue', '019e98ab-0000-0000-0000-000000000001', run);

    // The dev decision carries no subscription row: the trigger key stands in
    // for subscription_name and the lineage id for workflow_definition_id.
    expect(upsertDevTriggeredDecision).toHaveBeenCalledTimes(1);
    expect(upsertDevTriggeredDecision).toHaveBeenCalledWith({
      receivedEventId: expect.any(String),
      triggerKey: 'on_issue',
      workflowDefinitionId: '019e98ab-0000-0000-0000-000000000001',
      run,
    });
  });

  test('devDispatchErrored writes a dev dispatch-error decision with the reason', async () => {
    const recorder = await beginTriggerHistory({
      eventRef: crypto.randomUUID(),
      origin: 'dev',
      workspaceId: crypto.randomUUID(),
      provider: null,
      source: 'manual',
      event: 'fire',
      replayOfEventId: null,
      deliveryId: null,
      connectionId: null,
      connectionName: null,
      payload: null,
      receivedAt: new Date(),
    });

    await recorder.devDispatchErrored(
      'on_demand',
      '019e98ab-0000-0000-0000-000000000003',
      'workspace suspended',
    );

    expect(upsertDevDispatchErrorDecision).toHaveBeenCalledTimes(1);
    expect(upsertDevDispatchErrorDecision).toHaveBeenCalledWith({
      receivedEventId: expect.any(String),
      triggerKey: 'on_demand',
      workflowDefinitionId: '019e98ab-0000-0000-0000-000000000003',
      reason: 'workspace suspended',
    });
  });

  test('devFilterErrored writes a dev filter-error decision with the reason', async () => {
    const recorder = await beginTriggerHistory({
      eventRef: crypto.randomUUID(),
      origin: 'dev',
      workspaceId: crypto.randomUUID(),
      provider: null,
      source: 'github',
      event: 'push',
      replayOfEventId: null,
      deliveryId: null,
      connectionId: null,
      connectionName: null,
      payload: null,
      receivedAt: new Date(),
    });

    await recorder.devFilterErrored(
      'on_push',
      '019e98ab-0000-0000-0000-000000000002',
      'filter is false',
    );

    expect(upsertDevFilterErrorDecision).toHaveBeenCalledTimes(1);
    expect(upsertDevFilterErrorDecision).toHaveBeenCalledWith({
      receivedEventId: expect.any(String),
      triggerKey: 'on_push',
      workflowDefinitionId: '019e98ab-0000-0000-0000-000000000002',
      reason: 'filter is false',
    });
  });
});

describe('toReason', () => {
  test('caps an over-long message at the maximum reason length', () => {
    const reason = toReason(new Error('x'.repeat(5000)));

    expect(reason).toHaveLength(2000);
  });

  test('stringifies a non-Error throwable', () => {
    const reason = toReason('plain string failure');

    expect(reason).toBe('plain string failure');
  });

  test('falls back when a non-Error throwable cannot be stringified', () => {
    const reason = toReason({
      toString() {
        throw new Error('string conversion failed');
      },
    });

    expect(reason).toBe('[unprintable thrown value]');
  });

  test('passes a short Error message through verbatim', () => {
    const reason = toReason(new Error('definition deleted'));

    expect(reason).toBe('definition deleted');
  });

  test('persists the policy reason for an admission denial', () => {
    const error = createInterModuleKnownError(
      workflowsInterModuleContract.methods.startRunFromTrigger,
      'admission-denied',
      {workspaceId: crypto.randomUUID(), reason: 'billing-payment-method-required'},
    );

    expect(toReason(error)).toBe('billing-payment-method-required');
  });
});
