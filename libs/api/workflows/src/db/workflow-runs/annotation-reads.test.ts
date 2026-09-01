import {createHighCardinalityWorkflowRun} from '#test/index.js';
import {getWorkflowRunAnnotationOrigins} from '../workflow-runs.js';

describe('workflow run annotation origin reads', () => {
  test('enriches only the requested annotation origins from workflow-owned rows', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });

    const [origin] = await getWorkflowRunAnnotationOrigins({
      workspaceId: fixture.run.workspaceId,
      projectId: fixture.run.projectId,
      workflowRunId: fixture.run.id,
      attempt: 1,
      origins: [
        {
          jobId: fixture.jobIds[0] as string,
          jobExecutionId: fixture.executionIds[0] as string,
          stepId: fixture.stepIds[0] as string,
          stepAttempt: 1,
        },
      ],
    });

    expect(origin).toMatchObject({
      jobId: fixture.jobIds[0],
      jobLabel: 'measurement-job-0',
      jobPosition: 0,
      jobExecutionId: fixture.executionIds[0],
      executionSequence: 1,
      executionLabel: 'measurement-execution-0-1',
      stepId: fixture.stepIds[0],
      stepLabel: 'Measurement step 0',
      stepAttemptId: fixture.stepAttemptIds[0],
      stepAttempt: 1,
    });
  });

  test('retains canonical step identity when the requested attempt has not been dispatched', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });

    const [origin] = await getWorkflowRunAnnotationOrigins({
      workspaceId: fixture.run.workspaceId,
      projectId: fixture.run.projectId,
      workflowRunId: fixture.run.id,
      attempt: 1,
      origins: [
        {
          jobId: fixture.jobIds[0] as string,
          jobExecutionId: fixture.executionIds[0] as string,
          stepId: fixture.stepIds[0] as string,
          stepAttempt: 2,
        },
      ],
    });

    expect(origin).toMatchObject({
      stepId: fixture.stepIds[0],
      stepAttempt: 2,
      stepAttemptId: null,
    });
  });
});
