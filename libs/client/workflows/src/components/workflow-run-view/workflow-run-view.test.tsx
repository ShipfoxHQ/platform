import type {AnnotationDto} from '@shipfox/annotations-dto';
import type {
  WorkflowRunAnnotationItemDto,
  WorkflowRunDetailResponseDto,
  WorkflowRunJobExplanationDto,
} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunDetailDto,
  workflowRunOverviewResponseDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {jsonResponse, PROJECT_TEST_WSLUG, renderProjectPage} from '#test/pages.js';
import {WorkflowRunView} from './workflow-run-view.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const BUILD_JOB_ID = '77777777-7777-4777-8777-777777777777';
const DEPLOY_JOB_ID = '88888888-8888-4888-8888-888888888888';
const ARCHIVED_JOB_ID = '88888888-8888-4888-8888-000000000003';
const BUILD_EXECUTION_ID = '99999999-9999-4999-8999-000000000001';
const BUILD_STEP_ID = '55555555-5555-4555-8555-000000000001';
const BUILD_ATTEMPT_ID = '66666666-6666-4666-8666-000000000001';
const ANNOTATION_ID_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const ANNOTATION_ID_TWO = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const TASK_NINE_PATTERN = /Task nine/;
const SHOW_MORE_PATTERN = /Show \d+ more/;
const CONDITION_REJECTED_PATTERN = /condition_rejected/;

