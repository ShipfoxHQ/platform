import {deriveJobDisplayStatus, type JobDisplayStatus} from './job.js';
import {deriveJobExecutionDisplayStatus, type JobExecutionStatus} from './job-execution.js';

type DisplayStep = Parameters<typeof deriveJobExecutionDisplayStatus>[0]['steps'][number];

function displayStep(status: string): DisplayStep {
  return {status} as DisplayStep;
}

const EXECUTION_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;
const TERMINAL_EXECUTION_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;

describe('deriveJobExecutionDisplayStatus', () => {
  test.each(
    EXECUTION_STATUSES,
  )('%s without a running step displays Pending unless terminal', (status) => {
    const displayStatus = deriveJobExecutionDisplayStatus({status, steps: []});

    expect(displayStatus).toBe(
      TERMINAL_EXECUTION_STATUSES.includes(status as (typeof TERMINAL_EXECUTION_STATUSES)[number])
        ? status
        : 'pending',
    );
  });

  test.each([
    'pending',
    'running',
  ] as const)('%s with a running step displays Running', (status) => {
    expect(deriveJobExecutionDisplayStatus({status, steps: [displayStep('running')]})).toBe(
      'running',
    );
  });

  test.each(TERMINAL_EXECUTION_STATUSES)('%s wins over a running child step', (status) => {
    expect(deriveJobExecutionDisplayStatus({status, steps: [displayStep('running')]})).toBe(status);
  });
});

describe('deriveJobDisplayStatus', () => {
  test('uses the execution activity for a one-shot job', () => {
    const statuses: Array<[JobExecutionStatus, string[], JobDisplayStatus]> = [
      ['pending', [], 'pending'],
      ['pending', ['running'], 'running'],
      ['running', [], 'pending'],
      ['running', ['running'], 'running'],
    ];

    for (const [status, stepStatuses, expected] of statuses) {
      expect(
        deriveJobDisplayStatus({
          mode: 'one_shot',
          status: 'running',
          listenerStatus: 'inactive',
          jobExecutions: [
            {
              status,
              steps: stepStatuses.map(displayStep),
              sequence: 1,
            },
          ] as never,
        }),
      ).toBe(expected);
    }
  });

  test.each([
    'succeeded',
    'failed',
    'cancelled',
    'skipped',
  ] as const)('terminal job status %s wins over child activity', (status) => {
    expect(
      deriveJobDisplayStatus({
        mode: 'one_shot',
        status,
        listenerStatus: 'inactive',
        jobExecutions: [{status: 'running', steps: [{status: 'running'}], sequence: 1}] as never,
      }),
    ).toBe(status);
  });

  test('keeps an active listener as Listening without executions', () => {
    expect(
      deriveJobDisplayStatus({
        mode: 'listening',
        status: 'running',
        listenerStatus: 'listening',
        jobExecutions: [],
      }),
    ).toBe('listening');
  });

  test('uses list execution evidence when the step tree is not present', () => {
    expect(
      deriveJobDisplayStatus({
        mode: 'one_shot',
        status: 'pending',
        listenerStatus: 'inactive',
        executionStatus: 'running',
        jobExecutions: [],
      }),
    ).toBe('running');
  });

  test('uses the terminal job status when an active listener has resolved', () => {
    expect(
      deriveJobDisplayStatus({
        mode: 'listening',
        status: 'succeeded',
        listenerStatus: 'listening',
        jobExecutions: [],
      }),
    ).toBe('succeeded');
  });
});
