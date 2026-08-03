import {workflowsInterModuleContract} from './inter-module.js';

describe('workflowsInterModuleContract', () => {
  test('accepts trigger commands and listener deliveries', () => {
    const start = workflowsInterModuleContract.methods.startRunFromTrigger.input.parse({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      projectId: '00000000-0000-4000-8000-000000000002',
      definitionId: '00000000-0000-4000-8000-000000000003',
      triggerPayload: {
        provider: 'github',
        source: 'github',
        event: 'push',
        deliveryId: 'delivery-1',
        data: {ref: 'refs/heads/main'},
      },
      triggerConnectionId: '00000000-0000-4000-8000-000000000005',
      idempotencyKey: 'subscription-1:event-1',
    });
    const delivery = workflowsInterModuleContract.methods.deliverEventToJobListener.input.parse({
      jobId: '00000000-0000-4000-8000-000000000004',
      disposition: 'fire',
      eventRef: 'event-1',
      deliveryId: 'delivery-1',
      source: 'github',
      event: 'push',
      provider: 'github',
      triggerConnectionId: '00000000-0000-4000-8000-000000000005',
      payload: {ref: 'refs/heads/main'},
      receivedAt: '2026-07-20T12:00:00.000Z',
    });
    const reference =
      workflowsInterModuleContract.methods.resolveWorkflowRunTriggerReference.input.parse({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        triggerConnectionId: '00000000-0000-4000-8000-000000000005',
        triggerPayload: {
          provider: 'github',
          source: 'github',
          event: 'push',
          deliveryId: 'delivery-1',
          data: {ref: 'refs/heads/main'},
        },
      });

    expect(start.idempotencyKey).toBe('subscription-1:event-1');
    expect(start.triggerConnectionId).toBe('00000000-0000-4000-8000-000000000005');
    expect(delivery.disposition).toBe('fire');
    expect(reference.triggerConnectionId).toBe('00000000-0000-4000-8000-000000000005');
    expect(delivery.triggerConnectionId).toBe('00000000-0000-4000-8000-000000000005');
  });

  test('accepts the minimal Logs and agent-tools query payloads', () => {
    const stepId = '00000000-0000-4000-8000-000000000006';
    const logContext = workflowsInterModuleContract.methods.getStepLogContext.input.parse({stepId});
    const agentTools = workflowsInterModuleContract.methods.getLeasedAgentToolContext.input.parse({
      jobId: '00000000-0000-4000-8000-000000000007',
      jobExecutionId: '00000000-0000-4000-8000-000000000008',
      runnerSessionId: '00000000-0000-4000-8000-000000000009',
      stepId,
      attempt: 1,
    });

    expect(logContext).toEqual({stepId});
    expect(agentTools.attempt).toBe(1);
  });

  test.each([
    ['workspace-not-found', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
    ['workspace-suspended', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
    ['workspace-deleted', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
    ['definition-not-found', {definitionId: '00000000-0000-4000-8000-000000000001'}],
    ['project-mismatch', {}],
    ['agent-config-unresolvable', {definitionId: '00000000-0000-4000-8000-000000000001'}],
    ['agent-integration-materialization-failed', {}],
    [
      'interpolation-unresolvable',
      {
        definitionId: '00000000-0000-4000-8000-000000000001',
        field: 'env',
        source: 'event.ref',
        envKey: 'REF',
      },
    ],
    ['invalid-job-runner-labels', {labels: ['linux', 'gpu']}],
  ] as const)('defines the %s start-run failure', (code, details) => {
    const schema = workflowsInterModuleContract.methods.startRunFromTrigger.errors[code];
    const parsed = schema.parse(details);

    expect(parsed).toEqual(details);
  });

  test.each([
    ['workspace-not-found', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
    ['workspace-suspended', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
    ['workspace-deleted', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
  ] as const)('defines the %s listener-delivery failure', (code, details) => {
    const schema = workflowsInterModuleContract.methods.deliverEventToJobListener.errors[code];

    expect(schema.parse(details)).toEqual(details);
  });

  test.each([
    'lease-not-active',
    'step-not-found',
    'job-not-found',
    'step-attempt-mismatch',
    'step-not-running',
    'leased-step-not-agent',
    'agent-step-config-invalid',
  ])('defines the %s agent-tools failure', (code) => {
    const schema =
      workflowsInterModuleContract.methods.getLeasedAgentToolContext.errors[
        code as keyof typeof workflowsInterModuleContract.methods.getLeasedAgentToolContext.errors
      ];

    expect(schema.parse({})).toEqual({});
  });
});
