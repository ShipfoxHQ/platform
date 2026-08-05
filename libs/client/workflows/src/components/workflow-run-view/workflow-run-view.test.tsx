import type {WorkflowRunDetailResponseDto} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  workflowJobDto,
  workflowRunDetailDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {jsonResponse, PROJECT_TEST_WSLUG, renderProjectPage} from '#test/pages.js';
import {WorkflowRunView} from './workflow-run-view.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const BUILD_JOB_ID = '77777777-7777-4777-8777-777777777777';
const DEPLOY_JOB_ID = '88888888-8888-4888-8888-888888888888';

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
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(workflowRunViewDetailDto()))),
    });

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
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(workflowRunViewDetailDto()))),
    });

    renderView({tab: 'jobs'});

    expect(await screen.findByRole('region', {name: 'All jobs summary'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Summary'})).toHaveAttribute('aria-current', 'page');
  });

  test('navigates graph and rail jobs to their dedicated job routes', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(workflowRunViewDetailDto()))),
    });

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
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(workflowRunViewDetailDto()))),
    });

    const {router} = renderView();
    await screen.findByRole('region', {name: 'Workflow jobs'});
    await user.click(screen.getByRole('link', {name: 'Annotations'}));

    await waitFor(() => expect(router.state.location.search).toMatchObject({tab: 'annotations'}));
  });

  test('filters the single run-level Annotations page by job', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(workflowRunViewDetailDto()))),
    });

    renderView({tab: 'annotations', selection: {jobId: BUILD_JOB_ID}});

    expect(
      await screen.findByRole('combobox', {name: 'Filter annotations by job'}),
    ).toHaveTextContent('build');
    expect(screen.getByText('build has no annotations to show in this run.')).toBeInTheDocument();
    expect(screen.queryByRole('tab', {name: 'Annotations'})).not.toBeInTheDocument();
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
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(workflowRunViewDetailDto()))),
    });

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
        steps: [workflowStepDto({name: 'checkout', status: 'succeeded'})],
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
