import type {AnnotationDto} from '@shipfox/annotations-dto';
import type {WorkflowRunDetailResponseDto} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunDetailDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {jsonResponse, PROJECT_TEST_WSLUG, renderProjectPage} from '#test/pages.js';
import {WorkflowRunView} from './workflow-run-view.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const BUILD_JOB_ID = '77777777-7777-4777-8777-777777777777';
const DEPLOY_JOB_ID = '88888888-8888-4888-8888-888888888888';
const BUILD_EXECUTION_ID = '99999999-9999-4999-8999-000000000001';
const BUILD_STEP_ID = '55555555-5555-4555-8555-000000000001';
const BUILD_ATTEMPT_ID = '66666666-6666-4666-8666-000000000001';
const ANNOTATION_ID_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const ANNOTATION_ID_TWO = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const TASK_NINE_PATTERN = /Task nine/;
const SHOW_MORE_PATTERN = /Show \d+ more/;

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
    expect(
      screen
        .getByRole('navigation', {name: 'Run workspace'})
        .closest('[data-run-workspace-layout]'),
    ).toHaveClass('border-t', 'border-border-neutral-base', 'min-[768px]:flex-row');
    expect(screen.getByRole('link', {name: 'Summary'})).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', {name: 'Jobs'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Run details'})).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'All jobs summary'})).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Workflow jobs'})).toBeInTheDocument();
    expect(container.querySelector('[data-run-workspace-content]')).toHaveClass(
      'bg-background-neutral-base',
      'flex-1',
    );
    expect(screen.queryByRole('tab', {name: 'Jobs'})).not.toBeInTheDocument();
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
    configureApiClient({
      fetchImpl: vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          requestUrl(input).includes('/annotations')
            ? jsonResponse({code: 'internal'}, {status: 500})
            : jsonResponse(workflowRunViewDetailDto()),
        ),
      ),
    });

    renderView({tab: 'annotations'});

    expect(await screen.findByRole('button', {name: 'Retry loading annotations'})).toBeVisible();
    expect(screen.queryByText('This run has no annotations to show.')).not.toBeInTheDocument();
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

  test('focuses a deep-linked annotation beyond the render window', async () => {
    const deepLinkedId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000029';
    configureRunFetch(
      Array.from({length: 30}, (_unused, index) =>
        annotationDto({
          id:
            index === 29
              ? deepLinkedId
              : `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
          context: `context-${index}`,
          sequence: index + 1,
        }),
      ),
    );

    renderView({tab: 'annotations', selection: {annotation: deepLinkedId}});

    const target = await screen.findByRole('heading', {level: 3, name: 'context-29'});
    await waitFor(() => expect(target.closest('li')).toHaveFocus());
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
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              source_snapshot: {format: 'yaml', content: 'jobs:\n  build:\n    steps: []'},
            }),
          ),
        ),
      ),
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

/** Routes the run detail and the annotations read, which are two independent fetches. */
function configureRunFetch(
  annotations: AnnotationDto[] = [],
  runOverrides: Partial<WorkflowRunDetailResponseDto> = {},
) {
  configureApiClient({
    fetchImpl: vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        requestUrl(input).includes('/annotations')
          ? jsonResponse({annotations, has_more: false, next_cursor: null})
          : jsonResponse(workflowRunViewDetailDto(runOverrides)),
      ),
    ),
  });
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
        steps: [workflowStepDto({name: 'deploy', status: 'running'})],
      }),
    ],
    ...overrides,
  });
}
