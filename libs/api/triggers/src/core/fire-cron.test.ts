import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {triggersDecisions} from '#db/schema/decisions.js';
import {triggersReceivedEvents} from '#db/schema/received-events.js';
import {triggerSubscriptionFactory} from '#test/index.js';
import {TriggerSubscriptionNotCronError} from './errors.js';

const runWorkflow = vi.fn();

const {fireCronSubscription} = await import('./fire-cron.js');

const workflows = {startRunFromTrigger: (...args: unknown[]) => runWorkflow(...args)} as never;

const SLOT = new Date('2026-07-05T02:00:00.000Z');

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

describe('fireCronSubscription', () => {
  beforeEach(() => {
    runWorkflow.mockReset();
  });

  test('records a routed cron event and a triggered decision on success', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'cron',
      event: 'tick',
      config: {with: {environment: 'staging'}},
    });
    const run = {id: crypto.randomUUID(), name: 'Cron run'};
    runWorkflow.mockResolvedValue(run);

    const result = await fireCronSubscription({
      workflows,
      subscriptionId: subscription.id,
      scheduledSlot: SLOT,
    });

    expect(result).toEqual({outcome: 'fired', run});
    const [payload] = runWorkflow.mock.calls[0] as [Record<string, unknown>];
    expect(payload.triggerPayload).toEqual({
      provider: 'cron',
      source: 'cron',
      event: 'tick',
      scheduleId: subscription.id,
    });
    expect(payload.inputs).toEqual({environment: 'staging'});
    expect(payload.idempotencyKey).toBe(`${subscription.id}:${SLOT.toISOString()}`);
    const [event] = await eventsForWorkspace(subscription.workspaceId);
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('cron');
    expect(event.source).toBe('cron');
    expect(event.provider).toBeNull();
    expect(event.outcome).toBe('routed');
    expect(event.eventRef).toBe(`${subscription.id}:${SLOT.toISOString()}`);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe('triggered');
    expect(decisions[0]?.runId).toBe(run.id);
  });

  test('returns errored (terminal) and records a dispatch-error decision on a permanent failure', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'cron',
      event: 'tick',
      config: {},
    });
    runWorkflow.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'definition-not-found',
        {definitionId: crypto.randomUUID()},
      ),
    );

    const result = await fireCronSubscription({
      workflows,
      subscriptionId: subscription.id,
      scheduledSlot: SLOT,
    });

    expect(result).toEqual({outcome: 'errored'});
    const [event] = await eventsForWorkspace(subscription.workspaceId);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('errored');
    expect(event.processedAt).toBeInstanceOf(Date);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions[0]?.decision).toBe('dispatch-error');
    expect(decisions[0]?.reason).toContain('definition-not-found');
  });

  test('omits inputs when the subscription has no configured inputs', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'cron',
      event: 'tick',
      config: {},
    });
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'Cron run'});

    await fireCronSubscription({
      workflows,
      subscriptionId: subscription.id,
      scheduledSlot: SLOT,
    });

    const [payload] = runWorkflow.mock.calls[0] as [Record<string, unknown>];
    expect(payload).not.toHaveProperty('inputs');
  });

  test('re-throws and leaves the event non-terminal on a transient failure', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'cron',
      event: 'tick',
      config: {},
    });
    runWorkflow.mockRejectedValue(new Error('cron boom'));

    await expect(
      fireCronSubscription({workflows, subscriptionId: subscription.id, scheduledSlot: SLOT}),
    ).rejects.toThrow('cron boom');

    const [event] = await eventsForWorkspace(subscription.workspaceId);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('failed');
    expect(event.processedAt).toBeNull();
    const decisions = await decisionsForEvent(event.id);
    expect(decisions[0]?.decision).toBe('dispatch-error');
  });

  test('falls back to tick in history when a bad row stores a NULL event', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'cron',
      event: null,
      config: {},
    });
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'Cron run'});

    await fireCronSubscription({
      workflows,
      subscriptionId: subscription.id,
      scheduledSlot: SLOT,
    });

    const [event] = await eventsForWorkspace(subscription.workspaceId);
    if (!event) throw new Error('received event not found');
    expect(event.event).toBe('tick');
    expect(event.outcome).toBe('routed');
  });

  test('throws and records nothing when the subscription is not a cron trigger', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });

    await expect(
      fireCronSubscription({workflows, subscriptionId: subscription.id, scheduledSlot: SLOT}),
    ).rejects.toThrow(TriggerSubscriptionNotCronError);

    expect(await eventsForWorkspace(subscription.workspaceId)).toHaveLength(0);
    expect(runWorkflow).not.toHaveBeenCalled();
  });
});
