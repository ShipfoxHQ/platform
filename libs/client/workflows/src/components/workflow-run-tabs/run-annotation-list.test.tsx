import {act, screen, within} from '@testing-library/react';
import {useState} from 'react';
import {
  buildRunAnnotationList,
  type RunAnnotationEntry,
  type RunAnnotationRecord,
  type RunAnnotationStyle,
} from '#core/run-annotation.js';
import {renderWithRouter} from '#test/render.js';
import {
  type DerivedRunAnnotation,
  RunAnnotationList,
  type RunAnnotationListQuery,
} from './run-annotation-list.js';

const BUILD_JOB_ID = '44444444-4444-4444-8444-00000000000b';
const BUILD_EXECUTION_ID = '77777777-7777-4777-8777-00000000000b';
const BUILD_STEP_ID = '55555555-5555-4555-8555-00000000000b';
const BUILD_ATTEMPT_ID = '66666666-6666-4666-8666-00000000000b';
const MISSING_JOB_ID = '44444444-4444-4444-8444-00000000000f';
const RUN_ID = '11111111-1111-4111-8111-111111111111';

const SHOW_MORE_PATTERN = /Show \d+ more of \d+/;
const OPEN_STEP_PATTERN = /Open step/;

describe('RunAnnotationList', () => {
  test('heads a row with the block the emitting step named', async () => {
    renderList([annotation({id: 'a1', context: 'smoke check'})]);

    expect(await screen.findByRole('heading', {level: 3, name: 'smoke check'})).toBeInTheDocument();
  });

  test('heads a server-minted context with its job instead of the routing key', async () => {
    // The server keys failure annotations by step id. That is a routing key, not a name a reader
    // chose, so the job answers "what is this" and the key never reaches the heading.
    renderList([annotation({id: 'a1', context: `failure:step:${BUILD_STEP_ID}`})]);

    expect(await screen.findByRole('heading', {level: 3, name: 'build'})).toBeInTheDocument();
    expect(screen.queryByText(`failure:step:${BUILD_STEP_ID}`)).not.toBeInTheDocument();
  });

  test('heads the other minted context family the same way', async () => {
    renderList([annotation({id: 'a1', context: `agent-tool-capability:${BUILD_STEP_ID}`})]);

    expect(await screen.findByRole('heading', {level: 3, name: 'build'})).toBeInTheDocument();
  });

  test('heads the renewable Git context with the emitting job', async () => {
    renderList([annotation({id: 'a1', context: `renewable-git-capability:${BUILD_STEP_ID}`})]);

    expect(await screen.findByRole('heading', {level: 3, name: 'build'})).toBeInTheDocument();
  });

  test('announces annotations added after the initial snapshot once', async () => {
    let updateEntries: (entries: RunAnnotationRecord[]) => void = () => undefined;
    function Harness() {
      const [entries, setEntries] = useState([annotation({id: 'a1', sequence: 1})]);
      updateEntries = setEntries;
      return renderListElement(entries);
    }

    renderWithRouter(<Harness />);
    await screen.findByRole('heading', {level: 3, name: 'default'});

    act(() => {
      updateEntries([annotation({id: 'a1', sequence: 1}), annotation({id: 'a2', sequence: 2})]);
    });

    expect(await screen.findByText('A new annotation was added to this run.')).toBeInTheDocument();
  });

  test('leaves a step-chosen context that only looks minted as the heading', async () => {
    // `context` is caller-chosen with no reserved namespace, so matching the server's keys by
    // prefix would silently retitle a step's own annotation and hide the name it picked.
    renderList([annotation({id: 'a1', context: 'failure:step: see the runbook'})]);

    expect(
      await screen.findByRole('heading', {level: 3, name: 'failure:step: see the runbook'}),
    ).toBeInTheDocument();
  });

  test('uses the server-provided job name even when the overview does not contain the job', async () => {
    renderList([
      annotation({id: 'a1', context: `failure:step:${BUILD_STEP_ID}`, jobId: MISSING_JOB_ID}),
    ]);

    expect(
      await screen.findByRole('heading', {level: 3, name: 'archived job'}),
    ).toBeInTheDocument();
    expect(screen.queryByText(`failure:step:${BUILD_STEP_ID}`)).not.toBeInTheDocument();
  });

  test('drops the job from provenance when the job is already the heading', async () => {
    renderList([annotation({id: 'a1', context: `failure:step:${BUILD_STEP_ID}`})]);

    expect(await screen.findByText('run smoke checks · attempt 1')).toBeInTheDocument();
  });

  test('keeps the job in provenance when the step named the block', async () => {
    renderList([annotation({id: 'a1', context: 'smoke check'})]);

    expect(await screen.findByText('build · run smoke checks · attempt 1')).toBeInTheDocument();
  });

  test('leads with a job that never created an execution', async () => {
    // It is the most upstream thing in the run and has no step to link to, so it must not trail
    // behind a render window that could bury it.
    renderList([annotation({id: 'a1', context: 'smoke check'})], {
      derivedAnnotations: [derived({id: 'd1', jobName: 'deploy production'})],
    });

    await screen.findByText('no execution recorded');
    const headings = screen.getAllByRole('heading', {level: 3});

    expect(headings.map((heading) => heading.textContent)).toEqual([
      'deploy production',
      'smoke check',
    ]);
  });

  test('counts a derived row in the total the render window reports', async () => {
    const entries = Array.from({length: 26}, (_unused, index) =>
      annotation({
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
        context: `context-${index}`,
        sequence: index + 1,
      }),
    );

    renderList(entries, {derivedAnnotations: [derived({id: 'd1', jobName: 'deploy production'})]});

    expect(await screen.findByRole('button', {name: SHOW_MORE_PATTERN})).toHaveTextContent(
      'Show 2 more of 27',
    );
  });

  test('links a row back to the step that emitted it', async () => {
    renderList([annotation({id: 'a1', context: 'smoke check'})]);

    const row = (await screen.findByRole('heading', {level: 3, name: 'smoke check'})).closest('li');

    expect(within(row as HTMLElement).getByRole('link', {name: OPEN_STEP_PATTERN})).toHaveAttribute(
      'href',
      expect.stringContaining(`/runs/${RUN_ID}/jobs/${BUILD_JOB_ID}`),
    );
  });

  test('offers no step link when the run no longer contains the emitting step', async () => {
    renderList([annotation({id: 'a1', context: 'smoke check', jobId: MISSING_JOB_ID})]);

    await screen.findByRole('heading', {level: 3, name: 'smoke check'});
    expect(screen.queryByRole('link', {name: OPEN_STEP_PATTERN})).not.toBeInTheDocument();
  });

  test('keeps loaded annotations visible when job explanations fail', async () => {
    renderList([annotation({id: 'a1', context: 'smoke check'})], {
      jobExplanationsQuery: listQuery({isError: true, error: new Error('Unavailable')}),
    });

    expect(await screen.findByRole('heading', {level: 3, name: 'smoke check'})).toBeInTheDocument();
    expect(screen.getByText('Could not load job explanations.')).toBeInTheDocument();
    expect(screen.queryByText('This run has no annotations to show.')).not.toBeInTheDocument();
  });
});

