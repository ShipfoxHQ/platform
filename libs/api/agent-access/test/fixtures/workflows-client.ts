import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {defineInterModulePresentation} from '@shipfox/inter-module';
import {createFakeInterModuleClients} from '@shipfox/node-module/inter-module/testing';

type WorkflowHandlerMock = ReturnType<typeof vi.fn>;

interface TestWorkflowsClient {
  workflows: WorkflowsModuleClient;
  handlers: {
    listWorkflowRuns: WorkflowHandlerMock;
    getWorkflowRunOverview: WorkflowHandlerMock;
    listWorkflowRunAttempts: WorkflowHandlerMock;
    listWorkflowRunJobs: WorkflowHandlerMock;
    getWorkflowJobDetail: WorkflowHandlerMock;
    listWorkflowJobExecutions: WorkflowHandlerMock;
    listWorkflowExecutionSteps: WorkflowHandlerMock;
    listWorkflowStepAttempts: WorkflowHandlerMock;
    getWorkflowRunSource: WorkflowHandlerMock;
    getWorkflowJobExecutionContext: WorkflowHandlerMock;
    listExecutionTriggerEvents: WorkflowHandlerMock;
    getExecutionTriggerEvent: WorkflowHandlerMock;
    getWorkflowStepAttemptDetail: WorkflowHandlerMock;
    listWorkflowRunAnnotations: WorkflowHandlerMock;
    listWorkflowRunJobExplanations: WorkflowHandlerMock;
    listFailedStepAttempts: WorkflowHandlerMock;
    getLatestRunAttempt: WorkflowHandlerMock;
    getLatestStepAttempt: WorkflowHandlerMock;
  };
}

export function createTestWorkflowsClient(): TestWorkflowsClient {
  const handlers = {
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
    listExecutionTriggerEvents: vi.fn(),
    getExecutionTriggerEvent: vi.fn(),
    getWorkflowStepAttemptDetail: vi.fn(),
    listWorkflowRunAnnotations: vi.fn(),
    listWorkflowRunJobExplanations: vi.fn(),
    listFailedStepAttempts: vi.fn(),
    getLatestRunAttempt: vi.fn(),
    getLatestStepAttempt: vi.fn(),
  };
  const workflows = createFakeInterModuleClients({
    workflows: defineInterModulePresentation(workflowsInterModuleContract, {
      startRunFromTrigger: vi.fn(),
      startDevRun: vi.fn(),
      resolveWorkflowRunTriggerReference: vi.fn(),
      deliverEventToJobListener: vi.fn(),
      getStepLogContext: vi.fn(),
      listJobStepAttempts: vi.fn(),
      getLeasedAgentToolContext: vi.fn(),
      getLeasedAgentSessionContext: vi.fn(),
      listWorkflowRuns: (input) => handlers.listWorkflowRuns(input),
      getWorkflowRunOverview: (input) => handlers.getWorkflowRunOverview(input),
      listWorkflowRunAttempts: (input) => handlers.listWorkflowRunAttempts(input),
      listWorkflowRunJobs: (input) => handlers.listWorkflowRunJobs(input),
      getWorkflowJobDetail: (input) => handlers.getWorkflowJobDetail(input),
      listWorkflowJobExecutions: (input) => handlers.listWorkflowJobExecutions(input),
      listWorkflowExecutionSteps: (input) => handlers.listWorkflowExecutionSteps(input),
      listWorkflowStepAttempts: (input) => handlers.listWorkflowStepAttempts(input),
      getWorkflowRunSource: (input) => handlers.getWorkflowRunSource(input),
      getWorkflowJobExecutionContext: (input) => handlers.getWorkflowJobExecutionContext(input),
      listExecutionTriggerEvents: (input) => handlers.listExecutionTriggerEvents(input),
      getExecutionTriggerEvent: (input) => handlers.getExecutionTriggerEvent(input),
      getWorkflowStepAttemptDetail: (input) => handlers.getWorkflowStepAttemptDetail(input),
      listWorkflowRunAnnotations: (input) => handlers.listWorkflowRunAnnotations(input),
      listWorkflowRunJobExplanations: (input) => handlers.listWorkflowRunJobExplanations(input),
      listFailedStepAttempts: (input) => handlers.listFailedStepAttempts(input),
      getStepAttemptDetail: vi.fn(),
      getLatestRunAttempt: (input) => handlers.getLatestRunAttempt(input),
      getLatestStepAttempt: (input) => handlers.getLatestStepAttempt(input),
    }),
  }).workflows;

  return {workflows, handlers};
}
