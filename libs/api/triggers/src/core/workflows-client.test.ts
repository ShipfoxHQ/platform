import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {
  createInterModuleClient,
  createInterModuleKnownError,
  defineInterModulePresentation,
} from '@shipfox/inter-module';
import {createFakeInterModuleClients} from '@shipfox/node-module/inter-module/testing';
import {
  isPermanentDeliverEventToJobListenerError,
  isPermanentStartRunError,
} from './workflows-client.js';

const input = {
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
  idempotencyKey: 'subscription-1:event-1',
};
const devRunUserId = '00000000-0000-4000-8000-000000000010';

const devRunInput = {
  workspaceId: input.workspaceId,
  projectId: input.projectId,
  workflowId: input.definitionId,
  model: {
    version: 3 as const,
    model: {
      kind: 'workflow' as const,
      name: 'Build',
      triggers: [],
      jobs: [],
      dependencies: [],
    },
  },
  sourceSnapshot: {content: 'name: Build\n', format: 'yaml' as const},
  devSource: {
    ref: 'main',
    commit: 'a'.repeat(40),
    configPath: '.shipfox/workflows.yml',
    initiatedByUserId: devRunUserId,
  },
  triggerPayload: {
    source: 'manual' as const,
    event: 'fire' as const,
    userId: devRunUserId,
  },
};

const listenerInput = {
  jobId: '00000000-0000-4000-8000-000000000006',
  disposition: 'fire' as const,
  eventRef: 'event-1',
  deliveryId: 'delivery-1',
  source: 'github',
  event: 'push',
  provider: 'github',
  payload: {action: 'opened'},
  receivedAt: '2026-07-26T00:00:00.000Z',
};

const listenerErrorInput = {...listenerInput, jobId: '00000000-0000-4000-8000-000000000007'};

function localWorkflowsClient(): WorkflowsModuleClient {
  return createFakeInterModuleClients({
    workflows: defineInterModulePresentation(workflowsInterModuleContract, {
      startRunFromTrigger: ({definitionId}) => {
        if (definitionId.endsWith('0003')) return {id: definitionId, name: 'Build'};
        throw createInterModuleKnownError(
          workflowsInterModuleContract.methods.startRunFromTrigger,
          'definition-not-found',
          {definitionId},
        );
      },
      startDevRun: ({workflowId}) => ({id: workflowId, name: 'Build'}),
      resolveWorkflowRunTriggerReference: () => null,
      deliverEventToJobListener: ({jobId}) => {
        if (jobId === listenerErrorInput.jobId) {
          throw createInterModuleKnownError(
            workflowsInterModuleContract.methods.deliverEventToJobListener,
            'workspace-not-found',
            {workspaceId: input.workspaceId},
          );
        }
        return {buffered: true, skipped: false};
      },
      getStepLogContext: () => ({harness: 'pi' as const}),
      listJobStepAttempts: () => ({stepAttemptIds: []}),
      getLeasedAgentToolContext: () => ({
        workspaceId: '00000000-0000-4000-8000-000000000006',
        integrations: [],
      }),
      getLeasedAgentSessionContext: () => ({
        workspaceId: '00000000-0000-4000-8000-000000000006',
        projectId: '00000000-0000-4000-8000-000000000011',
        workflowRunAttemptId: '00000000-0000-4000-8000-000000000015',
        stepAttemptId: '00000000-0000-4000-8000-000000000012',
        session: null,
      }),
      listWorkflowRuns: vi.fn(),
      getWorkflowRunOverview: vi.fn(),
      listWorkflowRunAttempts: vi.fn(),
      listWorkflowRunJobs: vi.fn(),
      getWorkflowJobDetail: vi.fn(),
      listWorkflowJobExecutions: vi.fn(),
      listWorkflowExecutionSteps: vi.fn(),
      listWorkflowStepAttempts: vi.fn(),
      getWorkflowRunSource: vi.fn(),
      getWorkflowJobExecutionContext: vi.fn(),
      getWorkflowStepAttemptDetail: vi.fn(),
      listWorkflowRunAnnotations: vi.fn(),
      listWorkflowRunJobExplanations: vi.fn(),
      listFailedStepAttempts: vi.fn(),
      getWorkflowRunDetail: vi.fn(),
      getStepAttemptDetail: vi.fn(),
      getLatestRunAttempt: vi.fn(),
      getLatestStepAttempt: vi.fn(),
    }),
  }).workflows;
}

function serializedWorkflowsClient(local: WorkflowsModuleClient): WorkflowsModuleClient {
  return createInterModuleClient(workflowsInterModuleContract, async (call) => {
    const copiedInput = JSON.parse(JSON.stringify(call.input)) as never;
    const client = local as unknown as Record<string, (input: never) => Promise<unknown>>;
    return await client[call.method]?.(copiedInput);
  }) as WorkflowsModuleClient;
}

async function runConsumerSuite(client: WorkflowsModuleClient): Promise<void> {
  await expect(client.startRunFromTrigger(input)).resolves.toEqual({
    id: input.definitionId,
    name: 'Build',
  });

  await expect(client.startDevRun(devRunInput)).resolves.toEqual({
    id: devRunInput.workflowId,
    name: 'Build',
  });

  const result = client.startRunFromTrigger({...input, definitionId: crypto.randomUUID()});
  await expect(result).rejects.toSatisfy(isPermanentStartRunError);

  await expect(client.deliverEventToJobListener(listenerInput)).resolves.toEqual({
    buffered: true,
    skipped: false,
  });
  await expect(
    client.resolveWorkflowRunTriggerReference({
      workspaceId: input.workspaceId,
      triggerConnectionId: crypto.randomUUID(),
      triggerPayload: input.triggerPayload,
    }),
  ).resolves.toBeNull();
  await expect(client.deliverEventToJobListener(listenerErrorInput)).rejects.toMatchObject({
    code: 'workspace-not-found',
    details: {workspaceId: input.workspaceId},
  });
}

describe('WorkflowsModuleClient consumer parity', () => {
  test('keeps local and serialized clients equivalent for trigger consumers', async () => {
    const local = localWorkflowsClient();

    await runConsumerSuite(local);
    await runConsumerSuite(serializedWorkflowsClient(local));
  });

  test.each([
    'workspace-not-found',
    'workspace-suspended',
    'workspace-deleted',
  ] as const)('treats a %s listener delivery as permanent', (code) => {
    const error = createInterModuleKnownError(
      workflowsInterModuleContract.methods.deliverEventToJobListener,
      code,
      {workspaceId: input.workspaceId},
    );

    expect(isPermanentDeliverEventToJobListenerError(error)).toBe(true);
  });
});
