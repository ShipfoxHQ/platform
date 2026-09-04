import type {
  WorkflowRunDetailResponseDto,
  WorkflowRunResponseDto,
  WorkflowRunSelectionResponseDto,
} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {act, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {WorkflowJobSearch, WorkflowRunsSearch} from '#routes/inputs.js';
import {inlineLogBody, outputLine} from '#test/fixtures/logs.js';
import {
  workflowJobDetailResponseDto,
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunDetailDto,
  workflowRunDto,
  workflowRunOverviewResponseDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {jsonResponse, PROJECT_TEST_WSLUG, renderProjectPage} from '#test/pages.js';
import {WorkflowJobDetailPage} from './workflow-job-detail-page.js';
import {WorkflowRunDetailPage} from './workflow-run-detail-page.js';
import {WorkflowRunsPage} from './workflow-run-list-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const SECOND_DEFINITION_ID = '55555555-5555-4555-8555-000000000002';
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
const DEPLOY_EXECUTION_ID = '77777777-7777-4777-8777-000000000002';
const DEFAULT_SELECTION_RESPONSE = {
  workflow_run_attempt: 1,
  job_id: DEPLOY_JOB_ID,
  job_execution_id: DEPLOY_EXECUTION_ID,
  step_id: DEPLOY_STEP_ID,
  step_attempt_id: DEPLOY_ATTEMPT_TWO_ID,
  step_attempt: 2,
  source_location: null,
} satisfies Omit<WorkflowRunSelectionResponseDto, 'workflow_run_id'>;
const SMOKE_WEB_RE = /smoke-web/u;
const DEPLOY_WEB_RE = /deploy-web/u;
const DEPLOY_PRODUCTION_RE = /deploy-production/u;
const CI_RUN_RE = /ci-run/u;
const OLDER_RUN_RE = /older-run/u;
const TRIAGE_SENTRY_RE = /triage-sentry/u;
const INTEGRATION_TESTS_RE = /integration-tests/u;
const BUILD_IMAGE_RE = /build-image/u;
const STATUS_FILTER_RE = /^Status\b.*filter$/u;
const WORKFLOW_FILTER_RE = /^Workflow\b.*filter$/u;
const ORIGIN_FILTER_RE = /^Origin\b.*filter$/u;
const JOBS_TAB_NAME = /^Jobs/u;
const BUILD_JOB_BUTTON_NAME = 'build, Succeeded';
const DEPLOY_JOB_BUTTON_NAME = 'deploy, Running';
const SELECTION_NOT_FOUND_DESCRIPTION_RE = /not part of this run/u;
const SELECTION_LOAD_ERROR_RE = /Could not load workflow run selection/u;
const RUN_DETAIL_PATH_RE = /^\/workflows\/runs\/([^/]+)$/u;
const RUN_HEAD_PATH_RE = /^\/workflows\/runs\/([^/]+)\/head$/u;
const RUN_OVERVIEW_PATH_RE = /^\/workflows\/runs\/([^/]+)\/overview$/u;
const RUN_SELECTION_PATH_RE = /^\/workflows\/runs\/([^/]+)\/selection$/u;
const JOB_DETAIL_PATH_RE = /^\/workflows\/runs\/jobs\/([^/]+)$/u;
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

  test('lets the list route inherit its shell canvas and width', async () => {
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    const {container} = renderRunsPath();

    await screen.findByLabelText('Workflow runs');
    const pageRoot = container.querySelector('[data-workflow-page-root="runs"]');

    expect(pageRoot).not.toBeNull();
    expect(pageRoot).not.toHaveClass('bg-background-neutral-base');
    expect(pageRoot).not.toHaveClass('max-w-[1120px]');
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

    await user.click(await screen.findByRole('button', {name: STATUS_FILTER_RE}));
    await user.click(await screen.findByRole('menuitemcheckbox', {name: 'Running'}));

    await waitFor(() => {
      expect(currentSearch(router).status).toEqual(['failed', 'running']);
    });
    expect(router.state.location.searchStr).toBe('?status=failed&status=running');
  });

  test('honors an origin deep link and clears it without exposing an Origin filter', async () => {
    const user = userEvent.setup();
    const fetchImpl = createMixedOriginRunsFetch();
    configureApiClient({fetchImpl});

    // A dev deep link reaches the API as origin=dev and shows only dev runs.
    const {router} = renderRunsPath('?origin=dev');

    expect(await screen.findByRole('link', {name: TRIAGE_SENTRY_RE})).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: DEPLOY_WEB_RE})).not.toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.some((call) => {
        const url = new URL(requestInputUrl(call[0]));
        return url.pathname === '/workflows/runs' && url.searchParams.get('origin') === 'dev';
      }),
    ).toBe(true);

    expect(screen.queryByRole('button', {name: ORIGIN_FILTER_RE})).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Clear filters'}));
    await waitFor(() => {
      expect(currentSearch(router).origin).toBeUndefined();
    });
    expect(router.state.location.searchStr).toBe('');
    expect(await screen.findByRole('link', {name: DEPLOY_WEB_RE})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: TRIAGE_SENTRY_RE})).toBeInTheDocument();
  });

  test('writes the selected workflow to the URL and filters the full history through the API', async () => {
    const user = userEvent.setup();
    const fetchImpl = createMixedWorkflowRunsFetch();
    configureApiClient({fetchImpl});

    const {router} = renderRunsPath();

    await user.click(await screen.findByRole('button', {name: WORKFLOW_FILTER_RE}));
    await user.click(await screen.findByRole('option', {name: 'Deploy production'}));

    await waitFor(() => {
      expect(currentSearch(router).workflow).toBe(DEFINITION_ID);
    });
    expect(router.state.location.searchStr).toBe(`?workflow=${DEFINITION_ID}`);
    expect(
      fetchImpl.mock.calls.some((call) => {
        const url = new URL(requestInputUrl(call[0]));
        return (
          url.pathname === '/workflows/runs' &&
          url.searchParams.get('definition_id') === DEFINITION_ID
        );
      }),
    ).toBe(true);
    expect(await screen.findByRole('link', {name: DEPLOY_PRODUCTION_RE})).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: CI_RUN_RE})).not.toBeInTheDocument();
  });

  test('loads every workflow definition page into the chooser', async () => {
    const user = userEvent.setup();
    const fetchImpl = createPaginatedWorkflowDefinitionsFetch();
    configureApiClient({fetchImpl});

    renderRunsPath();

    const workflowFilter = await screen.findByRole('button', {name: WORKFLOW_FILTER_RE});
    expect(
      fetchImpl.mock.calls.some((call) => {
        const url = new URL(requestInputUrl(call[0]));
        return url.pathname === '/definitions';
      }),
    ).toBe(false);

    await user.click(workflowFilter);

    expect(await screen.findByRole('option', {name: 'Nightly'})).toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.some((call) => {
        const url = new URL(requestInputUrl(call[0]));
        return url.pathname === '/definitions' && url.searchParams.get('cursor') === 'workflow-2';
      }),
    ).toBe(true);
  });

  test('reports a workflow definition failure and recovers when retried', async () => {
    const user = userEvent.setup();
    const fetchImpl = createRecoveringWorkflowDefinitionsFetch();
    configureApiClient({fetchImpl});

    renderRunsPath();

    await user.click(await screen.findByRole('button', {name: WORKFLOW_FILTER_RE}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load all workflows.');

    await user.click(screen.getByRole('button', {name: 'Retry'}));

    expect(await screen.findByRole('option', {name: 'Deploy production'})).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.filter((call) => {
        const url = new URL(requestInputUrl(call[0]));
        return url.pathname === '/definitions';
      }),
    ).toHaveLength(2);
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

  test('renders the run workspace with the graph as the default all-jobs Summary', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    const {router} = renderRunPath();

    expect(await screen.findByRole('region', {name: 'deploy-web'})).toBeInTheDocument();
    expect(screen.getByRole('navigation', {name: 'Run workspace'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Summary'})).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', {name: 'All jobs summary'})).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Workflow jobs'})).toBeInTheDocument();
    expect(screen.queryByLabelText('Workflow runs')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', {name: JOBS_TAB_NAME})).not.toBeInTheDocument();
    expect(currentSearch(router).tab).toBeUndefined();
  });

  test('lets the run detail route inherit its shell canvas', async () => {
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    const {container} = renderRunPath();

    expect(await screen.findByRole('region', {name: 'Loading workflow run'})).toBeInTheDocument();

    const pageRoot = container.querySelector('[data-workflow-page-root="run-detail"]');

    expect(pageRoot).not.toBeNull();
    expect(pageRoot).not.toHaveClass('bg-background-subtle-base');
  });

  test('maps the removed Jobs tab URL to the graph Summary', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    renderRunPath('?tab=jobs');

    expect(await screen.findByRole('region', {name: 'All jobs summary'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Summary'})).toHaveAttribute('aria-current', 'page');
  });

  test('redirects a legacy selected-step URL to its owning dedicated job page', async () => {
    const fetchImpl = createRunDetailFetch({
      selectionResponse: {
        workflow_run_id: RUN_ID,
        workflow_run_attempt: 1,
        job_id: DEPLOY_JOB_ID,
        job_execution_id: DEPLOY_EXECUTION_ID,
        step_id: DEPLOY_STEP_ID,
        step_attempt_id: DEPLOY_ATTEMPT_TWO_ID,
        step_attempt: 2,
        source_location: null,
      },
    });
    configureApiClient({fetchImpl});

    const {router} = renderRunPath(`?step=${DEPLOY_STEP_ID}&stepAttempt=${DEPLOY_ATTEMPT_TWO_ID}`);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${RUN_ID}/jobs/${DEPLOY_JOB_ID}`,
      ),
    );
    expect(currentSearch(router)).toMatchObject({
      jobExecution: DEPLOY_EXECUTION_ID,
      step: DEPLOY_STEP_ID,
      stepAttempt: DEPLOY_ATTEMPT_TWO_ID,
      runAttempt: '1',
    });
    expect(await screen.findByRole('heading', {name: 'deploy'})).toBeInTheDocument();
    const selectionRequest = fetchImpl.mock.calls.find((call) => {
      const url = new URL(requestInputUrl(call[0]));
      return url.pathname === `/workflows/runs/${RUN_ID}/selection`;
    });
    expect(selectionRequest).toBeDefined();
    if (!selectionRequest) throw new Error('Expected a selection resolver request');
    const selectionUrl = new URL(requestInputUrl(selectionRequest[0]));
    expect(selectionUrl.searchParams.get('step_id')).toBe(DEPLOY_STEP_ID);
    expect(selectionUrl.searchParams.get('step_attempt_id')).toBe(DEPLOY_ATTEMPT_TWO_ID);
    expect(
      fetchImpl.mock.calls.some((call) => {
        const url = new URL(requestInputUrl(call[0]));
        return url.pathname === `/workflows/runs/${RUN_ID}`;
      }),
    ).toBe(false);
  });

  test('canonicalizes a source selection in place without redirecting to a job', async () => {
    const fetchImpl = createRunDetailFetch({
      selectionResponse: {
        workflow_run_id: RUN_ID,
        workflow_run_attempt: 1,
        job_id: DEPLOY_JOB_ID,
        job_execution_id: DEPLOY_EXECUTION_ID,
        step_id: DEPLOY_STEP_ID,
        step_attempt_id: DEPLOY_ATTEMPT_TWO_ID,
        step_attempt: 2,
        source_location: null,
      },
    });
    configureApiClient({fetchImpl});

    const {router} = renderRunPath(
      `?tab=source&step=${DEPLOY_STEP_ID}&stepAttempt=${DEPLOY_ATTEMPT_TWO_ID}`,
    );
    const initialHistoryLength = router.history.length;

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${RUN_ID}`,
      );
      expect(currentSearch(router)).toMatchObject({
        tab: 'source',
        job: DEPLOY_JOB_ID,
        jobExecution: DEPLOY_EXECUTION_ID,
        step: DEPLOY_STEP_ID,
        stepAttempt: DEPLOY_ATTEMPT_TWO_ID,
        runAttempt: '1',
      });
    });
    expect(
      fetchImpl.mock.calls.filter((call) => {
        const url = new URL(requestInputUrl(call[0]));
        return url.pathname === `/workflows/runs/${RUN_ID}/selection`;
      }),
    ).toHaveLength(1);
    expect(router.history.length).toBe(initialHistoryLength);
    expect(
      fetchImpl.mock.calls.some((call) => {
        const url = new URL(requestInputUrl(call[0]));
        return url.pathname === `/workflows/runs/${RUN_ID}`;
      }),
    ).toBe(false);
  });

  test('shows a scoped not-found state for an inaccessible selection', async () => {
    const fetchImpl = createRunDetailFetch({selectionResponse: null});
    configureApiClient({fetchImpl});

    const {router} = renderRunPath(`?step=${DEPLOY_STEP_ID}`);

    expect(await screen.findByText('Job or step not found')).toBeInTheDocument();
    expect(screen.getByText(SELECTION_NOT_FOUND_DESCRIPTION_RE)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(
      fetchImpl.mock.calls.some((call) => {
        const url = new URL(requestInputUrl(call[0]));
        return url.pathname === `/workflows/runs/${RUN_ID}`;
      }),
    ).toBe(false);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', {name: 'View workflow run'}));
    await waitFor(() => expect(currentSearch(router).step).toBeUndefined());
  });

  test('keeps the run workspace available when selection resolution fails unexpectedly', async () => {
    const fetchImpl = createRunDetailFetch({selectionErrorStatus: 500});
    configureApiClient({fetchImpl});

    renderRunPath(`?step=${DEPLOY_STEP_ID}`);

    expect(await screen.findByRole('region', {name: 'All jobs summary'})).toBeInTheDocument();
    expect(screen.queryByText('Job or step not found')).not.toBeInTheDocument();
    expect(screen.queryByText(SELECTION_LOAD_ERROR_RE)).not.toBeInTheDocument();
  });

  test('resolves an execution-only link through the default selection fixture', async () => {
    const fetchImpl = createRunDetailFetch();
    configureApiClient({fetchImpl});

    const {router} = renderRunPath(`?jobExecution=${DEPLOY_EXECUTION_ID}`);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${RUN_ID}/jobs/${DEPLOY_JOB_ID}`,
      ),
    );
    expect(currentSearch(router)).toMatchObject({
      jobExecution: DEPLOY_EXECUTION_ID,
      runAttempt: '1',
    });
    const selectionRequest = fetchImpl.mock.calls.find((call) => {
      const url = new URL(requestInputUrl(call[0]));
      return url.pathname === `/workflows/runs/${RUN_ID}/selection`;
    });
    expect(selectionRequest).toBeDefined();
    if (!selectionRequest) throw new Error('Expected a selection resolver request');
    const selectionUrl = new URL(requestInputUrl(selectionRequest[0]));
    expect(selectionUrl.search).toBe(`?job_execution_id=${DEPLOY_EXECUTION_ID}`);
  });

  test('navigates between run details and restores Summary with browser history', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createRunDetailFetch()});

    const {router} = renderRunPath();
    await user.click(await screen.findByRole('link', {name: 'Source'}));

    await waitFor(() => expect(currentSearch(router).tab).toBe('source'));
    expect(screen.getByRole('link', {name: 'Source'})).toHaveAttribute('aria-current', 'page');

    await act(() => router.history.back());
    await waitFor(() => expect(currentSearch(router).tab).toBeUndefined());
    expect(screen.getByRole('region', {name: 'All jobs summary'})).toBeInTheDocument();
  });

  test('navigates from the Summary graph to the job detail route', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createRunDetailFetch()});

    const {router} = renderRunPath();
    await screen.findByRole('region', {name: 'All jobs summary'});

    await user.click(await screen.findByRole('button', {name: 'deploy, Running'}));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${RUN_ID}/jobs/${DEPLOY_JOB_ID}`,
      ),
    );
  });

  test('keeps Summary active while keyboard navigation moves graph focus', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createRunDetailFetch()});

    const {router} = renderRunPath();
    const build = await screen.findByRole('button', {name: BUILD_JOB_BUTTON_NAME});
    const deploy = screen.getByRole('button', {name: DEPLOY_JOB_BUTTON_NAME});

    build.focus();
    await user.keyboard('{ArrowRight}');

    expect(deploy).toHaveFocus();
    expect(deploy).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', {name: 'Summary'})).toHaveAttribute('aria-current', 'page');
    expect(currentSearch(router).job).toBeUndefined();
  });

  test('selecting a job opens its dedicated page and clears stale step state', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createRunDetailFetch()});
    const {router} = renderRunPath(`?runAttempt=1`);
    const initialHistoryLength = router.history.length;

    await user.click(await screen.findByRole('button', {name: BUILD_JOB_BUTTON_NAME}));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${RUN_ID}/jobs/${BUILD_JOB_ID}`,
      ),
    );
    expect(router.history.length).toBe(initialHistoryLength + 1);
    expect(currentSearch(router).runAttempt).toBe('1');
    expect(currentSearch(router).step).toBeUndefined();
    expect(currentSearch(router).stepAttempt).toBeUndefined();
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
    ({workflowRunId, jobId, search}) => {
      if (workflowRunId && jobId) {
        return (
          <WorkflowJobDetailPage
            projectId={PROJECT_ID}
            workspaceSlug={PROJECT_TEST_WSLUG}
            projectSlug="project"
            workflowRunId={workflowRunId}
            jobId={jobId}
            search={search as WorkflowJobSearch}
          />
        );
      }
      if (workflowRunId) {
        return (
          <WorkflowRunDetailPage
            projectId={PROJECT_ID}
            workspaceSlug={PROJECT_TEST_WSLUG}
            projectSlug="project"
            workflowRunId={workflowRunId}
            search={search as WorkflowRunsSearch}
          />
        );
      }
      return (
        <WorkflowRunsPage
          projectId={PROJECT_ID}
          workspaceSlug={PROJECT_TEST_WSLUG}
          projectSlug="project"
          search={search as WorkflowRunsSearch}
        />
      );
    },
  );
}

function renderRunPath(search = '') {
  return renderProjectPage(
    `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${RUN_ID}${search}`,
    ({workflowRunId, jobId, search}) =>
      workflowRunId && jobId ? (
        <WorkflowJobDetailPage
          projectId={PROJECT_ID}
          workspaceSlug={PROJECT_TEST_WSLUG}
          projectSlug="project"
          workflowRunId={workflowRunId}
          jobId={jobId}
          search={search as WorkflowJobSearch}
        />
      ) : (
        <WorkflowRunDetailPage
          projectId={PROJECT_ID}
          workspaceSlug={PROJECT_TEST_WSLUG}
          projectSlug="project"
          workflowRunId={workflowRunId}
          search={search as WorkflowRunsSearch}
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

function createMixedOriginRunsFetch() {
  const runs = [
    workflowRunDto(RUN_OVERRIDES),
    workflowRunDto({
      id: '66666666-6666-4666-8666-000000000009',
      name: 'triage-sentry',
      workflow_name: 'triage-sentry',
      origin: 'dev',
      trigger_reference: null,
      dev_source: {
        ref: 'fix-triage-prompt',
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        config_path: '.shipfox/workflows/triage-sentry.yml',
        initiated_by_user_id: '99999999-9999-4999-8999-999999999999',
        replay_of_event_id: null,
      },
    }),
  ];

  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs') {
      const origin = url.searchParams.get('origin');
      const filtered = origin ? runs.filter((run) => run.origin === origin) : runs;
      return Promise.resolve(
        jsonResponse({
          runs: filtered,
          next_cursor: null,
          filtered_total_count: filtered.length,
        }),
      );
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function createMixedWorkflowRunsFetch() {
  const runs = [
    workflowRunDto({
      ...RUN_OVERRIDES,
      name: 'deploy-production',
      workflow_name: 'Deploy production',
    }),
    workflowRunDto({
      ...RUN_OVERRIDES,
      id: SECOND_RUN_ID,
      definition_id: SECOND_DEFINITION_ID,
      name: 'ci-run',
      workflow_name: 'CI',
    }),
  ];

  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs') {
      const definitionId = url.searchParams.get('definition_id');
      const filtered = definitionId
        ? runs.filter((run) => run.definition_id === definitionId)
        : runs;
      return Promise.resolve(
        jsonResponse({runs: filtered, next_cursor: null, filtered_total_count: filtered.length}),
      );
    }

    if (url.pathname === '/definitions') {
      return Promise.resolve(
        jsonResponse({
          definitions: [
            definitionDto(DEFINITION_ID, 'Deploy production'),
            definitionDto(SECOND_DEFINITION_ID, 'CI'),
          ],
          next_cursor: null,
          sync: null,
        }),
      );
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function createPaginatedWorkflowDefinitionsFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/definitions') {
      const isSecondPage = url.searchParams.get('cursor') === 'workflow-2';
      return Promise.resolve(
        jsonResponse({
          definitions: [
            definitionDto(
              isSecondPage ? SECOND_DEFINITION_ID : DEFINITION_ID,
              isSecondPage ? 'Nightly' : 'Deploy production',
            ),
          ],
          next_cursor: isSecondPage ? null : 'workflow-2',
          sync: null,
        }),
      );
    }

    if (url.pathname === '/workflows/runs') {
      return Promise.resolve(jsonResponse({runs: [], next_cursor: null, filtered_total_count: 0}));
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function createRecoveringWorkflowDefinitionsFetch() {
  let definitionAttempts = 0;

  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/definitions') {
      definitionAttempts += 1;
      if (definitionAttempts === 1) {
        return Promise.resolve(jsonResponse({code: 'unexpected'}, {status: 500}));
      }
      return Promise.resolve(
        jsonResponse({
          definitions: [definitionDto(DEFINITION_ID, 'Deploy production')],
          next_cursor: null,
          sync: null,
        }),
      );
    }

    if (url.pathname === '/workflows/runs') {
      return Promise.resolve(jsonResponse({runs: [], next_cursor: null, filtered_total_count: 0}));
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function definitionDto(id: string, name: string) {
  return {
    id,
    project_id: PROJECT_ID,
    config_path: `.shipfox/workflows/${name.toLowerCase().replaceAll(' ', '-')}.yml`,
    source: 'vcs',
    sha: 'abc123',
    ref: 'main',
    name,
    workflow_document: {name, jobs: {}},
    workflow_model: {kind: 'workflow', name},
    manual_trigger: null,
    fetched_at: '2026-05-07T01:00:00.000Z',
    created_at: '2026-05-07T01:00:00.000Z',
    updated_at: '2026-05-07T01:00:00.000Z',
  };
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
  selectionResponse,
  selectionErrorStatus,
}: {
  runs?: WorkflowRunResponseDto[];
  details?: Record<string, WorkflowRunDetailResponseDto>;
  selectionResponse?: WorkflowRunSelectionResponseDto | null | undefined;
  selectionErrorStatus?: number | undefined;
} = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs') {
      return Promise.resolve(
        jsonResponse({runs, next_cursor: null, filtered_total_count: runs.length}),
      );
    }

    if (url.pathname.match(RUN_SELECTION_PATH_RE) && selectionErrorStatus !== undefined) {
      return Promise.resolve(
        jsonResponse({code: 'selection-error'}, {status: selectionErrorStatus}),
      );
    }

    const resource = runResourceResponseForRequest(url, details, selectionResponse);
    return resource === undefined
      ? Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}))
      : Promise.resolve(jsonResponse(resource));
  });
}

function runResourceResponseForRequest(
  url: URL,
  details: Record<string, WorkflowRunDetailResponseDto>,
  selectionResponse: WorkflowRunSelectionResponseDto | null | undefined,
) {
  const runHead = runLineageHeadResponse(url, details);
  if (runHead) return runHead;

  const selectionMatch = url.pathname.match(RUN_SELECTION_PATH_RE);
  if (selectionMatch?.[1]) {
    return selectionResponse === null
      ? undefined
      : (selectionResponse ?? defaultSelectionResponse(selectionMatch[1]));
  }

  const runDetail = runDetailResponse(url, details);
  if (runDetail) return runDetail;

  const runOverview = runOverviewResponse(url, details);
  if (runOverview) return runOverview;

  const jobDetail = selectedJobDetailResponse(url, details);
  if (jobDetail) return jobDetail;

  return workflowStepLogResponse(url);
}

function defaultSelectionResponse(runId: string): WorkflowRunSelectionResponseDto {
  return {workflow_run_id: runId, ...DEFAULT_SELECTION_RESPONSE};
}

function runLineageHeadResponse(url: URL, details: Record<string, WorkflowRunDetailResponseDto>) {
  const runMatch = url.pathname.match(RUN_HEAD_PATH_RE);
  const detail = runMatch?.[1] ? details[runMatch[1]] : undefined;
  return detail
    ? {
        current_attempt: detail.run_attempt.attempt,
        latest_attempt: detail.latest_attempt,
        current_status: detail.run_attempt.status,
        updated_at: detail.updated_at,
      }
    : undefined;
}

function runDetailResponse(
  url: URL,
  details: Record<string, WorkflowRunDetailResponseDto>,
): WorkflowRunDetailResponseDto | undefined {
  const runMatch = url.pathname.match(RUN_DETAIL_PATH_RE);
  return runMatch?.[1] ? details[runMatch[1]] : undefined;
}

function runOverviewResponse(url: URL, details: Record<string, WorkflowRunDetailResponseDto>) {
  const runMatch = url.pathname.match(RUN_OVERVIEW_PATH_RE);
  const detail = runMatch?.[1] ? details[runMatch[1]] : undefined;
  return detail ? workflowRunOverviewResponseDto(detail) : undefined;
}

function selectedJobDetailResponse(
  url: URL,
  details: Record<string, WorkflowRunDetailResponseDto>,
) {
  const jobMatch = url.pathname.match(JOB_DETAIL_PATH_RE);
  if (!jobMatch?.[1]) return undefined;
  const detail = details[RUN_ID];
  const job = detail?.jobs.find((candidate) => candidate.id === jobMatch[1]);
  if (!detail || !job) return undefined;
  return workflowJobDetailResponseDto({
    detail,
    jobId: jobMatch[1],
    executionId: url.searchParams.has('execution_id')
      ? url.searchParams.get('execution_id')
      : undefined,
  });
}

function workflowStepLogResponse(url: URL) {
  if (url.pathname === `/steps/${DEPLOY_STEP_ID}/attempts/1/logs`) {
    return inlineLogBody(outputLine('attempt one log\n'), 1);
  }
  if (url.pathname === `/steps/${DEPLOY_STEP_ID}/attempts/2/logs`) {
    return inlineLogBody(outputLine('attempt two log\n'), 1);
  }
  if (url.pathname === `/steps/${DEPLOY_RETRY_STEP_ID}/attempts/1/logs`) {
    return inlineLogBody(outputLine('retry attempt log\n'), 1);
  }
  if (url.pathname === `/steps/${BUILD_STEP_ID}/attempts/1/logs`) {
    return inlineLogBody(outputLine('build log\n'), 1);
  }
  return undefined;
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
        job_executions: [
          workflowJobExecutionDto({
            job_id: BUILD_JOB_ID,
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
            id: DEPLOY_EXECUTION_ID,
            job_id: DEPLOY_JOB_ID,
            status: 'running',
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
      }),
    ],
    ...overrides,
  });
}

function currentSearch({state}: ReturnType<typeof renderRunPath>['router']) {
  return state.location.search as Record<string, unknown>;
}
