import {configureApiClient} from '@shipfox/client-api';
import {act, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {workflowRunsQueryKeys} from '#hooks/api/workflow-runs.js';
import type {WorkflowJobSearch, WorkflowRunsSearch} from '#routes/inputs.js';
import {
  runAttemptsResponseDto,
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunAttemptDto,
  workflowRunDetailDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {jsonResponse, PROJECT_TEST_WSLUG, renderProjectPage} from '#test/pages.js';
import {WorkflowJobDetailPage} from './workflow-job-detail-page.js';
import {WorkflowRunDetailPage} from './workflow-run-detail-page.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const JOB_ID = '88888888-8888-4888-8888-888888888888';
const EXECUTION_ID = '77777777-7777-4777-8777-777777777777';
const STEP_ID = '99999999-9999-4999-8999-999999999999';
const ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LIVE_JOB_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LIVE_EXECUTION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LIVE_BUILD_STEP_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LIVE_DEPLOY_STEP_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const LIVE_BUILD_ATTEMPT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const LIVE_DEPLOY_ATTEMPT_ID = '11111111-2222-4333-8444-555555555555';
const NEWER_JOB_ID = '22222222-3333-4444-8555-666666666666';
const SIBLING_JOB_ID = '33333333-4444-4555-8666-777777777777';
const BACK_TO_SUMMARY_PATTERN = /Back to run summary/;
const RUN_MOVED_ON_PATTERN = /Run moved on to/;
const LINT_LINK_PATTERN = /lint/;
const RELEASE_LINK_PATTERN = /release/;
const ANNOTATION_LINK_PATTERN = /annotation/;
const ANNOTATIONS_LINK_PATTERN = /Annotations/;

describe('WorkflowJobDetailPage', () => {
  beforeEach(() => {
    jobAnnotations.value = [];
  });

  test('links the job to its annotations without rendering one', async () => {
    jobAnnotations.value = [
      {
        id: 'aaaaaaaa-1111-4aaa-8aaa-000000000001',
        job_id: JOB_ID,
        job_execution_id: EXECUTION_ID,
        origin_step_id: STEP_ID,
        origin_step_attempt: 2,
        context: 'smoke check',
        style: 'error',
        sequence: 1,
        body: 'Task nine failed.',
      },
      {
        id: 'aaaaaaaa-1111-4aaa-8aaa-000000000002',
        job_id: SIBLING_JOB_ID,
        job_execution_id: EXECUTION_ID,
        origin_step_id: STEP_ID,
        origin_step_attempt: 1,
        context: 'other job',
        style: 'info',
        sequence: 2,
        body: 'Not this job.',
      },
    ];
    configureApiClient({fetchImpl: vi.fn(jobDetailFetch)});

    renderJobPath(`?jobExecution=${EXECUTION_ID}&runAttempt=1`);

    const chip = await screen.findByRole('link', {
      name: 'View 1 annotation, highest severity error',
    });
    expect(chip.getAttribute('href')).toContain(`tab=annotations`);
    expect(chip.getAttribute('href')).toContain(`job=${JOB_ID}`);
    expect(screen.queryByText('Task nine failed.')).not.toBeInTheDocument();
  });

  test('omits the annotation chip when the job produced none', async () => {
    configureApiClient({fetchImpl: vi.fn(jobDetailFetch)});

    renderJobPath(`?jobExecution=${EXECUTION_ID}&runAttempt=1`);

    await screen.findByRole('heading', {name: 'release'});
    expect(screen.queryByRole('link', {name: ANNOTATION_LINK_PATTERN})).not.toBeInTheDocument();
  });

  test('resolves an exact job execution and step attempt from a deep link', async () => {
    configureApiClient({fetchImpl: vi.fn(jobDetailFetch)});

    renderJobPath(
      `?jobExecution=${EXECUTION_ID}&step=${STEP_ID}&stepAttempt=${ATTEMPT_ID}&runAttempt=1`,
    );

    expect(await screen.findByRole('heading', {name: 'release'})).toHaveFocus();
    expect(
      screen.getByRole('button', {
        name: 'Switch job execution, currently execution 2: release',
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('region', {name: 'tests output, attempt 2'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'release logs'})).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByRole('img', {name: 'Job status: Succeeded'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'deploy-web'})).toBeInTheDocument();
    expect(screen.getByRole('navigation', {name: 'Run workspace'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Summary'})).toHaveAttribute(
      'href',
      expect.stringContaining(`runs/${RUN_ID}?runAttempt=%221%22`),
    );
    expect(screen.getByRole('heading', {name: 'Jobs'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: RELEASE_LINK_PATTERN})).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('5s')).toBeInTheDocument();
    expect(screen.getAllByText('1m 10s')).not.toHaveLength(0);
  });

  test('shows a retarget notice when polling advances to the next running step', async () => {
    let detailRequestCount = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL((input as Request).url);
      if (url.pathname.includes('/logs')) {
        return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
      }
      detailRequestCount += 1;
      return Promise.resolve(
        jsonResponse(
          detailRequestCount === 1 ? liveInitialJobDetailDto() : liveAdvancedJobDetailDto(),
        ),
      );
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    const {queryClient} = renderJobPath('?runAttempt=1', LIVE_JOB_ID);
    expect(
      await screen.findByRole('region', {name: 'build output, attempt 1'}),
    ).toBeInTheDocument();

    await act(async () => {
      await queryClient.invalidateQueries({queryKey: workflowRunsQueryKeys.detail(RUN_ID, 1)});
    });

    expect(await screen.findByText(RUN_MOVED_ON_PATTERN)).toBeInTheDocument();
    expect(screen.getAllByText('deploy')).not.toHaveLength(0);
  });

  test('shows a retarget notice when polling advances the running attempt', async () => {
    let detailRequestCount = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL((input as Request).url);
      if (url.pathname.includes('/logs')) {
        return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
      }
      detailRequestCount += 1;
      return Promise.resolve(
        jsonResponse(
          detailRequestCount === 1
            ? liveRetriedInitialJobDetailDto()
            : liveRetriedAdvancedJobDetailDto(),
        ),
      );
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    const {queryClient} = renderJobPath('?runAttempt=1', LIVE_JOB_ID);
    expect(
      await screen.findByRole('region', {name: 'build output, attempt 1'}),
    ).toBeInTheDocument();

    await act(async () => {
      await queryClient.invalidateQueries({queryKey: workflowRunsQueryKeys.detail(RUN_ID, 1)});
    });

    expect(await screen.findByText(RUN_MOVED_ON_PATTERN)).toBeInTheDocument();
  });

  test('moves focus to the heading after navigating from the job rail', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(multiJobDetailDto()))),
    });

    renderJobPath();
    await screen.findByRole('heading', {name: 'release'});

    await user.click(screen.getByRole('link', {name: LINT_LINK_PATTERN}));

    expect(await screen.findByRole('heading', {name: 'lint'})).toHaveFocus();
  });

  test('shows a newer-attempt notice when the run has a newer attempt', async () => {
    configureApiClient({fetchImpl: vi.fn(newerAttemptJobDetailFetch)});

    renderJobPath();

    expect(await screen.findByText('A newer run attempt is available.')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'View attempt #2'})).toBeInTheDocument();
  });

  test('renders the job-not-found state for a job outside the run', async () => {
    configureApiClient({fetchImpl: vi.fn(jobDetailFetch)});

    renderJobPath('', 'missing-job');

    expect(await screen.findByText('Job not found')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: BACK_TO_SUMMARY_PATTERN})).toHaveAttribute(
      'href',
      expect.stringContaining(`runs/${RUN_ID}`),
    );
  });

  test('treats the removed job Annotations URL as the job log document', async () => {
    configureApiClient({fetchImpl: vi.fn(jobDetailFetch)});

    const {router} = renderJobPath('?runAttempt=1&tab=annotations');
    await screen.findByRole('heading', {name: 'release'});

    expect(router.state.location.pathname).toBe(
      `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${RUN_ID}/jobs/${JOB_ID}`,
    );
    expect(router.state.location.search).toEqual({runAttempt: 1, tab: 'annotations'});
    expect(screen.getByRole('region', {name: 'release logs'})).toBeInTheDocument();
    expect(screen.queryByText('This job has no annotations to show.')).not.toBeInTheDocument();
  });

  test('keeps the job navigation count run-scoped', async () => {
    jobAnnotations.value = Array.from({length: 5}, (_unused, index) => ({
      id: `aaaaaaaa-1111-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`,
      job_id: JOB_ID,
      job_execution_id: EXECUTION_ID,
      origin_step_id: STEP_ID,
      origin_step_attempt: 1,
      context: `annotation-${index + 1}`,
      style: 'error',
      sequence: index + 1,
      body: 'Body',
    }));
    const annotationRequests: URL[] = [];
    const summaryRequests: URL[] = [];
    configureApiClient({
      fetchImpl: vi.fn((input: RequestInfo | URL) => {
        const request = input as Request;
        const url = new URL(request.url);
        if (url.pathname.endsWith('/annotations')) {
          annotationRequests.push(url);
          return jobDetailFetch(input);
        }
        if (url.pathname.endsWith('/annotations/summary')) {
          summaryRequests.push(url);
          const executionScoped = url.searchParams.has('job_execution_id');
          return Promise.resolve(
            jsonResponse({
              total: executionScoped ? 2 : 5,
              error: executionScoped ? 2 : 5,
              warning: 0,
              info: 0,
              success: 0,
            }),
          );
        }
        return jobDetailFetch(input);
      }),
    });

    renderJobPath('?runAttempt=1');

    const annotationsLink = await screen.findByRole('link', {name: ANNOTATIONS_LINK_PATTERN});
    await waitFor(() => expect(annotationsLink).toHaveTextContent('5'));
    expect(annotationRequests.some((url) => !url.searchParams.has('job_execution_id'))).toBe(true);
    expect(
      summaryRequests.some((url) => url.searchParams.get('job_execution_id') === EXECUTION_ID),
    ).toBe(true);
  });

  test('explains a failure that happened before the first step started', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(failedBeforeStepsDetailDto()))),
    });

    renderJobPath();

    expect(await screen.findByText('Job failed before its first step started')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The runner stopped responding before work began. Check runner availability before re-running the workflow.',
      ),
    ).toBeInTheDocument();
  });

  test('browser back from the job page returns to the run page', async () => {
    configureApiClient({fetchImpl: vi.fn(jobDetailFetch)});

    const {router} = renderJobPath();
    await screen.findByRole('heading', {name: 'release'});
    await act(async () => {
      await router.navigate({
        to: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
        params: {
          workspaceSlug: PROJECT_TEST_WSLUG,
          projectSlug: 'project',
          workflowRunId: RUN_ID,
        },
      });
      await router.navigate({
        to: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId/jobs/$jobId',
        params: {
          workspaceSlug: PROJECT_TEST_WSLUG,
          projectSlug: 'project',
          workflowRunId: RUN_ID,
          jobId: JOB_ID,
        },
      });
      router.history.back();
    });

    expect(await screen.findByRole('region', {name: 'Workflow jobs'})).toBeInTheDocument();
  });
});

