import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {triggersDecisions} from '#db/schema/decisions.js';
import {triggersReceivedEvents} from '#db/schema/received-events.js';
import {jobListenerSubscriptionFactory, triggerSubscriptionFactory} from '#test/index.js';

const runWorkflow = vi.fn();
const deliverEventToListener = vi.fn();
const resolveWorkflowRunTriggerReference = vi.fn();

const {dispatchIntegrationEvent} = await import('./dispatch-integration-event.js');

const workflows = {
  startRunFromTrigger: (...args: unknown[]) => runWorkflow(...args),
  startDevRun: vi.fn(),
  deliverEventToJobListener: (...args: unknown[]) => deliverEventToListener(...args),
  resolveWorkflowRunTriggerReference: (...args: unknown[]) =>
    resolveWorkflowRunTriggerReference(...args),
  getStepLogContext: async () => ({harness: 'pi' as const}),
  listJobStepAttempts: async () => ({stepAttemptIds: []}),
  getLeasedAgentToolContext: async () => ({
    workspaceId: crypto.randomUUID(),
    integrations: [],
  }),
  getLeasedAgentSessionContext: async () => ({
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    stepAttemptId: crypto.randomUUID(),
    session: null,
  }),
  listWorkflowRuns: async () => ({runs: [], nextCursor: null, filteredTotalCount: null}),
  getWorkflowRunOverview: async () => null,
  listWorkflowRunAttempts: async () => null,
  listWorkflowRunJobs: async () => null,
  getWorkflowJobDetail: async () => null,
  listWorkflowJobExecutions: async () => null,
  listWorkflowExecutionSteps: async () => null,
  listWorkflowStepAttempts: async () => null,
  getWorkflowRunSource: async () => null,
  getWorkflowJobExecutionContext: async () => null,
  listExecutionTriggerEvents: async () => null,
  getExecutionTriggerEvent: async () => null,
  getWorkflowStepAttemptDetail: async () => null,
  listWorkflowRunAnnotations: async () => null,
  listWorkflowRunJobExplanations: async () => null,
  listFailedStepAttempts: async () => null,
  getWorkflowRunDetail: async () => ({run: null}),
  getStepAttemptDetail: async () => ({detail: null}),
  getLatestRunAttempt: async () => ({attempt: null}),
  getLatestStepAttempt: async () => ({attempt: null}),
};

function definitionNotFound(_definitionId: string) {
  return createInterModuleKnownError(
    workflowsInterModuleContract.methods.startRunFromTrigger,
    'definition-not-found',
    {definitionId: crypto.randomUUID()},
  );
}

function admissionDenied(workspaceId: string) {
  return createInterModuleKnownError(
    workflowsInterModuleContract.methods.startRunFromTrigger,
    'admission-denied',
    {workspaceId, reason: 'billing-payment-method-required'},
  );
}

function projectMismatch() {
  return createInterModuleKnownError(
    workflowsInterModuleContract.methods.startRunFromTrigger,
    'project-mismatch',
    {},
  );
}

interface DispatchOverrides {
  eventRef?: string;
  workspaceId?: string;
  provider?: string;
  source?: string;
  event?: string;
  deliveryId?: string;
  connectionId?: string;
  payload?: unknown;
  receivedAt?: Date;
}

function dispatch(overrides: DispatchOverrides = {}): Promise<void> {
  return dispatchIntegrationEvent({
    workflows,
    eventRef: overrides.eventRef ?? crypto.randomUUID(),
    provider: overrides.provider ?? overrides.source ?? 'github',
    source: overrides.source ?? 'github',
    event: overrides.event ?? 'push',
    workspaceId: overrides.workspaceId ?? crypto.randomUUID(),
    connectionId: overrides.connectionId ?? crypto.randomUUID(),
    connectionName: 'Acme Production',
    deliveryId: overrides.deliveryId ?? crypto.randomUUID(),
    receivedAt: overrides.receivedAt ?? new Date(),
    payload: overrides.payload ?? {ref: 'main', headCommitSha: 'abc123'},
  });
}