describe('WorkflowRunView', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  test('reserves the shared run workspace while the run is loading', async () => {
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    renderView();

    expect(await screen.findByRole('region', {name: 'Loading workflow run'})).toBeInTheDocument();
    expect(screen.getByLabelText('Loading run navigation')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Loading workflow run content'})).toBeInTheDocument();
    expect(screen.queryByRole('tab', {name: 'Jobs'})).not.toBeInTheDocument();
  });

  test('opens the all-jobs Summary on the dependency graph by default', async () => {
    configureRunFetch();

    const {container} = renderView();

    const summary = await screen.findByRole('region', {name: 'deploy-web'});
    expect(within(summary).getByRole('heading', {name: 'deploy-web'})).toBeInTheDocument();
    expect(screen.getByRole('navigation', {name: 'Run workspace'})).toBeInTheDocument();
    const workspaceLayout = screen
      .getByRole('navigation', {name: 'Run workspace'})
      .closest('[data-run-workspace-layout]');
    expect(workspaceLayout).toHaveClass('border-t', 'border-border-neutral-base');
    expect(workspaceLayout).not.toHaveClass('max-w-[1360px]');
    const workspaceFrame = workspaceLayout?.querySelector('[data-run-workspace-frame]');
    expect(workspaceFrame).toHaveClass('w-full', 'min-[768px]:flex-row');
    expect(workspaceFrame).not.toHaveClass('mx-auto', 'max-w-[calc(240px_+_1120px)]');
    expect(screen.getByRole('link', {name: 'Summary'})).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', {name: 'Jobs'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Run details'})).toBeInTheDocument();
    const allJobsSummary = screen.getByRole('region', {name: 'All jobs summary'});
    expect(allJobsSummary).toBeInTheDocument();
    expect(allJobsSummary.querySelector('[data-slot="panel"]')).not.toBeNull();
    expect(allJobsSummary.querySelector('[data-slot="panel-body"]')).toHaveClass(
      'bg-background-components-base',
    );
    expect(screen.getByRole('region', {name: 'Workflow jobs'})).toBeInTheDocument();
    expect(container.querySelector('[data-run-workspace-content]')).toHaveClass('flex-1');
    expect(container.querySelector('[data-run-workspace-content]')).not.toHaveClass(
      'bg-background-neutral-base',
    );
    expect(screen.queryByRole('tab', {name: 'Jobs'})).not.toBeInTheDocument();
  });

  test.each([
    {tab: undefined, region: 'All jobs summary'},
    {tab: 'source', region: 'Workflow source'},
    {tab: 'annotations', region: 'Run annotations'},
  ] as const)('does not cap the $region section at 1120px', async ({tab, region}) => {
    configureRunFetch();

    renderView({tab});

    const section = await screen.findByRole('region', {name: region});
    expect(section.firstElementChild).not.toHaveClass('mx-auto', 'px-frame', 'max-w-[1120px]');
    expect(section.querySelector('[data-slot="panel"]')).not.toBeNull();
  });

  test('keeps dedicated job content on the full-width data surface', async () => {
    configureRunFetch();

    renderView({jobContent: <div>Job logs</div>});

    const jobContent = await screen.findByText('Job logs');
    const workspaceFrame = jobContent.closest('[data-run-workspace-frame]');

    expect(workspaceFrame).toHaveClass('w-full', 'min-[768px]:flex-row');
    expect(workspaceFrame).not.toHaveClass('max-w-[calc(240px_+_1120px)]');
  });

  test('treats the removed Jobs tab URL as the graph Summary', async () => {
    configureRunFetch();

    renderView({tab: 'jobs'});

    expect(await screen.findByRole('region', {name: 'All jobs summary'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Summary'})).toHaveAttribute('aria-current', 'page');
  });

  test('navigates graph and rail jobs to their dedicated job routes', async () => {
    const user = userEvent.setup();
    configureRunFetch();

    const {router} = renderView();
    await user.click(await screen.findByRole('button', {name: 'deploy, Running'}));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${RUN_ID}/jobs/${DEPLOY_JOB_ID}`,
      ),
    );
  });

  test('keeps run Annotations and Source in the workspace navigation', async () => {
    const user = userEvent.setup();
    configureRunFetch();

    const {router} = renderView();
    await screen.findByRole('region', {name: 'Workflow jobs'});
    await user.click(screen.getByRole('link', {name: 'Annotations'}));

    await waitFor(() => expect(router.state.location.search).toMatchObject({tab: 'annotations'}));
  });

  test('filters the single run-level Annotations page by job', async () => {
    configureRunFetch();

    renderView({tab: 'annotations', selection: {jobId: BUILD_JOB_ID}});

    expect(
      await screen.findByRole('combobox', {name: 'Filter annotations by job'}),
    ).toHaveTextContent('build');
    expect(await screen.findByText('This run has no annotations to show.')).toBeInTheDocument();
    expect(screen.queryByRole('tab', {name: 'Annotations'})).not.toBeInTheDocument();
  });

  test('renders annotation bodies once, severity first, with provenance', async () => {
    configureRunFetch([
      annotationDto({id: ANNOTATION_ID_ONE, context: 'coverage', style: 'info', sequence: 1}),
      annotationDto({
        id: ANNOTATION_ID_TWO,
        context: 'smoke check',
        style: 'error',
        sequence: 2,
        body: 'Task nine **failed**.',
      }),
    ]);

    renderView({tab: 'annotations'});

    const headings = await screen.findAllByRole('heading', {level: 3});
    expect(headings.map((heading) => heading.textContent)).toEqual(['smoke check', 'coverage']);
    expect(screen.getByText(TASK_NINE_PATTERN)).toBeInTheDocument();
    expect(screen.getAllByText('build · checkout · attempt 1')).toHaveLength(2);
    expect(screen.getByText('2 annotations')).toBeInTheDocument();
  });

  test('links an annotation back to the step that emitted it', async () => {
    configureRunFetch([annotationDto({id: ANNOTATION_ID_ONE, context: 'coverage'})]);

    renderView({tab: 'annotations'});

    const href = (await screen.findByRole('link', {name: 'Open step'})).getAttribute('href') ?? '';
    const [pathname, query = ''] = href.split('?');

    expect(pathname).toBe(`/w/${PROJECT_TEST_WSLUG}/p/project/runs/${RUN_ID}/jobs/${BUILD_JOB_ID}`);
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      jobExecution: BUILD_EXECUTION_ID,
      step: BUILD_STEP_ID,
      stepAttempt: BUILD_ATTEMPT_ID,
      runAttempt: '"1"',
    });
  });

  test('shows a failed annotations read as an error, never as an empty run', async () => {
    const user = userEvent.setup();
    const detail = workflowRunViewDetailDto();
    configureApiClient({
      fetchImpl: vi.fn((input: RequestInfo | URL) => {
        const path = new URL(requestUrl(input), 'https://api.example.test').pathname;
        if (path === `/workflows/runs/${RUN_ID}/annotations`) {
          return Promise.resolve(jsonResponse({code: 'internal'}, {status: 500}));
        }
        if (path === '/annotations/summary') {
          return Promise.resolve(
            jsonResponse({
              total: 3,
              error: 2,
              warning: 1,
              info: 0,
              success: 0,
              step_counts: [],
            }),
          );
        }
        return Promise.resolve(jsonResponse(runResourceResponse(path, detail)));
      }),
    });

    renderView({tab: 'annotations'});

    expect(await screen.findByText('Could not load annotations.')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Retry loading annotations'})).toBeVisible();
    expect(screen.getByText('3 annotations')).toBeVisible();
    await user.click(screen.getByRole('combobox', {name: 'Filter annotations by job'}));
    expect(await screen.findByRole('option', {name: 'build'})).toBeInTheDocument();
    expect(screen.getByRole('option', {name: 'deploy'})).toBeInTheDocument();
    expect(screen.queryByText('This run has no annotations to show.')).not.toBeInTheDocument();
  });

  test('renders server-owned explanations for jobs that never created an execution', async () => {
    configureRunFetch([], {}, {}, [
      {
        job_id: DEPLOY_JOB_ID,
        job_label: 'deploy',
        job_position: 1,
        status: 'skipped',
        status_reason: 'condition_rejected',
        evaluation_trace: null,
      },
    ]);

    renderView({tab: 'annotations'});

    expect(await screen.findByRole('heading', {level: 3, name: 'deploy'})).toBeInTheDocument();
    const explanation = (await screen.findByRole('heading', {level: 3, name: 'deploy'})).closest(
      'li',
    );
    expect(explanation).toHaveTextContent('Skipped before an execution was created.');
    expect(explanation).toHaveTextContent(CONDITION_REJECTED_PATTERN);
  });

  test('filters to a job that exists only in job explanations', async () => {
    configureRunFetch([], {}, {}, [
      {
        job_id: ARCHIVED_JOB_ID,
        job_label: 'archived deploy',
        job_position: 3,
        status: 'skipped',
        status_reason: 'condition_rejected',
        evaluation_trace: null,
      },
    ]);

    renderView({tab: 'annotations', selection: {jobId: ARCHIVED_JOB_ID}});

    expect(
      await screen.findByRole('combobox', {name: 'Filter annotations by job'}),
    ).toHaveTextContent('archived deploy');
    const explanation = await screen.findByRole('heading', {
      level: 3,
      name: 'archived deploy',
    });
    expect(explanation.closest('li')).toHaveTextContent('Skipped before an execution was created.');
  });

  test('loads the next job-explanation page from the shared control', async () => {
    const user = userEvent.setup();
    const fetchImpl = configureRunFetch([], {}, {}, [], {
      cursor: 'jobs-page-2',
      items: [
        {
          job_id: ARCHIVED_JOB_ID,
          job_label: 'archived deploy',
          job_position: 3,
          status: 'failed',
          status_reason: 'unknown',
          evaluation_trace: null,
        },
      ],
    });

    renderView({tab: 'annotations'});
    await user.click(await screen.findByRole('button', {name: 'Load more annotations'}));

    expect(
      await screen.findByRole('heading', {level: 3, name: 'archived deploy'}),
    ).toBeInTheDocument();
    expect(
      requestUrls(fetchImpl).some(
        (url) =>
          url.pathname === `/workflows/runs/${RUN_ID}/job-explanations` &&
          url.searchParams.get('cursor') === 'jobs-page-2',
      ),
    ).toBe(true);
  });

  test('opens annotations without loading the legacy full run tree', async () => {
    const fetchImpl = configureRunFetch([
      annotationDto({id: ANNOTATION_ID_ONE, context: 'coverage'}),
    ]);

    renderView({tab: 'annotations'});

    await screen.findByRole('heading', {level: 3, name: 'coverage'});
    expect(
      fetchImpl.mock.calls.some(([input]) => {
        const url = new URL(requestUrl(input as RequestInfo | URL), 'https://api.example.test');
        return url.pathname === `/workflows/runs/${RUN_ID}`;
      }),
    ).toBe(false);
  });

  test('bounds how many annotation bodies render at once', async () => {
    configureRunFetch(
      Array.from({length: 30}, (_unused, index) =>
        annotationDto({
          id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
          context: `context-${index}`,
          sequence: index + 1,
        }),
      ),
    );

    renderView({tab: 'annotations'});

    expect(await screen.findAllByRole('heading', {level: 3})).toHaveLength(25);
    const showMore = screen.getByRole('button', {name: 'Show 5 more of 30'});

    await userEvent.click(showMore);

    expect(screen.getAllByRole('heading', {level: 3})).toHaveLength(30);
    expect(screen.queryByRole('button', {name: SHOW_MORE_PATTERN})).not.toBeInTheDocument();
  });

  test('separates a filtered miss from a run with no annotations', async () => {
    configureRunFetch([annotationDto({id: ANNOTATION_ID_ONE, context: 'coverage', style: 'info'})]);

    renderView({tab: 'annotations', selection: {severity: 'error'}});

    expect(await screen.findByText('No matching annotations')).toBeInTheDocument();
    expect(
      screen.getByText('This run has annotations, but none at error severity.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Clear filters'})).toBeInTheDocument();
  });

  test('does not claim a filtered miss beyond the loaded annotation budget', async () => {
    configureRunFetch(
      [annotationDto({id: ANNOTATION_ID_ONE, context: 'coverage', style: 'info'})],
      {},
      {next_cursor: 'next-page'},
    );

    renderView({tab: 'annotations', selection: {severity: 'error'}});

    expect(await screen.findByText('No matches in loaded annotations')).toBeInTheDocument();
    expect(
      screen.getByText(
        'None of the loaded annotations are at error severity. Load more annotations to continue searching.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Load more annotations'})).toBeInTheDocument();
    expect(screen.queryByText('No matching annotations')).not.toBeInTheDocument();
  });

  test('clears annotation filters and legacy step selection together', async () => {
    const user = userEvent.setup();
    configureRunFetch([annotationDto({id: ANNOTATION_ID_ONE, context: 'coverage', style: 'info'})]);

    const {router} = renderView({
      tab: 'annotations',
      selection: {
        jobId: DEPLOY_JOB_ID,
        jobExecutionId: BUILD_EXECUTION_ID,
        stepId: BUILD_STEP_ID,
        stepAttemptId: BUILD_ATTEMPT_ID,
        severity: 'error',
      },
    });

    await user.click(await screen.findByRole('button', {name: 'Clear filters'}));

    await waitFor(() => expect(router.state.location.search).toEqual({tab: 'annotations'}));
  });

  test('blames only the filters that are actually active', async () => {
    // The annotation belongs to build, so filtering to deploy is a job-only miss. Naming
    // severity here would send the reader to change a control they never touched.
    configureRunFetch([annotationDto({id: ANNOTATION_ID_ONE, context: 'coverage', style: 'info'})]);

    renderView({tab: 'annotations', selection: {jobId: DEPLOY_JOB_ID}});

    expect(
      await screen.findByText('This run has annotations, but none from deploy.'),
    ).toBeInTheDocument();
  });

  test('renders the captured workflow source in the Source section', async () => {
    const detail = workflowRunViewDetailDto({
      source_snapshot: {format: 'yaml', content: 'jobs:\n  build:\n    steps: []'},
    });
    configureApiClient({
      fetchImpl: vi.fn((input: RequestInfo | URL) => {
        const path = new URL(requestUrl(input), 'https://api.example.test').pathname;
        return Promise.resolve(
          jsonResponse(
            path === `/workflows/runs/${RUN_ID}/source`
              ? {
                  kind: 'available',
                  workflow_run_id: RUN_ID,
                  workflow_run_attempt: detail.run_attempt.attempt,
                  source_snapshot: detail.source_snapshot,
                }
              : runResourceResponse(path, detail),
          ),
        );
      }),
    });

    renderView({tab: 'source'});

    expect(await screen.findByText('build:')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Source'})).toHaveAttribute('aria-current', 'page');
  });

  test('explains when the run has no source snapshot', async () => {
    configureRunFetch();

    renderView({tab: 'source'});

    expect(await screen.findByText('Source snapshot unavailable')).toBeInTheDocument();
  });

  test('shows the not-found surface when the run 404s', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}))),
    });

    renderView();

    expect(await screen.findByText('Run not found')).toBeInTheDocument();
  });
});

function renderView(props: Partial<Parameters<typeof WorkflowRunView>[0]> = {}) {
  return renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/p/project/runs/${RUN_ID}`, () => (
    <WorkflowRunView
      projectId={PROJECT_ID}
      workspaceSlug={PROJECT_TEST_WSLUG}
      projectSlug="project"
      workflowRunId={RUN_ID}
      {...props}
    />
  ));
}

/** The API client hands `fetchImpl` a `Request`, whose URL only `.url` exposes. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** Routes the independently loaded run workspace resources. */
function configureRunFetch(
  annotations: AnnotationDto[] = [],
  runOverrides: Partial<WorkflowRunDetailResponseDto> = {},
  annotationPageOverrides: Partial<{next_cursor: string | null}> = {},
  explanations: WorkflowRunJobExplanationDto[] = [],
  nextExplanationPage?: {cursor: string; items: WorkflowRunJobExplanationDto[]} | undefined,
) {
  const fetchImpl = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestUrl(input), 'https://api.example.test');
    const path = url.pathname;
    const detail = workflowRunViewDetailDto(runOverrides);
    if (path === `/workflows/runs/${RUN_ID}/annotations`) {
      return Promise.resolve(
        jsonResponse({
          items: annotations.map(annotationItemDto),
          next_cursor: null,
          ...annotationPageOverrides,
        }),
      );
    }
    if (path === `/workflows/runs/${RUN_ID}/job-explanations`) {
      return Promise.resolve(
        jsonResponse(jobExplanationsPage(url, explanations, nextExplanationPage)),
      );
    }
    if (path === '/annotations/summary') {
      return Promise.resolve(jsonResponse(annotationSummaryDto(annotations)));
    }
    if (path === `/workflows/runs/${RUN_ID}/source`) {
      return Promise.resolve(
        jsonResponse(
          detail.source_snapshot
            ? {
                kind: 'available',
                workflow_run_id: RUN_ID,
                workflow_run_attempt: detail.run_attempt.attempt,
                source_snapshot: detail.source_snapshot,
              }
            : {
                kind: 'unavailable',
                workflow_run_id: RUN_ID,
                workflow_run_attempt: detail.run_attempt.attempt,
                reason: detail.origin === 'dev' ? 'temporary_run' : 'pre_snapshot_run',
              },
        ),
      );
    }
    return Promise.resolve(jsonResponse(runResourceResponse(path, detail)));
  });
  configureApiClient({
    fetchImpl,
  });
  return fetchImpl;
}

