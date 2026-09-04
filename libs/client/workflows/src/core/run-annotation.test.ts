import {runAnnotationEntryFixture} from '#test/fixtures/workflow-run.js';
import {
  buildRunAnnotationList,
  highestRunAnnotationSeverity,
  type RunAnnotationEntry,
  type RunAnnotationRecord,
  type RunAnnotationStyle,
  summarizeJobAnnotations,
  summarizeRunAnnotations,
} from './run-annotation.js';

const BUILD_JOB_ID = '44444444-4444-4444-8444-00000000000b';
const TEST_JOB_ID = '44444444-4444-4444-8444-00000000000c';
const BUILD_EXECUTION_ID = '77777777-7777-4777-8777-00000000000b';
const TEST_EXECUTION_ONE_ID = '77777777-7777-4777-8777-00000000000c';
const TEST_EXECUTION_TWO_ID = '77777777-7777-4777-8777-00000000000d';
const BUILD_STEP_ID = '55555555-5555-4555-8555-00000000000b';
const TEST_STEP_ID = '55555555-5555-4555-8555-00000000000c';
const BUILD_ATTEMPT_ID = '66666666-6666-4666-8666-00000000000b';

describe('summarizeRunAnnotations', () => {
  test('counts every annotation in the total and only severities per severity', () => {
    const annotations = [
      annotation({id: 'a', style: 'error'}),
      annotation({id: 'b', style: 'warning'}),
      annotation({id: 'c', style: 'default'}),
      annotation({id: 'd', style: 'error'}),
    ];

    const summary = summarizeRunAnnotations(annotations);

    expect(summary).toEqual({
      total: 4,
      error: 2,
      warning: 1,
      info: 0,
      success: 0,
      truncated: false,
    });
  });

  test('carries truncation so counts read as a lower bound', () => {
    const summary = summarizeRunAnnotations([annotation({id: 'a', style: 'info'})], {
      truncated: true,
    });

    expect(summary.truncated).toBe(true);
  });
});

describe('summarizeJobAnnotations', () => {
  test('counts only the annotations owned by one job', () => {
    const annotations = [
      annotation({id: 'a', style: 'error', jobId: BUILD_JOB_ID}),
      annotation({id: 'b', style: 'warning', jobId: TEST_JOB_ID}),
      annotation({id: 'c', style: 'info', jobId: TEST_JOB_ID}),
    ];

    const summary = summarizeJobAnnotations(annotations, TEST_JOB_ID);

    expect(summary.total).toBe(2);
    expect(summary.error).toBe(0);
    expect(summary.warning).toBe(1);
  });
});

describe('highestRunAnnotationSeverity', () => {
  test('reports the loudest severity present', () => {
    const summary = summarizeRunAnnotations([
      annotation({id: 'a', style: 'success'}),
      annotation({id: 'b', style: 'warning'}),
    ]);

    expect(highestRunAnnotationSeverity(summary)).toBe('warning');
  });

  test('reports nothing when only unstyled annotations exist', () => {
    const summary = summarizeRunAnnotations([annotation({id: 'a', style: 'default'})]);

    expect(highestRunAnnotationSeverity(summary)).toBeNull();
  });
});