async function receivedEvent(eventRef: string) {
  const [row] = await db()
    .select()
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.eventRef, eventRef));
  return row;
}

function decisionsForEvent(receivedEventId: string) {
  return db()
    .select()
    .from(triggersDecisions)
    .where(eq(triggersDecisions.receivedEventId, receivedEventId));
}

describe('dispatchIntegrationEvent', () => {
  beforeEach(() => {
    runWorkflow.mockReset();
    deliverEventToListener.mockReset();
    resolveWorkflowRunTriggerReference.mockReset();
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'Build and test'});
    deliverEventToListener.mockResolvedValue({buffered: true, skipped: false});
    resolveWorkflowRunTriggerReference.mockResolvedValue(null);
  });

  test('fires the workflow for each matching workspace subscription, regardless of project', async () => {
    const workspaceId = crypto.randomUUID();
    const subA = await triggerSubscriptionFactory.create({
      workspaceId,
      projectId: crypto.randomUUID(),
      source: 'github',
      event: 'push',
      config: {},
    });
    const subB = await triggerSubscriptionFactory.create({
      workspaceId,
      projectId: crypto.randomUUID(),
      source: 'github',
      event: 'push',
      config: {},
    });

    await dispatch({workspaceId});

    expect(runWorkflow).toHaveBeenCalledTimes(2);
    const firedProjects = runWorkflow.mock.calls.map(([params]) => params.projectId);
    expect(firedProjects).toEqual(expect.arrayContaining([subA.projectId, subB.projectId]));
  });

  test('fires a workspace subscription for a push event whose payload references a repository outside the run project', async () => {
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const source = 'github_shipfox';
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source,
      event: 'push',
      config: {},
    });
    const payload = {
      ref: 'refs/heads/main',
      repository: {id: 987, full_name: 'contributor/other-project'},
    };

    await dispatch({workspaceId, connectionId, provider: 'github', source, event: 'push', payload});

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: subscription.projectId,
        triggerConnectionId: connectionId,
        triggerPayload: expect.objectContaining({
          provider: 'github',
          source,
          event: 'push',
          data: payload,
        }),
      }),
    );
  });

  test('passes the source, event, deliveryId and raw payload through as the trigger payload', async () => {
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const deliveryId = crypto.randomUUID();
    const payload = {ref: 'refs/heads/feature', headCommitSha: 'deadbeef'};
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });

    await dispatch({workspaceId, connectionId, deliveryId, payload});

    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerConnectionId: connectionId,
        triggerPayload: {
          provider: 'github',
          source: 'github',
          event: 'push',
          deliveryId,
          data: payload,
        },
      }),
    );
  });

  test('dispatches an arbitrary non-github source without any source-specific handling', async () => {
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'sentry',
      event: 'alert_triggered',
      config: {},
    });

    await dispatch({workspaceId, source: 'sentry', event: 'alert_triggered'});

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerPayload: expect.objectContaining({source: 'sentry', event: 'alert_triggered'}),
      }),
    );
  });

  test('dispatches a Linear data webhook event to a matching trigger subscription', async () => {
    const workspaceId = crypto.randomUUID();
    const deliveryId = crypto.randomUUID();
    const payload = {
      action: 'create',
      type: 'Issue',
      organizationId: 'linear-org-id',
      webhookTimestamp: Date.now(),
      data: {
        id: 'issue-id',
        identifier: 'ENG-876',
        title: 'Receive and verify Linear webhooks',
      },
    };
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'Linear_Acme',
      event: 'Issue.create',
      config: {},
    });

    await dispatch({
      provider: 'linear',
      workspaceId,
      source: 'Linear_Acme',
      event: 'Issue.create',
      deliveryId,
      payload,
    });

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: subscription.projectId,
        definitionId: subscription.workflowDefinitionId,
        triggerPayload: {
          provider: 'linear',
          source: 'Linear_Acme',
          event: 'Issue.create',
          deliveryId,
          data: payload,
        },
      }),
    );
  });

  test('dispatches AgentSessionEvent deliveries only to the matching app-user filter', async () => {
    const workspaceId = crypto.randomUUID();
    const payload = {
      action: 'created',
      type: 'AgentSessionEvent',
      organizationId: 'linear-org-id',
      appUserId: 'app-user-1',
      webhookTimestamp: Date.now(),
      agentSession: {id: 'session-id', commentId: 'comment-id'},
    };
    const matching = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'Linear_Acme',
      event: 'agentSession.created',
      config: {filter: 'event.appUserId == "app-user-1"'},
    });
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'Linear_Acme',
      event: 'agentSession.created',
      config: {filter: 'event.appUserId == "other-app-user"'},
    });

    await dispatch({
      provider: 'linear',
      workspaceId,
      source: 'Linear_Acme',
      event: 'agentSession.created',
      payload,
    });

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: matching.projectId,
        triggerPayload: expect.objectContaining({data: payload}),
      }),
    );
  });

  test('routes webhook events only when workspace, source, and received event match', async () => {
    const workspaceId = crypto.randomUUID();
    const matching = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'stripe_prod',
      event: 'received',
      config: {},
    });
    await triggerSubscriptionFactory.create({
      workspaceId: crypto.randomUUID(),
      source: 'stripe_prod',
      event: 'received',
      config: {},
    });
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'stripe_stage',
      event: 'received',
      config: {},
    });
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'stripe_prod',
      event: 'ping',
      config: {},
    });

    await dispatch({
      provider: 'webhook',
      workspaceId,
      source: 'stripe_prod',
      event: 'received',
      payload: {
        method: 'POST',
        headers: {'x-stripe-signature': 'sig_123'},
        query: {mode: 'live'},
        body: {payment_id: 'pay_123'},
      },
    });

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: matching.projectId,
        definitionId: matching.workflowDefinitionId,
        triggerPayload: expect.objectContaining({
          provider: 'webhook',
          source: 'stripe_prod',
          event: 'received',
          data: {
            method: 'POST',
            headers: {'x-stripe-signature': 'sig_123'},
            query: {mode: 'live'},
            body: {payment_id: 'pay_123'},
          },
        }),
      }),
    );
  });

  test('fires a NULL-event source subscription for any delivered event, with the delivered event name', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: null,
      config: {},
    });

    await dispatch({workspaceId, eventRef, source: 'github', event: 'pull_request'});

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: subscription.projectId,
        definitionId: subscription.workflowDefinitionId,
        triggerPayload: expect.objectContaining({source: 'github', event: 'pull_request'}),
      }),
    );
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.source).toBe('github');
    expect(event.event).toBe('pull_request');
    expect(event.outcome).toBe('routed');
  });

  test('fans out mixed exact-event and NULL-event subscriptions by delivered event', async () => {
    const workspaceId = crypto.randomUUID();
    const exactSubscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const wildcardSubscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: null,
      config: {},
    });
    const pushEventRef = crypto.randomUUID();

    await dispatch({workspaceId, event: 'push', eventRef: pushEventRef});

    expect(runWorkflow).toHaveBeenCalledTimes(2);
    expect(runWorkflow.mock.calls.map(([params]) => params.idempotencyKey)).toEqual(
      expect.arrayContaining([
        `${exactSubscription.id}:${pushEventRef}`,
        `${wildcardSubscription.id}:${pushEventRef}`,
      ]),
    );

    runWorkflow.mockClear();
    const pullRequestEventRef = crypto.randomUUID();
    await dispatch({workspaceId, event: 'pull_request', eventRef: pullRequestEventRef});

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `${wildcardSubscription.id}:${pullRequestEventRef}`,
      }),
    );
  });

  test('does not fire a NULL-event subscription for a different source or workspace', async () => {
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: null,
      config: {},
    });

    await dispatch({
      workspaceId,
      source: 'sentry',
      event: 'alert_triggered',
    });
    await dispatch({
      workspaceId: crypto.randomUUID(),
      source: 'github',
      event: 'push',
    });

    expect(runWorkflow).not.toHaveBeenCalled();
  });

  test('passes triggerIdempotencyKey = subscription.id:eventRef to runWorkflow', async () => {
    const workspaceId = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const eventRef = crypto.randomUUID();

    await dispatch({workspaceId, eventRef});

    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({idempotencyKey: `${subscription.id}:${eventRef}`}),
    );
  });

  test('forwards subscription.config.with as inputs to runWorkflow', async () => {
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {with: {env: 'staging'}},
    });

    await dispatch({workspaceId});

    expect(runWorkflow).toHaveBeenCalledWith(expect.objectContaining({inputs: {env: 'staging'}}));
  });

  test('omits inputs when the subscription has no configured inputs', async () => {
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });

    await dispatch({workspaceId});

    const [payload] = runWorkflow.mock.calls[0] as [Record<string, unknown>];
    expect(payload).not.toHaveProperty('inputs');
  });

  test('runs only subscriptions whose trigger filter matches the payload', async () => {
    const workspaceId = crypto.randomUUID();
    const matching = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {filter: 'event.repository.full_name == "shipfox/platform"'},
    });
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {filter: 'event.repository.full_name == "shipfox/docs"'},
    });

    await dispatch({workspaceId, payload: {repository: {full_name: 'shipfox/platform'}}});

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({projectId: matching.projectId}),
    );
  });

  test('records a discarded event when source subscriptions are filtered out', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {filter: 'event.ref == "refs/heads/main"'},
    });

    await dispatch({workspaceId, eventRef, payload: {ref: 'refs/heads/feature'}});

    expect(runWorkflow).not.toHaveBeenCalled();
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('discarded');
    expect(event.matchedCount).toBe(0);
  });

  test('records a filter-error decision when a trigger filter is invalid', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {filter: 'event.ref =='},
    });

    await dispatch({workspaceId, eventRef, payload: {ref: 'refs/heads/main'}});

    expect(runWorkflow).not.toHaveBeenCalled();
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('errored');
    expect(event.matchedCount).toBe(1);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      subscriptionId: subscription.id,
      decision: 'filter-error',
    });
  });

  test('records a filter-error decision when a stored trigger filter is blank', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {filter: '   '},
    });

    await dispatch({workspaceId, eventRef, payload: {ref: 'refs/heads/main'}});

    expect(runWorkflow).not.toHaveBeenCalled();
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('errored');
    expect(event.matchedCount).toBe(1);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      subscriptionId: subscription.id,
      decision: 'filter-error',
    });
  });

  test('does not fire when no subscription matches the workspace, source and event', async () => {
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });

    await dispatch({workspaceId, event: 'pull_request'});

    expect(runWorkflow).not.toHaveBeenCalled();
  });

  test('routes listener-only matches without creating a workflow run', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId,
      source: 'github',
      event: 'push',
    });

    await dispatch({workspaceId, eventRef});

    expect(runWorkflow).not.toHaveBeenCalled();
    expect(deliverEventToListener).toHaveBeenCalledWith(expect.objectContaining({jobId}));
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('routed');
    expect(event.matchedCount).toBe(1);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      subscriptionKind: 'listener',
      jobId,
      decision: 'triggered',
    });
  });

  test('records rejected listener-only matches as errored without triggering a listener', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const subscription = await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });
    deliverEventToListener.mockResolvedValueOnce({
      buffered: false,
      skipped: false,
      rejection: {
        reason: 'payload-too-large',
        eventId: crypto.randomUUID(),
        measuredBytes: 786_433,
        limitBytes: 786_432,
      },
    });

    await dispatch({workspaceId, eventRef});

    expect(runWorkflow).not.toHaveBeenCalled();
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('errored');
    expect(event.matchedCount).toBe(1);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      subscriptionKind: 'listener',
      subscriptionId: subscription.id,
      decision: 'rejected',
      reason: 'payload-too-large',
    });
  });

  test('treats listener replay conflicts as routed idempotent success', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });
    deliverEventToListener.mockResolvedValue({buffered: false, skipped: false});

    await dispatch({workspaceId, eventRef});
    await dispatch({workspaceId, eventRef});

    expect(runWorkflow).not.toHaveBeenCalled();
    expect(deliverEventToListener).toHaveBeenCalledTimes(2);
    const events = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, eventRef));
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('routed');
    expect(events[0]?.matchedCount).toBe(1);
  });

  test('does not route listener-only stale subscriptions skipped by workflows', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });
    deliverEventToListener.mockResolvedValue({buffered: false, skipped: true});

    await dispatch({workspaceId, eventRef});

    expect(runWorkflow).not.toHaveBeenCalled();
    expect(deliverEventToListener).toHaveBeenCalledTimes(1);
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('discarded');
    expect(event.matchedCount).toBe(0);
    expect(await decisionsForEvent(event.id)).toHaveLength(0);
  });

  test('routes both definition and listener fan-outs for the same event', async () => {
    const workspaceId = crypto.randomUUID();
    const definitionSubscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const jobListenerSubscription = await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });

    await dispatch({workspaceId});

    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({definitionId: definitionSubscription.workflowDefinitionId}),
    );
    expect(deliverEventToListener).toHaveBeenCalledWith(
      expect.objectContaining({jobId: jobListenerSubscription.jobId}),
    );
    const [event] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.workspaceId, workspaceId));
    if (!event) throw new Error('received event not found');
    expect(event.matchedCount).toBe(2);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(2);
    expect(decisions.map((decision) => decision.subscriptionKind).sort()).toEqual([
      'listener',
      'trigger',
    ]);
  });

  test('does not deliver listener-only events whose filter does not match', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {
        filter: 'event.ref == "refs/heads/main"',
      },
    });

    await dispatch({workspaceId, eventRef, payload: {ref: 'refs/heads/feature'}});

    expect(runWorkflow).not.toHaveBeenCalled();
    expect(deliverEventToListener).not.toHaveBeenCalled();
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('discarded');
    expect(event.matchedCount).toBe(0);
    expect(await decisionsForEvent(event.id)).toHaveLength(0);
  });

  test('records a listener filter-error decision when listener filter evaluation fails', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const subscription = await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {
        filter: 'jobs.build.outputs.pr_number == 42',
        filter_snapshot: {},
      },
    });

    await dispatch({workspaceId, eventRef});

    expect(runWorkflow).not.toHaveBeenCalled();
    expect(deliverEventToListener).not.toHaveBeenCalled();
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('errored');
    expect(event.matchedCount).toBe(1);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      subscriptionKind: 'listener',
      subscriptionId: subscription.id,
      workflowRunId: subscription.workflowRunId,
      jobId: subscription.jobId,
      matcherKind: 'on',
      matcherOrdinal: subscription.matcherOrdinal,
      decision: 'filter-error',
      reason: 'Listener filter evaluation failed',
    });
  });

  test('records a listener dispatch-error decision when listener delivery throws', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const subscription = await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });
    deliverEventToListener.mockRejectedValue(new Error('workflow db down'));

    await expect(dispatch({workspaceId, eventRef})).rejects.toThrow('workflow db down');

    expect(runWorkflow).not.toHaveBeenCalled();
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('failed');
    expect(event.matchedCount).toBe(1);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      subscriptionKind: 'listener',
      subscriptionId: subscription.id,
      decision: 'dispatch-error',
      reason: 'workflow db down',
    });
  });
});