function jobExplanationsPage(
  url: URL,
  firstPage: WorkflowRunJobExplanationDto[],
  nextPage: {cursor: string; items: WorkflowRunJobExplanationDto[]} | undefined,
) {
  if (nextPage && url.searchParams.get('cursor') === nextPage.cursor) {
    return {items: nextPage.items, next_cursor: null};
  }
  return {items: firstPage, next_cursor: nextPage?.cursor ?? null};
}

function requestUrls(fetchImpl: ReturnType<typeof vi.fn>): URL[] {
  return fetchImpl.mock.calls.map(
    ([input]) => new URL(requestUrl(input as RequestInfo | URL), 'https://api.example.test'),
  );
}

function annotationDto(overrides: Partial<AnnotationDto> & {id: string}): AnnotationDto {
  return {
    job_id: BUILD_JOB_ID,
    job_execution_id: BUILD_EXECUTION_ID,
    origin_step_id: BUILD_STEP_ID,
    origin_step_attempt: 1,
    context: 'default',
    style: 'default',
    sequence: 1,
    body: 'Body',
    ...overrides,
  };
}

function annotationItemDto(annotation: AnnotationDto): WorkflowRunAnnotationItemDto {
  return {
    annotation,
    origin: {
      job_id: annotation.job_id,
      job_label: 'build',
      job_position: 0,
      job_execution_id: annotation.job_execution_id,
      execution_sequence: 1,
      execution_label: null,
      step_id: annotation.origin_step_id,
      step_label: 'checkout',
      step_attempt_id: BUILD_ATTEMPT_ID,
      step_attempt: annotation.origin_step_attempt,
    },
  };
}