function renderJobPath(path = '', jobId = JOB_ID) {
  return renderProjectPage(
    `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${RUN_ID}/jobs/${jobId}${path}`,
    ({search, workflowRunId, jobId: routeJobId}) =>
      routeJobId ? (
        <WorkflowJobDetailPage
          projectId="44444444-4444-4444-8444-444444444444"
          workspaceSlug={PROJECT_TEST_WSLUG}
          projectSlug="project"
          workflowRunId={workflowRunId ?? RUN_ID}
          jobId={routeJobId}
          search={search as WorkflowJobSearch}
        />
      ) : (
        <WorkflowRunDetailPage
          projectId="44444444-4444-4444-8444-444444444444"
          workspaceSlug={PROJECT_TEST_WSLUG}
          projectSlug="project"
          workflowRunId={workflowRunId ?? RUN_ID}
          search={search as WorkflowRunsSearch}
        />
      ),
  );
}

/** Annotations for the job page, which renders their count and never their bodies. */
const jobAnnotations: {value: unknown[]} = {value: []};

function annotationsResponse() {
  return {annotations: jobAnnotations.value, has_more: false, next_cursor: null};
}

function jobDetailFetch(input: RequestInfo | URL) {
  const request = input as Request;
  const url = new URL(request.url);

  if (url.pathname.endsWith('/annotations')) {
    return Promise.resolve(jsonResponse(annotationsResponse()));
  }

  if (url.pathname.endsWith('/attempts')) {
    return Promise.resolve(
      jsonResponse(
        runAttemptsResponseDto({
          attempts: [
            workflowRunAttemptDto({
              workflow_run_id: RUN_ID,
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              status: 'succeeded',
            }),
          ],
        }),
      ),
    );
  }

  if (url.pathname.includes('/logs')) {
    return Promise.resolve(
      jsonResponse({
        mode: 'inline',
        ndjson: `${JSON.stringify({v: 1, ts: 1782043200000, type: 'output', stream: 'stdout', data: 'tests passed\\n'})}\\n`,
        next_cursor: 0,
        has_more: false,
        state: 'closed',
        truncated: false,
      }),
    );
  }

  return Promise.resolve(jsonResponse(jobDetailDto()));
}

