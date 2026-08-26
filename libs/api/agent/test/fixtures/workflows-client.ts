import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {defineInterModulePresentation} from '@shipfox/inter-module';
import {createFakeInterModuleClients} from '@shipfox/node-module/inter-module/testing';

/**
 * Fake workflows client for agent route tests. The session transcript routes
 * only use `getLeasedAgentSessionContext`; the remaining methods are stubbed
 * to satisfy the full inter-module contract.
 */
export function createTestWorkflowsClient(
  params: {
    getLeasedAgentSessionContext?: () => ReturnType<
      WorkflowsModuleClient['getLeasedAgentSessionContext']
    >;
  } = {},
): WorkflowsModuleClient {
  return createFakeInterModuleClients({
    workflows: defineInterModulePresentation(workflowsInterModuleContract, {
      startRunFromTrigger: vi.fn(),
      startDevRun: vi.fn(),
      resolveWorkflowRunTriggerReference: vi.fn(),
      deliverEventToJobListener: vi.fn(),
      getStepLogContext: () => ({harness: 'pi' as const}),
      listJobStepAttempts: vi.fn(),
      getLeasedAgentToolContext: vi.fn(),
      getLeasedAgentSessionContext:
        params.getLeasedAgentSessionContext ??
        (() =>
          Promise.resolve({
            workspaceId: crypto.randomUUID(),
            projectId: crypto.randomUUID(),
            workflowRunAttemptId: crypto.randomUUID(),
            stepAttemptId: crypto.randomUUID(),
            session: null,
          })),
    }),
  }).workflows;
}
