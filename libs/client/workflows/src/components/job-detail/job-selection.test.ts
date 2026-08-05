import {
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunDetail,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {resolveWorkflowJobSelection, workflowJobLandingSelection} from './job-selection.js';

describe('resolveWorkflowJobSelection', () => {
  test('resolves a deep-linked step and exact attempt within the job', () => {
    const step = workflowStepDto({
      id: 'step-build',
      attempts: [
        workflowStepAttemptDto({id: 'attempt-1', step_id: 'step-build', attempt: 1}),
        workflowStepAttemptDto({id: 'attempt-2', step_id: 'step-build', attempt: 2}),
      ],
    });
    const job = workflowRunDetail({
      jobs: [workflowJobDto({id: 'job-build', steps: [step]})],
    }).jobs[0];
    if (!job) throw new Error('Expected a job');

    const resolved = resolveWorkflowJobSelection({
      job,
      selection: {
        stepId: 'step-build',
        stepAttemptId: 'attempt-2',
        jobExecutionId: 'missing-execution',
      },
    });

    expect(resolved.step?.id).toBe('step-build');
    expect(resolved.attempt?.id).toBe('attempt-2');
    expect(resolved.selectedAttemptId).toBe('attempt-2');
  });

  test('drops a step id belonging to another job and uses the default execution', () => {
    const otherJobStep = workflowStepDto({id: 'step-other'});
    const job = workflowRunDetail({
      jobs: [
        workflowJobDto({
          id: 'job-build',
          job_executions: [
            workflowJobExecutionDto({id: 'execution-old', job_id: 'job-build', sequence: 1}),
            workflowJobExecutionDto({id: 'execution-build', job_id: 'job-build', sequence: 2}),
          ],
        }),
        workflowJobDto({id: 'job-other', steps: [otherJobStep], position: 1}),
      ],
    }).jobs[0];
    if (!job) throw new Error('Expected a job');

    const resolved = resolveWorkflowJobSelection({
      job,
      selection: {stepId: 'step-other', jobExecutionId: 'execution-old'},
    });

    expect(resolved.step).toBeUndefined();
    expect(resolved.jobExecution?.id).toBe('execution-build');
  });

  test('a step wins over a valid execution id from another execution', () => {
    const step = workflowStepDto({id: 'step-build', job_execution_id: 'execution-two'});
    const job = workflowRunDetail({
      jobs: [
        workflowJobDto({
          id: 'job-build',
          job_executions: [
            workflowJobExecutionDto({id: 'execution-one', job_id: 'job-build', sequence: 1}),
            workflowJobExecutionDto({
              id: 'execution-two',
              job_id: 'job-build',
              sequence: 2,
              steps: [step],
            }),
          ],
        }),
      ],
    }).jobs[0];
    if (!job) throw new Error('Expected a job');

    const resolved = resolveWorkflowJobSelection({
      job,
      selection: {stepId: 'step-build', jobExecutionId: 'execution-one'},
    });

    expect(resolved.jobExecution?.id).toBe('execution-two');
  });
});

describe('workflowJobLandingSelection', () => {
  test('selects the running step', () => {
    const job = workflowRunDetail({
      jobs: [
        workflowJobDto({
          steps: [
            workflowStepDto({
              id: 'step-finished',
              status: 'succeeded',
              attempts: [workflowStepAttemptDto({status: 'succeeded'})],
            }),
            workflowStepDto({
              id: 'step-running',
              position: 1,
              status: 'running',
              attempts: [workflowStepAttemptDto({id: 'attempt-running', status: 'running'})],
            }),
          ],
        }),
      ],
    }).jobs[0]?.jobExecutions[0];

    expect(workflowJobLandingSelection(job)).toEqual({
      stepId: 'step-running',
      attemptId: 'attempt-running',
    });
  });

  test('selects the first failed step when no step is running', () => {
    const job = workflowRunDetail({
      jobs: [
        workflowJobDto({
          steps: [
            workflowStepDto({
              id: 'step-failed-first',
              status: 'failed',
              attempts: [workflowStepAttemptDto({id: 'attempt-failed-first', status: 'failed'})],
            }),
            workflowStepDto({
              id: 'step-failed-second',
              position: 1,
              status: 'failed',
              attempts: [workflowStepAttemptDto({status: 'failed'})],
            }),
          ],
        }),
      ],
    }).jobs[0]?.jobExecutions[0];

    expect(workflowJobLandingSelection(job)).toEqual({
      stepId: 'step-failed-first',
      attemptId: 'attempt-failed-first',
    });
  });

  test('selects the current attempt for the first failed step', () => {
    const job = workflowRunDetail({
      jobs: [
        workflowJobDto({
          steps: [
            workflowStepDto({
              id: 'step-failed',
              status: 'failed',
              current_attempt: 2,
              attempts: [
                workflowStepAttemptDto({id: 'attempt-old', attempt: 1, status: 'failed'}),
                workflowStepAttemptDto({id: 'attempt-current', attempt: 2, status: 'failed'}),
              ],
            }),
          ],
        }),
      ],
    }).jobs[0]?.jobExecutions[0];

    expect(workflowJobLandingSelection(job)).toEqual({
      stepId: 'step-failed',
      attemptId: 'attempt-current',
    });
  });

  test('selects nothing when every step succeeded', () => {
    const job = workflowRunDetail({
      jobs: [
        workflowJobDto({
          steps: [
            workflowStepDto({
              status: 'succeeded',
              attempts: [workflowStepAttemptDto({status: 'succeeded'})],
            }),
          ],
        }),
      ],
    }).jobs[0]?.jobExecutions[0];

    expect(workflowJobLandingSelection(job)).toBeUndefined();
  });
});