describe('buildRunAnnotationList', () => {
  test('ranks by severity before emission order', () => {
    const annotations = [
      annotation({id: 'a', style: 'success', sequence: 1}),
      annotation({id: 'b', style: 'error', sequence: 2}),
      annotation({id: 'c', style: 'default', sequence: 3}),
      annotation({id: 'd', style: 'warning', sequence: 4}),
      annotation({id: 'e', style: 'info', sequence: 5}),
    ];

    const entries = buildRunAnnotationList({entries: annotationEntries(annotations)});

    expect(entries.map((entry) => entry.annotation.id)).toEqual(['b', 'd', 'e', 'a', 'c']);
  });

  test('breaks a severity tie by job position before sequence', () => {
    // `sequence` restarts per execution, so the later job's lower sequence must not lead.
    const annotations = [
      annotation({id: 'late-job', style: 'error', sequence: 1, jobId: TEST_JOB_ID}),
      annotation({id: 'early-job', style: 'error', sequence: 9, jobId: BUILD_JOB_ID}),
    ];

    const entries = buildRunAnnotationList({entries: annotationEntries(annotations)});

    expect(entries.map((entry) => entry.annotation.id)).toEqual(['early-job', 'late-job']);
  });

  test('breaks a job tie by execution sequence', () => {
    const annotations = [
      annotation({
        id: 'second-execution',
        style: 'error',
        sequence: 1,
        jobId: TEST_JOB_ID,
        jobExecutionId: TEST_EXECUTION_TWO_ID,
      }),
      annotation({
        id: 'first-execution',
        style: 'error',
        sequence: 2,
        jobId: TEST_JOB_ID,
        jobExecutionId: TEST_EXECUTION_ONE_ID,
      }),
    ];

    const entries = buildRunAnnotationList({entries: annotationEntries(annotations)});

    expect(entries.map((entry) => entry.annotation.id)).toEqual([
      'first-execution',
      'second-execution',
    ]);
  });

  test('preserves server provenance and an origin the run can route back to', () => {
    const annotations = [annotation({id: 'a', style: 'error'})];

    const [entry] = buildRunAnnotationList({entries: annotationEntries(annotations)});

    expect(entry?.jobName).toBe('build');
    expect(entry?.stepLabel).toBe('compile');
    expect(entry?.attemptLabel).toBe('attempt 1');
    expect(entry?.origin).toEqual({
      jobId: BUILD_JOB_ID,
      jobExecutionId: BUILD_EXECUTION_ID,
      stepId: BUILD_STEP_ID,
      stepAttemptId: BUILD_ATTEMPT_ID,
    });
  });

  test('names an execution only when the job ran more than once', () => {
    const annotations = [
      annotation({id: 'single', style: 'info'}),
      annotation({
        id: 'multi',
        style: 'info',
        jobId: TEST_JOB_ID,
        jobExecutionId: TEST_EXECUTION_TWO_ID,
        originStepId: TEST_STEP_ID,
      }),
    ];

    const entries = buildRunAnnotationList({entries: annotationEntries(annotations)});
    const byId = new Map(entries.map((entry) => [entry.annotation.id, entry]));

    expect(byId.get('single')?.executionLabel).toBeNull();
    expect(byId.get('multi')?.executionLabel).toBe('execution #2');
  });

  test('keeps an annotation without a routable step-attempt origin', () => {
    const annotations = [annotation({id: 'orphan', style: 'error'})];
    const [entry] = buildRunAnnotationList({
      entries: annotations.map((record) => annotationEntry(record, {origin: null})),
    });

    expect(entry?.annotation.id).toBe('orphan');
    expect(entry?.jobName).toBe('build');
    expect(entry?.stepLabel).toBe('compile');
    expect(entry?.origin).toBeNull();
  });

  test('sorts an annotation from an unknown job last rather than first', () => {
    const annotations = [
      annotation({
        id: 'unknown-job',
        style: 'error',
        jobId: '44444444-4444-4444-8444-0000000000ff',
      }),
      annotation({id: 'known-job', style: 'error'}),
    ];

    const entries = buildRunAnnotationList({entries: annotationEntries(annotations)});

    expect(entries.map((entry) => entry.annotation.id)).toEqual(['known-job', 'unknown-job']);
  });

  test('filters by severity and by job', () => {
    const annotations = [
      annotation({id: 'build-error', style: 'error'}),
      annotation({id: 'build-info', style: 'info'}),
      annotation({id: 'test-error', style: 'error', jobId: TEST_JOB_ID}),
    ];

    expect(
      buildRunAnnotationList({entries: annotationEntries(annotations), severity: 'error'}).map(
        (entry) => entry.annotation.id,
      ),
    ).toEqual(['build-error', 'test-error']);
    expect(
      buildRunAnnotationList({entries: annotationEntries(annotations), jobId: BUILD_JOB_ID}).map(
        (entry) => entry.annotation.id,
      ),
    ).toEqual(['build-error', 'build-info']);
  });

  test('never selects an unstyled annotation with a severity filter', () => {
    const annotations = [annotation({id: 'plain', style: 'default'})];

    expect(
      buildRunAnnotationList({entries: annotationEntries(annotations), severity: 'info'}),
    ).toEqual([]);
  });
});

function annotation(
  overrides: Partial<RunAnnotationRecord> & {id: string; style: RunAnnotationStyle},
): RunAnnotationRecord {
  return {
    jobId: BUILD_JOB_ID,
    jobExecutionId: BUILD_EXECUTION_ID,
    originStepId: BUILD_STEP_ID,
    originStepAttempt: 1,
    context: `context-${overrides.id}`,
    sequence: 1,
    body: 'Body',
    ...overrides,
  };
}

function annotationEntry(
  record: RunAnnotationRecord,
  overrides: Partial<RunAnnotationEntry> = {},
): RunAnnotationEntry {
  const testJob = record.jobId === TEST_JOB_ID;
  const secondExecution = record.jobExecutionId === TEST_EXECUTION_TWO_ID;
  const jobPosition = record.jobId === BUILD_JOB_ID ? 0 : Number.MAX_SAFE_INTEGER;
  return runAnnotationEntryFixture(record, {
    jobName: testJob ? 'test' : 'build',
    jobPosition: testJob ? 1 : jobPosition,
    executionSequence: secondExecution ? 2 : 1,
    executionLabel: testJob ? `execution #${secondExecution ? 2 : 1}` : null,
    stepLabel: testJob ? 'run tests' : 'compile',
    origin: {
      stepAttemptId: BUILD_ATTEMPT_ID,
    },
    ...overrides,
  });
}

function annotationEntries(records: RunAnnotationRecord[]): RunAnnotationEntry[] {
  return records.map((record) => annotationEntry(record));
}