function newerAttemptJobDetailFetch(input: RequestInfo | URL) {
  const request = input as Request;
  const url = new URL(request.url);

  if (url.pathname.endsWith('/annotations')) {
    return Promise.resolve(jsonResponse(annotationsResponse()));
  }

  if (url.pathname.endsWith('/attempts')) {
    return Promise.resolve(
      jsonResponse(
        runAttemptsResponseDto({
          attempts: [
            workflowRunAttemptDto({workflow_run_id: RUN_ID, attempt: 1, status: 'succeeded'}),
            workflowRunAttemptDto({workflow_run_id: RUN_ID, attempt: 2, status: 'succeeded'}),
          ],
        }),
      ),
    );
  }

  if (url.searchParams.get('attempt') === '2') {
    return Promise.resolve(
      jsonResponse(
        workflowRunDetailDto({
          id: RUN_ID,
          status: 'succeeded',
          latest_attempt: 2,
          current_attempt: 2,
          run_attempt: workflowRunAttemptDto({
            workflow_run_id: RUN_ID,
            attempt: 2,
            status: 'succeeded',
          }),
          jobs: [
            workflowJobDto({
              id: NEWER_JOB_ID,
              key: 'release',
              name: 'release',
              status: 'succeeded',
            }),
          ],
        }),
      ),
    );
  }

  return Promise.resolve(jsonResponse(jobDetailDto()));
}

