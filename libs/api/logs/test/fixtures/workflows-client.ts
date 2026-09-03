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
      listJobStepAttempts: vi.fn(),
      getLeasedAgentToolContext: vi.fn(),
      getLeasedAgentSessionContext: vi.fn(),
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