function annotationSummaryDto(annotations: readonly AnnotationDto[]) {
  return {
    total: annotations.length,
    error: annotations.filter(({style}) => style === 'error').length,
    warning: annotations.filter(({style}) => style === 'warning').length,
    info: annotations.filter(({style}) => style === 'info').length,
    success: annotations.filter(({style}) => style === 'success').length,
    step_counts: [],
  };
}

function runResourceResponse(path: string, detail: WorkflowRunDetailResponseDto) {
  if (path === `/workflows/runs/${RUN_ID}/head`) {
    return {
      current_attempt: detail.current_attempt,
      latest_attempt: detail.latest_attempt,
      current_status: detail.status,
      updated_at: detail.updated_at,
    };
  }
  if (path === `/workflows/runs/${RUN_ID}/overview`) {
    return workflowRunOverviewResponseDto(detail);
  }
  if (path === `/workflows/runs/${RUN_ID}/job-explanations`) {
    return {items: [], next_cursor: null};
  }
  if (path === '/annotations/summary') return annotationSummaryDto([]);
  return detail;
}

function workflowRunViewDetailDto(
  overrides: Partial<WorkflowRunDetailResponseDto> = {},
): WorkflowRunDetailResponseDto {
  return workflowRunDetailDto({
    id: RUN_ID,
    project_id: PROJECT_ID,
    name: 'deploy-web',
    status: 'running',
    trigger_payload: {},
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    jobs: [
      workflowJobDto({
        id: BUILD_JOB_ID,
        run_attempt_id: RUN_ID,
        name: 'build',
        status: 'succeeded',
        job_executions: [
          workflowJobExecutionDto({
            id: BUILD_EXECUTION_ID,
            job_id: BUILD_JOB_ID,
            status: 'succeeded',
            steps: [
              workflowStepDto({
                id: BUILD_STEP_ID,
                name: 'checkout',
                status: 'succeeded',
                attempts: [
                  workflowStepAttemptDto({
                    id: BUILD_ATTEMPT_ID,
                    step_id: BUILD_STEP_ID,
                    attempt: 1,
                    status: 'succeeded',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      workflowJobDto({
        id: DEPLOY_JOB_ID,
        run_attempt_id: RUN_ID,
        name: 'deploy',
        status: 'running',
        position: 1,
        dependencies: ['build'],
        job_executions: [
          workflowJobExecutionDto({
            job_id: DEPLOY_JOB_ID,
            status: 'running',
            steps: [workflowStepDto({name: 'deploy', status: 'running'})],
          }),
        ],
      }),
    ],
    ...overrides,
  });
}
