import type {
  WorkflowRunDetailResponseDto,
  WorkflowRunResponseDto,
} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {act, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {inlineLogBody, outputLine} from '#test/fixtures/logs.js';
import {
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunDetailDto,
  workflowRunDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {jsonResponse, PROJECT_TEST_WSLUG, renderProjectPage} from '#test/pages.js';
import {WorkflowRunDetailPage} from './workflow-run-detail-page.js';
import {WorkflowRunsPage} from './workflow-run-list-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const SECOND_RUN_ID = '66666666-6666-4666-8666-000000000002';
const OLDER_RUN_ID = '66666666-6666-4666-8666-000000000003';
const BUILD_JOB_ID = '77777777-7777-4777-8777-777777777777';
const BUILD_STEP_ID = '99999999-9999-4999-8999-000000000000';
const BUILD_ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000000';
const DEPLOY_JOB_ID = '88888888-8888-4888-8888-888888888888';
const DEPLOY_STEP_ID = '99999999-9999-4999-8999-999999999999';
const DEPLOY_RETRY_STEP_ID = '99999999-9999-4999-8999-000000000003';
const DEPLOY_ATTEMPT_ONE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const DEPLOY_ATTEMPT_TWO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const DEPLOY_EXECUTION_ONE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const DEPLOY_EXECUTION_TWO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const SMOKE_WEB_RE = /smoke-web/u;
const DEPLOY_WEB_RE = /deploy-web/u;
const OLDER_RUN_RE = /older-run/u;
const INTEGRATION_TESTS_RE = /integration-tests/u;
const BUILD_IMAGE_RE = /build-image/u;
const EXECUTION_ONE_MENU_ITEM = /Execution #1: deploy review #1/u;
const RUN_DETAIL_PATH_RE = /^\/workflows\/runs\/([^/]+)$/u;
const RUN_OVERRIDES = {
  id: RUN_ID,
  project_id: PROJECT_ID,
  definition_id: DEFINITION_ID,
  trigger_payload: {source: 'manual', event: 'fire'},
  created_at: '2026-05-07T01:01:00.000Z',
  updated_at: '2026-05-07T01:02:00.000Z',
} satisfies Partial<WorkflowRunResponseDto>;
const SECOND_RUN_OVERRIDES = {
  ...RUN_OVERRIDES,
  id: SECOND_RUN_ID,
  name: 'smoke-web',
} satisfies Partial<WorkflowRunResponseDto>;
const OLDER_RUN_OVERRIDES = {
  ...RUN_OVERRIDES,
  id: OLDER_RUN_ID,
  name: 'older-run',
} satisfies Partial<WorkflowRunResponseDto>;

describe('WorkflowRunPages', () => {
  test('renders the list route without mounting run detail', async () => {
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    renderRunsPath();

    expect(await screen.findByLabelText('Loading runs')).toBeInTheDocument();
    expect(screen.getByLabelText('Workflow runs')).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading workflow run')).not.toBeInTheDocument();
  });

  test('keeps the list route and filters in place instead of redirecting to a run', async () => {
    configureApiClient({fetchImpl: createRunsListFetch()});

    const {router} = renderRunsPath('?search=deploy-web&status=running');

    expect(await screen.findByRole('link', {name: DEPLOY_WEB_RE})).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/w/${PROJECT_TEST_WSLUG}/p/project/runs`);
    expect(currentSearch(router)).toMatchObject({search: 'deploy-web', status: 'running'});
    expect(screen.queryByLabelText('Loading workflow run')).not.toBeInTheDocument();
  });

  test('clearing filters on the list route resets search and status in the URL', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createRunsListFetch()});

    const {router} = renderRunsPath('?search=no-such-run&status=failed');

    expect(await screen.findByText('No matching runs')).toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Clear filters'}));

    await waitFor(() => {
      expect(currentSearch(router).search).toBeUndefined();
    });
    expect(currentSearch(router).status).toBeUndefined();
    expect(await screen.findByRole('link', {name: DEPLOY_WEB_RE})).toBeInTheDocument();
  });

  test('honors a deep link that repeats a filter key', async () => {
    configureApiClient({fetchImpl: createMixedStatusRunsFetch()});

    renderRunsPath('?status=failed&status=running');

    expect(await screen.findByRole('link', {name: DEPLOY_WEB_RE})).toBeInTheDocument();
    expect(await screen.findByRole('link', {name: INTEGRATION_TESTS_RE})).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: BUILD_IMAGE_RE})).not.toBeInTheDocument();
  });

  test('writes a multi-select as repeated keys rather than one joined value', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createMixedStatusRunsFetch()});

    const {router} = renderRunsPath('?status=failed');

    await user.click(await screen.findByRole('button', {name: 'Status filter'}));
    await user.click(await screen.findByRole('menuitemcheckbox', {name: 'Running'}));

    await waitFor(() => {
      expect(currentSearch(router).status).toEqual(['failed', 'running']);
    });
    expect(router.state.location.searchStr).toBe('?status=failed&status=running');
  });

  test('replaces history on a filter change so back leaves the list', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createMixedStatusRunsFetch()});

    const {router} = renderRunsPath();
    const initialLength = router.history.length;

    await user.type(await screen.findByLabelText('Search runs'), 'deploy');

    await waitFor(() => {
      expect(currentSearch(router).search).toBe('deploy');
    });
    expect(router.history.length).toBe(initialLength);
  });

  test('loads older pages before reporting that a search has no matches', async () => {
    const user = userEvent.setup();
    const fetchImpl = createPaginatedRunsFetch();
    configureApiClient({fetchImpl});

    renderRunsPath('?search=older-run');

    expect(await screen.findByText('No matches in loaded history')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Load more runs'}));

    expect(await screen.findByRole('link', {name: OLDER_RUN_RE})).toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.some((call) => {
        const url = new URL(requestInputUrl(call[0]));
        return url.searchParams.get('cursor') === 'cursor-2';
      }),
    ).toBe(true);
  });

  test('shows the list empty state without mounting run detail', async () => {
    configureApiClient({fetchImpl: createEmptyRunsFetch()});

    renderRunsPath();

    expect(await screen.findByText('No runs yet')).toBeInTheDocument();
    expect(screen.getByLabelText('Workflow runs')).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading workflow run')).not.toBeInTheDocument();
  });

  test('renders the detail route without mounting the run list', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    renderRunPath();

    expect(await screen.findByRole('button', {name: 'deploy, Running'})).toBeInTheDocument();
    expect(screen.queryByLabelText('Workflow runs')).not.toBeInTheDocument();
  });

  test('restores a deep-linked job and exact attempt after data loads', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    renderRunPath(
      `?job=${BUILD_JOB_ID}&step=${DEPLOY_STEP_ID}&stepAttempt=${DEPLOY_ATTEMPT_TWO_ID}`,
    );

    const deployJob = await screen.findByRole('button', {name: 'deploy, Running'});
    const deployAttempt = await screen.findByRole('button', {
      name: 'deploy, Running, attempt 2',
    });

    expect(deployJob).toHaveAttribute('aria-pressed', 'true');
    expect(deployAttempt).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('attempt two log')).toBeInTheDocument();
  });

  test('selecting a job writes job search state and clears stale step state', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createRunDetailFetch()});
    const {router} = renderRunPath(
      `?step=${DEPLOY_STEP_ID}&stepAttempt=${DEPLOY_ATTEMPT_TWO_ID}&runAttempt=1`,
    );

    await user.click(await screen.findByRole('button', {name: 'build, Succeeded'}));

    await waitFor(() => {
      expect(currentSearch(router)).toMatchObject({job: BUILD_JOB_ID});
    });
    expect(currentSearch(router).step).toBeUndefined();
    expect(currentSearch(router).stepAttempt).toBeUndefined();
    expect(screen.getByRole('button', {name: 'checkout, Succeeded, attempt 1'})).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('selecting an attempt writes job, step, and attempt search state', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createRunDetailFetch()});
    const {router} = renderRunPath(`?job=${DEPLOY_JOB_ID}`);

    await user.click(await screen.findByRole('button', {name: 'deploy, Running, attempt 2'}));

    await waitFor(() => {
      expect(currentSearch(router)).toMatchObject({
        job: DEPLOY_JOB_ID,
        step: DEPLOY_STEP_ID,
        stepAttempt: DEPLOY_ATTEMPT_TWO_ID,
      });
    });
  });

  test('selecting a listening execution writes job execution search state and scopes step selection', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: createRunDetailFetch({details: {[RUN_ID]: retryRunDetailDto()}}),
    });
    const {router} = renderRunPath(`?job=${DEPLOY_JOB_ID}`);

    await user.click(
      await screen.findByRole('button', {
        name: 'Switch job execution, currently execution 2: deploy review #2',
      }),
    );
    await user.click(
      screen.getByRole('menuitem', {
        name: EXECUTION_ONE_MENU_ITEM,
      }),
    );

    await waitFor(() => {
      expect(currentSearch(router)).toMatchObject({
        job: DEPLOY_JOB_ID,
        jobExecution: DEPLOY_EXECUTION_ONE_ID,
      });
    });
    expect(screen.getByRole('button', {name: 'deploy, Failed, attempt 1'})).toBeInTheDocument();
    expect(screen.getAllByText('deploy review #1')).not.toHaveLength(0);

    await user.click(screen.getByRole('button', {name: 'deploy, Failed, attempt 1'}));

    await waitFor(() => {
      expect(currentSearch(router)).toMatchObject({
        job: DEPLOY_JOB_ID,
        jobExecution: DEPLOY_EXECUTION_ONE_ID,
        step: DEPLOY_STEP_ID,
        stepAttempt: DEPLOY_ATTEMPT_ONE_ID,
      });
    });
    expect(await screen.findByText('attempt one log')).toBeInTheDocument();
  });

  test('collapsing an attempt removes step and attempt while preserving job', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createRunDetailFetch()});
    const {router} = renderRunPath(`?step=${DEPLOY_STEP_ID}&stepAttempt=${DEPLOY_ATTEMPT_TWO_ID}`);

    const deployAttempt = await screen.findByRole('button', {
      name: 'deploy, Running, attempt 2',
    });
    await user.click(deployAttempt);

    await waitFor(() => {
      expect(currentSearch(router)).toMatchObject({job: DEPLOY_JOB_ID});
    });
    expect(currentSearch(router).step).toBeUndefined();
    expect(currentSearch(router).stepAttempt).toBeUndefined();
    expect(deployAttempt).toHaveAttribute('aria-expanded', 'false');
  });

  test('back and forward navigation restores prior selections', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createRunDetailFetch()});
    const {router} = renderRunPath(`?job=${DEPLOY_JOB_ID}`);

    await user.click(await screen.findByRole('button', {name: 'deploy, Running, attempt 2'}));
    await waitFor(() => {
      expect(currentSearch(router).stepAttempt).toBe(DEPLOY_ATTEMPT_TWO_ID);
    });

    await act(() => {
      router.history.back();
    });
    await waitFor(() => {
      expect(currentSearch(router)).toMatchObject({job: DEPLOY_JOB_ID});
    });
    expect(currentSearch(router).step).toBeUndefined();
    expect(currentSearch(router).stepAttempt).toBeUndefined();
    expect(screen.getByRole('button', {name: 'deploy, Running, attempt 2'})).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await act(() => {
      router.history.forward();
    });
    await waitFor(() => {
      expect(currentSearch(router).stepAttempt).toBe(DEPLOY_ATTEMPT_TWO_ID);
    });
    expect(screen.getByRole('button', {name: 'deploy, Running, attempt 2'})).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  test('run list links navigate to detail and back restores list filters', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: createRunDetailFetch({
        runs: [workflowRunDto(RUN_OVERRIDES), workflowRunDto(SECOND_RUN_OVERRIDES)],
        details: {
          [RUN_ID]: defaultRunDetailDto(),
          [SECOND_RUN_ID]: workflowRunDetailDto({...SECOND_RUN_OVERRIDES, jobs: []}),
        },
      }),
    });
    const {router} = renderRunsPath('?search=smoke&status=running');

    await user.click(await screen.findByRole('link', {name: SMOKE_WEB_RE}));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${SECOND_RUN_ID}`,
      );
    });
    expect(screen.queryByLabelText('Workflow runs')).not.toBeInTheDocument();
    expect(currentSearch(router)).toMatchObject({search: 'smoke', status: 'running'});

    await act(() => {
      router.history.back();
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/w/${PROJECT_TEST_WSLUG}/p/project/runs`);
    });
    expect(currentSearch(router)).toMatchObject({search: 'smoke', status: 'running'});
    expect(screen.getByLabelText('Workflow runs')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: SMOKE_WEB_RE})).toBeInTheDocument();
  });
});

function renderRunsPath(search = '') {
  return renderProjectPage(
    `/w/${PROJECT_TEST_WSLUG}/p/project/runs${search}`,
    ({workflowRunId, search}) =>
      workflowRunId ? (
        <WorkflowRunDetailPage
          projectId={PROJECT_ID}
          workspaceSlug={PROJECT_TEST_WSLUG}
          projectSlug="project"
          workflowRunId={workflowRunId}
          search={search}
        />
      ) : (
        <WorkflowRunsPage
          projectId={PROJECT_ID}
          workspaceSlug={PROJECT_TEST_WSLUG}
          projectSlug="project"
          search={search}
        />
      ),
  );
}

function renderRunPath(search = '') {
  return renderProjectPage(
    `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${RUN_ID}${search}`,
    ({workflowRunId, search}) => (
      <WorkflowRunDetailPage
        projectId={PROJECT_ID}
        workspaceSlug={PROJECT_TEST_WSLUG}
        projectSlug="project"
        workflowRunId={workflowRunId}
        search={search}
      />
    ),
  );
}

function createRunsListFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs') {
      return Promise.resolve(
        jsonResponse({
          runs: [workflowRunDto(RUN_OVERRIDES)],
          next_cursor: null,
          filtered_total_count: 1,
        }),
      );
    }
    if (url.pathname === `/workflows/runs/${RUN_ID}`) {
      return Promise.resolve(jsonResponse(workflowRunDetailDto({...RUN_OVERRIDES, jobs: []})));
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function createMixedStatusRunsFetch() {
  const runs = [
    workflowRunDto({...RUN_OVERRIDES, status: 'running'}),
    workflowRunDto({
      ...RUN_OVERRIDES,
      id: SECOND_RUN_ID,
      name: 'integration-tests',
      workflow_name: 'integration-tests',
      status: 'failed',
    }),
    workflowRunDto({
      ...RUN_OVERRIDES,
      id: OLDER_RUN_ID,
      name: 'build-image',
      workflow_name: 'build-image',
      status: 'succeeded',
    }),
  ];

  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs') {
      return Promise.resolve(jsonResponse({runs, next_cursor: null, filtered_total_count: 3}));
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function createPaginatedRunsFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs') {
      const isSecondPage = url.searchParams.get('cursor') === 'cursor-2';
      return Promise.resolve(
        jsonResponse({
          runs: [workflowRunDto(isSecondPage ? OLDER_RUN_OVERRIDES : RUN_OVERRIDES)],
          next_cursor: isSecondPage ? null : 'cursor-2',
          filtered_total_count: isSecondPage ? null : 2,
        }),
      );
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function createRunDetailFetch({
  runs = [workflowRunDto(RUN_OVERRIDES)],
  details = {[RUN_ID]: defaultRunDetailDto()},
}: {
  runs?: WorkflowRunResponseDto[];
  details?: Record<string, WorkflowRunDetailResponseDto>;
} = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs') {
      return Promise.resolve(
        jsonResponse({runs, next_cursor: null, filtered_total_count: runs.length}),
      );
    }

    const runMatch = url.pathname.match(RUN_DETAIL_PATH_RE);
    if (runMatch?.[1] && details[runMatch[1]]) {
      return Promise.resolve(jsonResponse(details[runMatch[1]]));
    }

    if (url.pathname === `/steps/${DEPLOY_STEP_ID}/attempts/1/logs`) {
      return Promise.resolve(jsonResponse(inlineLogBody(outputLine('attempt one log\n'), 1)));
    }
    if (url.pathname === `/steps/${DEPLOY_STEP_ID}/attempts/2/logs`) {
      return Promise.resolve(jsonResponse(inlineLogBody(outputLine('attempt two log\n'), 1)));
    }
    if (url.pathname === `/steps/${DEPLOY_RETRY_STEP_ID}/attempts/1/logs`) {
      return Promise.resolve(jsonResponse(inlineLogBody(outputLine('retry attempt log\n'), 1)));
    }
    if (url.pathname === `/steps/${BUILD_STEP_ID}/attempts/1/logs`) {
      return Promise.resolve(jsonResponse(inlineLogBody(outputLine('build log\n'), 1)));
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function createEmptyRunsFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs') {
      return Promise.resolve(jsonResponse({runs: [], next_cursor: null, filtered_total_count: 0}));
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function requestInputUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

function defaultRunDetailDto(
  overrides: Partial<WorkflowRunDetailResponseDto> = {},
): WorkflowRunDetailResponseDto {
  return workflowRunDetailDto({
    ...RUN_OVERRIDES,
    jobs: [
      workflowJobDto({
        id: BUILD_JOB_ID,
        run_attempt_id: RUN_ID,
        name: 'build',
        status: 'succeeded',
        steps: [
          workflowStepDto({
            id: BUILD_STEP_ID,
            key: 'checkout',
            name: 'checkout',
            status: 'succeeded',
            current_attempt: 1,
            attempts: [
              workflowStepAttemptDto({
                id: BUILD_ATTEMPT_ID,
                step_id: BUILD_STEP_ID,
                status: 'succeeded',
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
        steps: [
          workflowStepDto({
            id: DEPLOY_STEP_ID,
            key: 'deploy',
            name: 'deploy',
            status: 'running',
            current_attempt: 2,
            attempts: [
              workflowStepAttemptDto({
                id: DEPLOY_ATTEMPT_ONE_ID,
                step_id: DEPLOY_STEP_ID,
                attempt: 1,
                execution_order: 1,
                status: 'failed',
                exit_code: 1,
              }),
              workflowStepAttemptDto({
                id: DEPLOY_ATTEMPT_TWO_ID,
                step_id: DEPLOY_STEP_ID,
                attempt: 2,
                execution_order: 2,
                status: 'running',
                exit_code: null,
                finished_at: null,
              }),
            ],
          }),
        ],
      }),
    ],
    ...overrides,
  });
}

function retryRunDetailDto(): WorkflowRunDetailResponseDto {
  return defaultRunDetailDto({
    jobs: [
      workflowJobDto({
        id: BUILD_JOB_ID,
        run_attempt_id: RUN_ID,
        name: 'build',
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
                status: 'succeeded',
              }),
            ],
          }),
        ],
      }),
      workflowJobDto({
        id: DEPLOY_JOB_ID,
        run_attempt_id: RUN_ID,
        name: 'deploy',
        mode: 'listening',
        status: 'running',
        listener_status: 'listening',
        position: 1,
        dependencies: ['build'],
        job_executions: [
          workflowJobExecutionDto({
            id: DEPLOY_EXECUTION_ONE_ID,
            job_id: DEPLOY_JOB_ID,
            sequence: 1,
            name: 'deploy review #1',
            status: 'failed',
            started_at: '2026-05-07T01:01:00.000Z',
            finished_at: '2026-05-07T01:02:00.000Z',
            steps: [
              workflowStepDto({
                id: DEPLOY_STEP_ID,
                name: 'deploy',
                status: 'failed',
                attempts: [
                  workflowStepAttemptDto({
                    id: DEPLOY_ATTEMPT_ONE_ID,
                    step_id: DEPLOY_STEP_ID,
                    status: 'failed',
                    exit_code: 1,
                  }),
                ],
              }),
            ],
          }),
          workflowJobExecutionDto({
            id: DEPLOY_EXECUTION_TWO_ID,
            job_id: DEPLOY_JOB_ID,
            sequence: 2,
            name: 'deploy review #2',
            status: 'running',
            started_at: '2026-05-07T01:03:00.000Z',
            steps: [
              workflowStepDto({
                id: DEPLOY_RETRY_STEP_ID,
                name: 'deploy retry',
                status: 'running',
                attempts: [
                  workflowStepAttemptDto({
                    id: DEPLOY_ATTEMPT_TWO_ID,
                    step_id: DEPLOY_RETRY_STEP_ID,
                    status: 'running',
                    exit_code: null,
                    finished_at: null,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function currentSearch({state}: ReturnType<typeof renderRunPath>['router']) {
  return state.location.search as Record<string, unknown>;
}