function renderList(
  annotations: RunAnnotationRecord[],
  {
    derivedAnnotations,
    query = listQuery(),
    jobExplanationsQuery = listQuery(),
  }: {
    derivedAnnotations?: readonly DerivedRunAnnotation[] | undefined;
    query?: RunAnnotationListQuery;
    jobExplanationsQuery?: RunAnnotationListQuery;
  } = {},
) {
  return renderWithRouter(
    renderListElement(annotations, {derivedAnnotations, query, jobExplanationsQuery}),
  );
}

function renderListElement(
  annotations: RunAnnotationRecord[],
  {
    derivedAnnotations,
    query = listQuery(),
    jobExplanationsQuery = listQuery(),
  }: {
    derivedAnnotations?: readonly DerivedRunAnnotation[] | undefined;
    query?: RunAnnotationListQuery;
    jobExplanationsQuery?: RunAnnotationListQuery;
  } = {},
) {
  return (
    <RunAnnotationList
      query={query}
      jobExplanationsQuery={jobExplanationsQuery}
      entries={buildRunAnnotationList({entries: annotations.map(annotationEntry)})}
      derivedAnnotations={derivedAnnotations}
      workspaceSlug="acme"
      projectSlug="platform"
      workflowRunId={RUN_ID}
      runAttempt={1}
      filtered={false}
    />
  );
}

function listQuery(overrides: Partial<RunAnnotationListQuery> = {}): RunAnnotationListQuery {
  return {
    isPending: false,
    isError: false,
    isFetching: false,
    data: {pages: []},
    error: null,
    refetch: () => undefined,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => undefined,
    ...overrides,
  };
}

function annotation(overrides: Partial<RunAnnotationRecord> & {id: string}): RunAnnotationRecord {
  return {
    jobId: BUILD_JOB_ID,
    jobExecutionId: BUILD_EXECUTION_ID,
    originStepId: BUILD_STEP_ID,
    originStepAttempt: 1,
    context: 'default',
    style: 'error' as RunAnnotationStyle,
    sequence: 1,
    body: 'Body',
    ...overrides,
  };
}

function derived(overrides: Partial<DerivedRunAnnotation> & {id: string}): DerivedRunAnnotation {
  return {
    jobId: '44444444-4444-4444-8444-00000000000d',
    jobPosition: 1,
    style: 'warning',
    jobName: 'deploy production',
    body: 'Skipped before an execution was created.',
    ...overrides,
  };
}

function annotationEntry(annotation: RunAnnotationRecord): RunAnnotationEntry {
  const missingJob = annotation.jobId === MISSING_JOB_ID;
  return {
    annotation,
    jobName: missingJob ? 'archived job' : 'build',
    jobPosition: missingJob ? 1 : 0,
    executionSequence: 1,
    executionLabel: null,
    stepLabel: 'run smoke checks',
    attemptLabel: 'attempt 1',
    origin: missingJob
      ? null
      : {
          jobId: annotation.jobId,
          jobExecutionId: annotation.jobExecutionId,
          stepId: annotation.originStepId,
          stepAttemptId: BUILD_ATTEMPT_ID,
        },
  };
}
