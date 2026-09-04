import {
  workflowJobSelectionFromRunSelection,
  workflowRunSelectionFromResolution,
  workflowRunSelectionMatches,
} from './workflow-run-url-state.js';

describe('workflow run selection URL transforms', () => {
  test('maps resolver ancestry to canonical run and job selections', () => {
    const selection = workflowRunSelectionFromResolution({
      workflowRunId: 'run-id',
      workflowRunAttempt: 2,
      jobId: 'job-id',
      jobExecutionId: 'execution-id',
      stepId: 'step-id',
      stepAttemptId: 'step-attempt-id',
      stepAttempt: 3,
      sourceLocation: null,
    });

    expect(selection).toEqual({
      jobId: 'job-id',
      jobExecutionId: 'execution-id',
      stepId: 'step-id',
      stepAttemptId: 'step-attempt-id',
      runAttempt: 2,
    });
    expect(workflowJobSelectionFromRunSelection(selection)).toEqual({
      jobExecutionId: 'execution-id',
      stepId: 'step-id',
      stepAttemptId: 'step-attempt-id',
      runAttempt: 2,
    });
  });

  test('matches only when every canonical identity and attempt agrees', () => {
    const canonical = {
      jobId: 'job-id',
      jobExecutionId: 'execution-id',
      stepId: 'step-id',
      stepAttemptId: 'step-attempt-id',
      runAttempt: 2,
    };

    expect(workflowRunSelectionMatches(canonical, canonical)).toBe(true);
    expect(workflowRunSelectionMatches(canonical, {...canonical, runAttempt: 1})).toBe(false);
    expect(
      workflowRunSelectionMatches(canonical, {...canonical, jobExecutionId: 'other-execution'}),
    ).toBe(false);
  });
});