describe('dispatchIntegrationEvent trigger history', () => {
  beforeEach(() => {
    runWorkflow.mockReset();
    deliverEventToListener.mockReset();
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'Build and test'});
    deliverEventToListener.mockResolvedValue({buffered: true, skipped: false});
  });

  test('records a discarded event when no subscription matches', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();

    await dispatch({workspaceId, event: 'pull_request', eventRef});

    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('integration');
    expect(event.outcome).toBe('discarded');
    expect(event.matchedCount).toBe(0);
    expect(event.processedAt).toBeInstanceOf(Date);
    expect(await decisionsForEvent(event.id)).toHaveLength(0);
  });

  test('records a routed event with a triggered decision per matched subscription', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const subA = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const subB = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const runs: {id: string; name: string}[] = [];
    runWorkflow.mockImplementation(() => {
      const run = {id: crypto.randomUUID(), name: 'Build and test'};
      runs.push(run);
      return run;
    });

    await dispatch({workspaceId, eventRef});

    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('routed');
    expect(event.matchedCount).toBe(2);
    expect(event.processedAt).toBeInstanceOf(Date);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d) => d.decision === 'triggered')).toBe(true);
    expect(decisions.map((d) => d.subscriptionId).sort()).toEqual([subA.id, subB.id].sort());
    expect(decisions.map((d) => d.runId).sort()).toEqual(runs.map((r) => r.id).sort());
    expect(decisions.every((d) => d.runName === 'Build and test')).toBe(true);
  });

  test('continues the fan-out past a transient error, records a failed event, and re-throws', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    runWorkflow.mockRejectedValue(new Error('runWorkflow boom'));

    await expect(dispatch({workspaceId, eventRef})).rejects.toThrow('runWorkflow boom');

    expect(runWorkflow).toHaveBeenCalledTimes(2);
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('failed');
    expect(event.matchedCount).toBe(2);
    expect(event.processedAt).toBeNull();
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d) => d.decision === 'dispatch-error')).toBe(true);
    expect(decisions.every((d) => d.reason?.includes('runWorkflow boom'))).toBe(true);
  });

  test('re-throws the first transient error, not a later one', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    let attempt = 0;
    runWorkflow.mockImplementation(() => {
      attempt += 1;
      throw new Error(attempt === 1 ? 'first transient' : 'second transient');
    });

    await expect(dispatch({workspaceId, eventRef})).rejects.toThrow('first transient');

    expect(runWorkflow).toHaveBeenCalledTimes(2);
  });

  test('treats a thrown undefined as a transient failure and re-throws it', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    runWorkflow.mockRejectedValue(undefined);

    await expect(dispatch({workspaceId, eventRef})).rejects.toBeUndefined();

    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('failed');
    expect(event.processedAt).toBeNull();
  });

  test('runs every sibling and routes when one subscription is permanently broken', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const poison = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const healthy = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const run = {id: crypto.randomUUID(), name: 'Build and test'};
    runWorkflow.mockImplementation(({projectId}: {projectId: string}) => {
      if (projectId === poison.projectId) throw definitionNotFound('def-gone');
      return run;
    });

    await dispatch({workspaceId, eventRef});

    expect(runWorkflow).toHaveBeenCalledTimes(2);
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('routed');
    expect(event.matchedCount).toBe(2);
    expect(event.processedAt).toBeInstanceOf(Date);
    const decisions = await decisionsForEvent(event.id);
    const errored = decisions.find((d) => d.subscriptionId === poison.id);
    const triggered = decisions.find((d) => d.subscriptionId === healthy.id);
    expect(errored?.decision).toBe('dispatch-error');
    expect(errored?.reason).toContain('definition-not-found');
    expect(triggered?.decision).toBe('triggered');
    expect(triggered?.runId).toBe(run.id);
  });

  test('records an admission denial reason as a terminal integration event', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    runWorkflow.mockRejectedValue(admissionDenied(workspaceId));

    await dispatch({workspaceId, eventRef});

    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('errored');
    const [decision] = await decisionsForEvent(event.id);
    expect(decision).toMatchObject({
      decision: 'dispatch-error',
      reason: 'billing-payment-method-required',
    });
  });

  test('marks the event errored when every subscription errors permanently', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    runWorkflow.mockImplementation(() => {
      throw projectMismatch();
    });

    await dispatch({workspaceId, eventRef});

    expect(runWorkflow).toHaveBeenCalledTimes(2);
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('errored');
    expect(event.matchedCount).toBe(2);
    expect(event.processedAt).toBeInstanceOf(Date);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d) => d.decision === 'dispatch-error')).toBe(true);
  });

  test('records failed (not errored) when a permanent and a transient error mix in one attempt', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const permanent = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    runWorkflow.mockImplementation(({projectId}: {projectId: string}) => {
      if (projectId === permanent.projectId) throw definitionNotFound('def-gone');
      throw new Error('transient boom');
    });

    await expect(dispatch({workspaceId, eventRef})).rejects.toThrow('transient boom');

    expect(runWorkflow).toHaveBeenCalledTimes(2);
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('failed');
    expect(event.processedAt).toBeNull();
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d) => d.decision === 'dispatch-error')).toBe(true);
  });

  test('promotes to routed across replay when a prior run survives a later definition deletion', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const ranThenDeleted = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const transient = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const run = {id: crypto.randomUUID(), name: 'Build and test'};

    runWorkflow.mockImplementation(({projectId}: {projectId: string}) => {
      if (projectId === ranThenDeleted.projectId) return run;
      throw new Error('transient boom');
    });
    await expect(dispatch({workspaceId, eventRef})).rejects.toThrow('transient boom');

    // A later permanent failure must not downgrade a run recorded during a prior
    // transiently failed attempt.
    runWorkflow.mockImplementation(() => {
      throw definitionNotFound('def-gone');
    });
    await dispatch({workspaceId, eventRef});

    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('routed');
    expect(event.processedAt).toBeInstanceOf(Date);
    const decisions = await decisionsForEvent(event.id);
    const survived = decisions.find((d) => d.subscriptionId === ranThenDeleted.id);
    const stillBroken = decisions.find((d) => d.subscriptionId === transient.id);
    expect(survived?.decision).toBe('triggered');
    expect(survived?.runId).toBe(run.id);
    expect(stillBroken?.decision).toBe('dispatch-error');
  });

  test('replaying the same event does not duplicate rows and reuses the idempotency key', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'Build and test'});

    await dispatch({workspaceId, eventRef});
    await dispatch({workspaceId, eventRef});

    const events = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, eventRef));
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error('received event not found');
    expect(await decisionsForEvent(event.id)).toHaveLength(1);
    // `runWorkflow` is mocked here; run-row dedup depends on stable keys at its boundary.
    const keys = runWorkflow.mock.calls.map(([params]) => params.idempotencyKey);
    expect(keys).toEqual([`${subscription.id}:${eventRef}`, `${subscription.id}:${eventRef}`]);
  });

  test('records a triggered and dispatch-error decision for a mixed-outcome fan-out', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const run = {id: crypto.randomUUID(), name: 'Build and test'};
    runWorkflow.mockResolvedValueOnce(run).mockRejectedValueOnce(new Error('second boom'));

    await expect(dispatch({workspaceId, eventRef})).rejects.toThrow('second boom');

    expect(runWorkflow).toHaveBeenCalledTimes(2);
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('failed');
    expect(event.matchedCount).toBe(2);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(2);
    const triggered = decisions.find((d) => d.decision === 'triggered');
    const errored = decisions.find((d) => d.decision === 'dispatch-error');
    expect(triggered?.runId).toBe(run.id);
    expect(errored?.reason).toContain('second boom');
  });

  test('converges a failed event to routed when a later replay succeeds', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const run = {id: crypto.randomUUID(), name: 'Build and test'};
    runWorkflow.mockRejectedValueOnce(new Error('transient boom')).mockResolvedValue(run);

    await expect(dispatch({workspaceId, eventRef})).rejects.toThrow('transient boom');
    await dispatch({workspaceId, eventRef});

    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('routed');
    expect(event.matchedCount).toBe(1);
    expect(event.processedAt).toBeInstanceOf(Date);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.subscriptionId).toBe(subscription.id);
    expect(decisions[0]?.decision).toBe('triggered');
    expect(decisions[0]?.runId).toBe(run.id);
    expect(decisions[0]?.reason).toBeNull();
  });
});
