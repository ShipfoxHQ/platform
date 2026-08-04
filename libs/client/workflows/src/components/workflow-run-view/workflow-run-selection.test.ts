import {
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunDetail,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {resolveWorkflowRunSelection} from './workflow-run-selection.js';

describe('resolveWorkflowRunSelection', () => {
  test('selects a valid job without expanding a step', () => {
    const build = workflowJobDto({id: 'job-build', name: 'build'});
    const deploy = workflowJobDto({id: 'job-deploy', name: 'deploy', position: 1});
    const run = workflowRunDetail({jobs: [build, deploy]});

    const resolved = resolveWorkflowRunSelection({
      run,
      selection: {jobId: 'job-deploy'},
    });

    expect(resolved.job?.id).toBe('job-deploy');
    expect(resolved.step).toBeUndefined();
    expect(resolved.attempt).toBeUndefined();
    expect(resolved.selectedAttemptId).toBeNull();
  });

  test('selects a step owner job without an explicit job id', () => {
    const attempt = workflowStepAttemptDto({id: 'attempt-1', step_id: 'step-deploy'});
    const step = workflowStepDto({
      id: 'step-deploy',
      current_attempt: 1,
      attempts: [attempt],
    });
    const run = workflowRunDetail({
      jobs: [
        workflowJobDto({id: 'job-build', name: 'build'}),
        workflowJobDto({id: 'job-deploy', name: 'deploy', position: 1, steps: [step]}),
      ],
    });

    const resolved = resolveWorkflowRunSelection({
      run,
      selection: {stepId: 'step-deploy'},
    });

    expect(resolved.job?.id).toBe('job-deploy');
    expect(resolved.jobExecution?.id).toBeDefined();
    expect(resolved.step?.id).toBe('step-deploy');
    expect(resolved.attempt?.id).toBe('attempt-1');
    expect(resolved.selectedAttemptId).toBe('attempt-1');
  });

  test('selects a valid job execution within the selected job', () => {
    const firstExecution = workflowJobExecutionDto({
      id: 'execution-1',
      sequence: 1,
      status: 'failed',
    });
    const secondExecution = workflowJobExecutionDto({
      id: 'execution-2',
      sequence: 2,
      status: 'succeeded',
    });
    const run = workflowRunDetail({
      jobs: [
        workflowJobDto({
          id: 'job-build',
          name: 'build',
          job_executions: [firstExecution, secondExecution],
        }),
      ],
    });

    const resolved = resolveWorkflowRunSelection({
      run,
      selection: {jobId: 'job-build', jobExecutionId: 'execution-1'},
    });

    expect(resolved.job?.id).toBe('job-build');
    expect(resolved.jobExecution?.id).toBe('execution-1');
    expect(resolved.step).toBeUndefined();
    expect(resolved.selectedAttemptId).toBeNull();
  });

  test('finds a job from a legacy job execution selection', () => {
    const execution = workflowJobExecutionDto({id: 'execution-deploy', sequence: 1});
    const run = workflowRunDetail({
      jobs: [
        workflowJobDto({id: 'job-build', name: 'build'}),
        workflowJobDto({
          id: 'job-deploy',
          name: 'deploy',
          position: 1,
          job_executions: [execution],
        }),
      ],
    });

    const resolved = resolveWorkflowRunSelection({
      run,
      selection: {jobExecutionId: 'execution-deploy'},
    });

    expect(resolved.job?.id).toBe('job-deploy');
    expect(resolved.jobExecution?.id).toBe('execution-deploy');
  });

  test('falls back from an invalid job execution id to the running execution', () => {
    const run = workflowRunDetail({
      jobs: [
        workflowJobDto({
          id: 'job-build',
          name: 'build',
          job_executions: [
            workflowJobExecutionDto({id: 'execution-1', sequence: 1, status: 'failed'}),
            workflowJobExecutionDto({id: 'execution-2', sequence: 2, status: 'running'}),
          ],
        }),
      ],
    });

    const resolved = resolveWorkflowRunSelection({
      run,
      selection: {jobId: 'job-build', jobExecutionId: 'missing-execution'},
    });

    expect(resolved.jobExecution?.id).toBe('execution-2');
  });

  test('defaults to the highest sequence when no execution is running', () => {
    const run = workflowRunDetail({
      jobs: [
        workflowJobDto({
          id: 'job-build',
          name: 'build',
          job_executions: [
            workflowJobExecutionDto({id: 'execution-1', sequence: 1, status: 'failed'}),
            workflowJobExecutionDto({id: 'execution-3', sequence: 3, status: 'succeeded'}),
            workflowJobExecutionDto({id: 'execution-2', sequence: 2, status: 'cancelled'}),
          ],
        }),
      ],
    });

    const resolved = resolveWorkflowRunSelection({
      run,
      selection: {jobId: 'job-build'},
    });

    expect(resolved.jobExecution?.id).toBe('execution-3');
  });

  test('uses the exact valid attempt id when present', () => {
    const firstAttempt = workflowStepAttemptDto({
      id: 'attempt-1',
      step_id: 'step-deploy',
      attempt: 1,
    });
    const secondAttempt = workflowStepAttemptDto({
      id: 'attempt-2',
      step_id: 'step-deploy',
      attempt: 2,
    });
    const step = workflowStepDto({
      id: 'step-deploy',
      current_attempt: 1,
      attempts: [firstAttempt, secondAttempt],
    });
    const run = workflowRunDetail({
      jobs: [workflowJobDto({id: 'job-deploy', name: 'deploy', steps: [step]})],
    });

    const resolved = resolveWorkflowRunSelection({
      run,
      selection: {jobId: 'job-deploy', stepId: 'step-deploy', stepAttemptId: 'attempt-2'},
    });

    expect(resolved.attempt?.id).toBe('attempt-2');
    expect(resolved.selectedAttemptId).toBe('attempt-2');
  });

  test('finds the step owner from a legacy step attempt selection', () => {
    const attempt = workflowStepAttemptDto({id: 'attempt-deploy', step_id: 'step-deploy'});
    const step = workflowStepDto({
      id: 'step-deploy',
      current_attempt: 1,
      attempts: [attempt],
    });
    const run = workflowRunDetail({
      jobs: [
        workflowJobDto({id: 'job-build', name: 'build'}),
        workflowJobDto({id: 'job-deploy', name: 'deploy', position: 1, steps: [step]}),
      ],
    });

    const resolved = resolveWorkflowRunSelection({
      run,
      selection: {stepAttemptId: 'attempt-deploy'},
    });

    expect(resolved.job?.id).toBe('job-deploy');
    expect(resolved.step?.id).toBe('step-deploy');
    expect(resolved.attempt?.id).toBe('attempt-deploy');
    expect(resolved.selectedAttemptId).toBe('attempt-deploy');
  });

  test('lets a valid step override a mismatched job id', () => {
    const step = workflowStepDto({
      id: 'step-deploy',
      attempts: [workflowStepAttemptDto({id: 'attempt-1', step_id: 'step-deploy'})],
    });
    const run = workflowRunDetail({
      jobs: [
        workflowJobDto({id: 'job-build', name: 'build'}),
        workflowJobDto({id: 'job-deploy', name: 'deploy', position: 1, steps: [step]}),
      ],
    });

    const resolved = resolveWorkflowRunSelection({
      run,
      selection: {jobId: 'job-build', stepId: 'step-deploy'},
    });

    expect(resolved.job?.id).toBe('job-deploy');
    expect(resolved.step?.id).toBe('step-deploy');
  });

  test('falls back from an invalid attempt id to the current attempt', () => {
    const firstAttempt = workflowStepAttemptDto({
      id: 'attempt-1',
      step_id: 'step-deploy',
      attempt: 1,
    });
    const secondAttempt = workflowStepAttemptDto({
      id: 'attempt-2',
      step_id: 'step-deploy',
      attempt: 2,
    });
    const step = workflowStepDto({
      id: 'step-deploy',
      current_attempt: 2,
      attempts: [firstAttempt, secondAttempt],
    });
    const run = workflowRunDetail({
      jobs: [workflowJobDto({id: 'job-deploy', name: 'deploy', steps: [step]})],
    });

    const resolved = resolveWorkflowRunSelection({
      run,
      selection: {stepId: 'step-deploy', stepAttemptId: 'missing-attempt'},
    });

    expect(resolved.attempt?.id).toBe('attempt-2');
    expect(resolved.selectedAttemptId).toBe('attempt-2');
  });

  test('falls back to the latest attempt when the current attempt is missing', () => {
    const firstAttempt = workflowStepAttemptDto({
      id: 'attempt-1',
      step_id: 'step-deploy',
      attempt: 1,
      execution_order: 1,
    });
    const thirdAttempt = workflowStepAttemptDto({
      id: 'attempt-3',
      step_id: 'step-deploy',
      attempt: 3,
      execution_order: 3,
    });
    const step = workflowStepDto({
      id: 'step-deploy',
      current_attempt: 2,
      attempts: [firstAttempt, thirdAttempt],
    });
    const run = workflowRunDetail({
      jobs: [workflowJobDto({id: 'job-deploy', name: 'deploy', steps: [step]})],
    });

    const resolved = resolveWorkflowRunSelection({
      run,
      selection: {stepId: 'step-deploy'},
    });

    expect(resolved.attempt?.id).toBe('attempt-3');
  });

  test('falls back to the first job for invalid job or step ids', () => {
    const run = workflowRunDetail({
      jobs: [
        workflowJobDto({id: 'job-build', name: 'build'}),
        workflowJobDto({id: 'job-deploy', name: 'deploy', position: 1}),
      ],
    });

    const resolved = resolveWorkflowRunSelection({
      run,
      selection: {jobId: 'missing-job', stepId: 'missing-step'},
    });

    expect(resolved.job?.id).toBe('job-build');
    expect(resolved.step).toBeUndefined();
    expect(resolved.selectedAttemptId).toBeNull();
  });

  test('handles empty runs and zero-attempt steps', () => {
    const emptyRun = workflowRunDetail({jobs: []});
    const zeroAttemptStep = workflowStepDto({id: 'step-empty', attempts: []});
    const run = workflowRunDetail({
      jobs: [workflowJobDto({id: 'job-build', name: 'build', steps: [zeroAttemptStep]})],
    });

    const emptyResolved = resolveWorkflowRunSelection({
      run: emptyRun,
      selection: {jobId: 'job-build'},
    });
    const zeroAttemptResolved = resolveWorkflowRunSelection({
      run,
      selection: {stepId: 'step-empty'},
    });

    expect(emptyResolved.job).toBeUndefined();
    expect(emptyResolved.selectedAttemptId).toBeNull();
    expect(zeroAttemptResolved.job?.id).toBe('job-build');
    expect(zeroAttemptResolved.step?.id).toBe('step-empty');
    expect(zeroAttemptResolved.attempt).toBeUndefined();
    expect(zeroAttemptResolved.selectedAttemptId).toBeNull();
  });
});
