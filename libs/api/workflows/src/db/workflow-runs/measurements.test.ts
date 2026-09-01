import {createHighCardinalityWorkflowRun} from '#test/index.js';
import {getWorkflowRunDetail, type WorkflowRunDetailReadMeasurement} from '../workflow-runs.js';
import {measureWorkflowRunDetail} from './measurements.js';

describe('workflow-run detail measurements', () => {
  test('reproduces legacy join amplification and audits safe compatibility evidence', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 3,
      dependenciesPerJob: 2,
      executionsPerJob: 3,
      stepsPerExecution: 2,
      attemptsPerStep: 2,
      invocationsPerAttempt: 4,
    });
    let readMeasurement: WorkflowRunDetailReadMeasurement | undefined;

    const detail = await getWorkflowRunDetail(fixture.run.id, 1, undefined, {
      onRead: (measurement) => {
        readMeasurement = measurement;
      },
    });
    const report = await measureWorkflowRunDetail({
      workflowRunAttemptId: fixture.workflowRunAttemptId,
      analyze: true,
    });

    expect(detail?.jobs).toHaveLength(fixture.counts.jobs);
    expect(readMeasurement).toMatchObject({
      returnedRows: fixture.counts.legacyJoinedRows,
    });
    expect(report.cardinality).toEqual(fixture.counts);
    expect(report.storage.maximumInvocationArrayLength).toBe(4);
    expect(report.storage.executionStatusReasons).toEqual([
      {value: 'user_cancelled', count: 3},
      {value: 'step_failed', count: 3},
      {value: null, count: 3},
    ]);
    expect(report.storage.stepTypes.map(({value}) => value).sort()).toEqual([
      'agent',
      'checkout',
      'run',
      'tool',
    ]);
    expect(report.storage.stepStatuses.map(({value}) => value).sort()).toEqual([
      'cancelled',
      'failed',
      'pending',
      'running',
      'skipped',
      'succeeded',
    ]);
    expect(report.storage.stepAttemptStatuses.map(({value}) => value).sort()).toEqual([
      'cancelled',
      'failed',
      'running',
      'succeeded',
    ]);
    expect(report.queryPlans).toMatchObject({
      analyzed: true,
      defaultExecutionSelection: expect.anything(),
      executionStatusCounts: expect.anything(),
    });

    const serializedReport = JSON.stringify(report);
    expect(serializedReport).not.toContain('measurement-source');
    expect(serializedReport).not.toContain('measurement-input');
    expect(serializedReport).not.toContain('measurement-config');
  });
});
