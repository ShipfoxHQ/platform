import {triggerSubscriptionFactory} from '#test/index.js';

const runWorkflow = vi.fn();
const deliverEventToListener = vi.fn();
const resolveWorkflowRunTriggerReference = vi.fn();
const insertReceivedEvent = vi.fn();

vi.mock('#db/event-history.js', () => ({
  insertReceivedEvent: (...args: unknown[]) => insertReceivedEvent(...args),
  markReceivedEventDiscarded: vi.fn(),
  markReceivedEventRouted: vi.fn(),
  markReceivedEventFailed: vi.fn(),
  markReceivedEventErrored: vi.fn(),
  upsertTriggeredDecision: vi.fn(),
  upsertDispatchErrorDecision: vi.fn(),
  upsertFilterErrorDecision: vi.fn(),
  upsertListenerTriggeredDecision: vi.fn(),
  upsertListenerDispatchErrorDecision: vi.fn(),
  upsertListenerFilterErrorDecision: vi.fn(),
}));

// Import after mocks so the code under test sees the spies.
const {dispatchIntegrationEvent} = await import('./dispatch-integration-event.js');

const workflows = {
  startRunFromTrigger: (...args: unknown[]) => runWorkflow(...args),
  deliverEventToJobListener: (...args: unknown[]) => deliverEventToListener(...args),
  resolveWorkflowRunTriggerReference: (...args: unknown[]) =>
    resolveWorkflowRunTriggerReference(...args),
  getStepLogContext: async () => ({harness: 'pi' as const}),
  getLeasedAgentToolContext: async () => ({
    workspaceId: crypto.randomUUID(),
    integrations: [],
  }),
};

describe('dispatchIntegrationEvent resilience to history-write failure', () => {
  beforeEach(() => {
    runWorkflow.mockReset();
    deliverEventToListener.mockReset();
    resolveWorkflowRunTriggerReference.mockReset();
    resolveWorkflowRunTriggerReference.mockResolvedValue(null);
    deliverEventToListener.mockResolvedValue({buffered: true, skipped: false});
    insertReceivedEvent.mockReset();
    insertReceivedEvent.mockRejectedValue(new Error('history db down'));
  });

  test('still fires runWorkflow and does not throw when history recording fails', async () => {
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'Build'});
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });

    await expect(
      dispatchIntegrationEvent({
        workflows,
        eventRef: crypto.randomUUID(),
        workspaceId,
        provider: 'github',
        source: 'github',
        event: 'push',
        connectionId: crypto.randomUUID(),
        connectionName: 'Acme Production',
        deliveryId: crypto.randomUUID(),
        receivedAt: new Date(),
        payload: {ref: 'main'},
      }),
    ).resolves.toBeUndefined();

    expect(runWorkflow).toHaveBeenCalledTimes(1);
  });
});
