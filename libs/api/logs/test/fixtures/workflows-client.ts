import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {defineInterModulePresentation} from '@shipfox/inter-module';
import {createFakeInterModuleClients} from '@shipfox/node-module/inter-module/testing';

export function createTestWorkflowsClient(): WorkflowsModuleClient {
  return createFakeInterModuleClients({
    workflows: defineInterModulePresentation(workflowsInterModuleContract, {
      startRunFromTrigger: vi.fn(),
      startDevRun: vi.fn(),
      resolveWorkflowRunTriggerReference: vi.fn(),
      deliverEventToJobListener: vi.fn(),
      getStepLogContext: () => ({harness: 'pi' as const}),
      getLeasedAgentToolContext: vi.fn(),
    }),
  }).workflows;
}