function liveInitialJobDetailDto() {
  return liveJobDetailDto({buildStatus: 'running', deployStatus: 'pending'});
}

function liveAdvancedJobDetailDto() {
  return liveJobDetailDto({buildStatus: 'succeeded', deployStatus: 'running'});
}

function liveRetriedInitialJobDetailDto() {
  return liveJobDetailDto({
    buildStatus: 'running',
    deployStatus: 'pending',
    buildAttempt: 1,
    buildAttemptId: LIVE_BUILD_ATTEMPT_ID,
  });
}

function liveRetriedAdvancedJobDetailDto() {
  return liveJobDetailDto({
    buildStatus: 'running',
    deployStatus: 'pending',
    buildAttempt: 2,
    buildAttemptId: '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
}

function liveJobDetailDto({
  buildStatus,
  deployStatus,
  buildAttempt = 1,
  buildAttemptId = LIVE_BUILD_ATTEMPT_ID,
}: {
  buildStatus: 'running' | 'succeeded';
  deployStatus: 'pending' | 'running';
  buildAttempt?: number;
  buildAttemptId?: string;
}) {
  const buildStep = workflowStepDto({
    id: LIVE_BUILD_STEP_ID,
    key: 'build',
    name: 'build',
    position: 0,
    status: buildStatus,
    current_attempt: buildAttempt,
    attempts: [
      workflowStepAttemptDto({
        id: buildAttemptId,
        step_id: LIVE_BUILD_STEP_ID,
        attempt: buildAttempt,
        status: buildStatus,
      }),
    ],
  });
  const deployStep = workflowStepDto({
    id: LIVE_DEPLOY_STEP_ID,
    key: 'deploy',
    name: 'deploy',
    position: 1,
    status: deployStatus,
    attempts:
      deployStatus === 'running'
        ? [
            workflowStepAttemptDto({
              id: LIVE_DEPLOY_ATTEMPT_ID,
              step_id: LIVE_DEPLOY_STEP_ID,
              attempt: 1,
              status: 'running',
            }),
          ]
        : [],
  });

  return workflowRunDetailDto({
    id: RUN_ID,
    status: 'running',
    current_attempt: 1,
    latest_attempt: 1,
    run_attempt: workflowRunAttemptDto({
      workflow_run_id: RUN_ID,
      attempt: 1,
      status: 'running',
    }),
    jobs: [
      workflowJobDto({
        id: LIVE_JOB_ID,
        key: 'release',
        name: 'release',
        status: 'running',
        job_executions: [
          workflowJobExecutionDto({
            id: LIVE_EXECUTION_ID,
            job_id: LIVE_JOB_ID,
            sequence: 1,
            status: 'running',
            steps: [buildStep, deployStep],
          }),
        ],
      }),
    ],
  });
}

function jobDetailDto() {
  const step = workflowStepDto({
    id: STEP_ID,
    name: 'tests',
    key: 'tests',
    status: 'succeeded',
    attempts: [
      workflowStepAttemptDto({
        id: ATTEMPT_ID,
        step_id: STEP_ID,
        attempt: 2,
        status: 'succeeded',
      }),
    ],
  });
  const execution = workflowJobExecutionDto({
    id: EXECUTION_ID,
    job_id: JOB_ID,
    sequence: 2,
    name: 'release',
    status: 'succeeded',
    queued_at: '2026-06-21T12:00:00.000Z',
    started_at: '2026-06-21T12:00:05.000Z',
    finished_at: '2026-06-21T12:01:15.000Z',
    steps: [step],
  });

  return workflowRunDetailDto({
    id: RUN_ID,
    status: 'succeeded',
    current_attempt: 1,
    latest_attempt: 1,
    run_attempt: workflowRunAttemptDto({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      workflow_run_id: RUN_ID,
      attempt: 1,
      status: 'succeeded',
    }),
    jobs: [
      workflowJobDto({
        id: JOB_ID,
        key: 'release',
        name: 'release',
        status: 'succeeded',
        job_executions: [
          workflowJobExecutionDto({
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            job_id: JOB_ID,
            sequence: 1,
            name: 'release',
            status: 'failed',
          }),
          execution,
        ],
      }),
    ],
  });
}

function failedBeforeStepsDetailDto() {
  return workflowRunDetailDto({
    id: RUN_ID,
    status: 'failed',
    run_attempt: workflowRunAttemptDto({
      workflow_run_id: RUN_ID,
      attempt: 1,
      status: 'failed',
    }),
    jobs: [
      workflowJobDto({
        id: JOB_ID,
        key: 'release',
        name: 'release',
        status: 'failed',
        status_reason: 'runner_lost',
        job_executions: [
          workflowJobExecutionDto({
            id: EXECUTION_ID,
            job_id: JOB_ID,
            sequence: 1,
            status: 'failed',
            status_reason: 'runner_lost',
            steps: [],
          }),
        ],
      }),
    ],
  });
}

function multiJobDetailDto() {
  const detail = jobDetailDto();
  return {
    ...detail,
    jobs: [
      ...detail.jobs,
      workflowJobDto({
        id: SIBLING_JOB_ID,
        key: 'lint',
        name: 'lint',
        status: 'succeeded',
        position: 1,
      }),
    ],
  };
}
