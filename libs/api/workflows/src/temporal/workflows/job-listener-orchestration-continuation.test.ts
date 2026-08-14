const workflowMocks = vi.hoisted(() => ({
  cancelScope: vi.fn(),
  condition: vi.fn(),
  continueAsNew: vi.fn(),
  executeChild: vi.fn(),
  proxyActivities: vi.fn(() => ({})),
  setHandler: vi.fn(),
  workflowInfo: vi.fn(() => ({continueAsNewSuggested: false})),
}));

vi.mock('@temporalio/workflow', () => ({
  CancellationScope: class {
    run<T>(fn: () => T): T {
      return fn();
    }
    cancel = workflowMocks.cancelScope;
  },
  condition: workflowMocks.condition,
  continueAsNew: workflowMocks.continueAsNew,
  defineSignal: vi.fn((name: string) => name),
  executeChild: workflowMocks.executeChild,
  log: {warn: vi.fn()},
  ParentClosePolicy: {TERMINATE: 'TERMINATE'},
  proxyActivities: workflowMocks.proxyActivities,
  setHandler: workflowMocks.setHandler,
  workflowInfo: workflowMocks.workflowInfo,
}));

import {
  type JobListenerOrchestrationInput,
  LISTENER_CONTINUE_AS_NEW_FIRING_LIMIT,
  listenerContinuationInput,
  shouldContinueListenerAsNew,
} from './job-listener-orchestration.js';

describe('listener continue-as-new guard', () => {
  it('continues when Temporal suggests it', () => {
    const shouldContinue = shouldContinueListenerAsNew({
      firingsInCurrentRun: 0,
      continueAsNewSuggested: true,
    });

    expect(shouldContinue).toBe(true);
  });

  it('continues when the bounded firing count is reached', () => {
    const shouldContinue = shouldContinueListenerAsNew({
      firingsInCurrentRun: LISTENER_CONTINUE_AS_NEW_FIRING_LIMIT,
      continueAsNewSuggested: false,
    });

    expect(shouldContinue).toBe(true);
  });

  it('keeps looping below the history guard thresholds', () => {
    const shouldContinue = shouldContinueListenerAsNew({
      firingsInCurrentRun: LISTENER_CONTINUE_AS_NEW_FIRING_LIMIT - 1,
      continueAsNewSuggested: false,
    });

    expect(shouldContinue).toBe(false);
  });

  it('carries listener loop state into the continued run', () => {
    const input: JobListenerOrchestrationInput = {
      runAttemptId: 'attempt-1',
      jobId: 'job-1',
      jobVersion: 3,
      requiredLabels: ['ubuntu22'],
      listeningTimeoutMs: 30_000,
      maxExecutions: 10,
      onResolve: 'finish',
    };

    const continued = listenerContinuationInput(input, {
      nextSequence: 7,
      latchedReason: 'until',
      listenerDeadline: 1_725_000_000_000,
    });

    expect(continued).toEqual({
      ...input,
      continuation: {
        nextSequence: 7,
        latchedReason: 'until',
        listenerDeadline: 1_725_000_000_000,
      },
    });
  });
});
