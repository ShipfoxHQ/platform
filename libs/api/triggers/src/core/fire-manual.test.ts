import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {triggersDecisions} from '#db/schema/decisions.js';
import {triggersReceivedEvents} from '#db/schema/received-events.js';
import {triggerSubscriptionFactory} from '#test/index.js';
import {TriggerSubscriptionNotManualError} from './errors.js';

const runWorkflow = vi.fn();

const {fireManualSubscription} = await import('./fire-manual.js');

const workflows = {startRunFromTrigger: (...args: unknown[]) => runWorkflow(...args)} as never;

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

describe('fireManualSubscription (trigger history)', () => {
  beforeEach(() => {
    runWorkflow.mockReset();
  });

  test('records a routed manual event and a triggered decision on success', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });
    const run = {id: crypto.randomUUID(), name: 'Manual run'};
    runWorkflow.mockResolvedValue(run);

    const result = await fireManualSubscription({
      workflows,
      subscriptionId: subscription.id,
      callerWorkspaceId: subscription.workspaceId,
      userId: crypto.randomUUID(),
    });

    expect(result).toEqual(run);
    const [payload] = runWorkflow.mock.calls[0] as [Record<string, unknown>];
    expect(payload).not.toHaveProperty('inputs');
    const [event] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, run.id));
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('manual');
    expect(event.outcome).toBe('routed');
    expect(event.matchedCount).toBe(1);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe('triggered');
    expect(decisions[0]?.runId).toBe(run.id);
    expect(decisions[0]?.runName).toBe('Manual run');
  });

  test('records a failed manual event with a dispatch-error decision and re-throws when runWorkflow throws', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });
    runWorkflow.mockRejectedValue(new Error('manual boom'));

    await expect(
      fireManualSubscription({
        workflows,
        subscriptionId: subscription.id,
        callerWorkspaceId: subscription.workspaceId,
        userId: crypto.randomUUID(),
      }),
    ).rejects.toThrow('manual boom');

    const events = await eventsForWorkspace(subscription.workspaceId);
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('manual');
    expect(event.outcome).toBe('failed');
    expect(event.matchedCount).toBe(1);
    expect(event.processedAt).toBeNull();
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe('dispatch-error');
    expect(decisions[0]?.reason).toContain('manual boom');
  });

  test('records an errored (terminal) manual event when runWorkflow fails permanently', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });
    runWorkflow.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'definition-not-found',
        {definitionId: crypto.randomUUID()},
      ),
    );

    await expect(
      fireManualSubscription({
        workflows,
        subscriptionId: subscription.id,
        callerWorkspaceId: subscription.workspaceId,
        userId: crypto.randomUUID(),
      }),
    ).rejects.toThrow('definition-not-found');

    const events = await eventsForWorkspace(subscription.workspaceId);
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('errored');
    expect(event.matchedCount).toBe(1);
    expect(event.processedAt).toBeInstanceOf(Date);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions[0]?.decision).toBe('dispatch-error');
    expect(decisions[0]?.reason).toContain('definition-not-found');
  });

  test('falls back to fire in history when a bad row stores a NULL event', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: null,
      config: {},
    });
    const run = {id: crypto.randomUUID(), name: 'Manual run'};
    runWorkflow.mockResolvedValue(run);

    await fireManualSubscription({
      workflows,
      subscriptionId: subscription.id,
      callerWorkspaceId: subscription.workspaceId,
      userId: crypto.randomUUID(),
    });

    const [event] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, run.id));
    if (!event) throw new Error('received event not found');
    expect(event.event).toBe('fire');
    expect(event.outcome).toBe('routed');
  });

  test('does not record a received event when the subscription is not a manual trigger', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'github',
      event: 'push',
      config: {},
    });

    await expect(
      fireManualSubscription({
        workflows,
        subscriptionId: subscription.id,
        callerWorkspaceId: subscription.workspaceId,
        userId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(TriggerSubscriptionNotManualError);

    expect(await eventsForWorkspace(subscription.workspaceId)).toHaveLength(0);
    expect(runWorkflow).not.toHaveBeenCalled();
  });
});
