import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {workflowRunDetailDto} from '#test/fixtures/workflow-run.js';
import {workflowJobDto, workflowRunDetail} from '#test/fixtures/workflow-run.js';
import {WorkflowRunSummary} from './workflow-run-summary.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const RELATIVE_TIME_TEXT_PATTERN = /ago$/;
const OLD_ROOT_TIME_TEXT_PATTERN = /(?:1d|24h) ago/;
const COPY_RUN_BUTTON_NAME = /Copy run/;

const originalScrollWidth = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  'scrollWidth',
);
const originalClientWidth = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  'clientWidth',
);

beforeEach(() => {
  setElementWidths({scrollWidth: 80, clientWidth: 120});
});

describe('WorkflowRunSummary', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    restoreElementWidthDescriptors();
  });

  test('renders status, trigger metadata, and trigger time', async () => {
    renderSummary();

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).getByRole('heading', {name: 'deploy-web'})).toBeInTheDocument();
    expect(within(summary).getAllByText('Running')).not.toHaveLength(0);
    expect(within(summary).getByText('fire')).toBeInTheDocument();
    expect(within(summary).queryByText('manual')).not.toBeInTheDocument();
    expect(within(summary).getByText(RELATIVE_TIME_TEXT_PATTERN)).toBeInTheDocument();
    expect(within(summary).queryByText('Triggered')).not.toBeInTheDocument();
    expect(within(summary).queryByText('Updated')).not.toBeInTheDocument();
    expect(
      within(summary).queryByRole('button', {name: COPY_RUN_BUTTON_NAME}),
    ).not.toBeInTheDocument();
  });

  test('uses the selected run attempt for summary status and trigger time', async () => {
    const rootCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const attemptCreatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    renderSummary({
      created_at: rootCreatedAt,
      run_attempt: {
        id: '22222222-2222-4222-8222-222222222222',
        workflow_run_id: RUN_ID,
        attempt: 2,
        status: 'failed',
        created_at: attemptCreatedAt,
        started_at: null,
        finished_at: null,
        rerun_mode: 'all',
      },
    });

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(
      within(summary).queryByRole('button', {name: COPY_RUN_BUTTON_NAME}),
    ).not.toBeInTheDocument();
    expect(within(summary).getAllByText('Failed')).not.toHaveLength(0);
    expect(within(summary).getByText('5m ago')).toBeInTheDocument();
    expect(within(summary).queryByText(OLD_ROOT_TIME_TEXT_PATTERN)).not.toBeInTheDocument();
  });

  test('omits empty trigger metadata', async () => {
    renderSummary({trigger_source: '', trigger_event: ''});

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByText('fire')).not.toBeInTheDocument();
  });

  test('does not show a run name tooltip when the heading is not truncated', async () => {
    const user = userEvent.setup();
    renderSummary();

    await user.hover(await screen.findByRole('heading', {name: 'deploy-web'}));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('wires the full run name tooltip when the heading is truncated', async () => {
    const runName = 'release-production-multi-region-with-canary-and-smoke-tests';
    setElementWidths({scrollWidth: 160, clientWidth: 80});
    renderSummary({name: runName});

    const heading = await screen.findByRole('heading', {name: runName});

    expect(heading).toHaveAttribute('data-slot', 'tooltip-trigger');
    await waitFor(() =>
      expect(within(heading).getByText(runName)).toHaveAttribute('title', runName),
    );
  });

  test('renders source control only when source is available', async () => {
    const user = userEvent.setup();
    const onSourceToggle = vi.fn();
    renderSummary(
      {source_snapshot: {format: 'yaml', content: 'name: deploy-web'}},
      {
        sourceAvailable: true,
        sourceOpen: false,
        sourcePanelId: 'workflow-source-panel',
        onSourceToggle,
      },
    );

    const sourceButton = await screen.findByRole('button', {name: 'View source'});
    await user.click(sourceButton);

    expect(sourceButton).toHaveAttribute('aria-controls', 'workflow-source-panel');
    expect(sourceButton).toHaveAttribute('aria-expanded', 'false');
    expect(onSourceToggle).toHaveBeenCalledTimes(1);
  });

  test('shows the selected attempt duration, not the top-level run duration', async () => {
    renderSummary({
      started_at: '2026-05-07T00:00:00.000Z',
      finished_at: '2026-05-07T00:10:00.000Z',
      run_attempt: {
        id: '11111111-1111-4111-8111-000000000001',
        workflow_run_id: RUN_ID,
        attempt: 1,
        status: 'succeeded',
        created_at: '2026-05-07T01:01:00.000Z',
        started_at: '2026-05-07T01:00:00.000Z',
        finished_at: '2026-05-07T01:02:14.000Z',
        rerun_mode: null,
      },
    });

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.getByText('2m 14s')).toBeInTheDocument();
    expect(screen.queryByText('10m 00s')).not.toBeInTheDocument();
  });

  test('shows a live selected attempt duration for running runs', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-05-07T01:02:14.000Z'));
    renderSummary({
      run_attempt: {
        id: '11111111-1111-4111-8111-000000000001',
        workflow_run_id: RUN_ID,
        attempt: 1,
        status: 'running',
        created_at: '2026-05-07T01:01:00.000Z',
        started_at: '2026-05-07T01:00:00.000Z',
        finished_at: null,
        rerun_mode: null,
      },
    });

    await screen.findByRole('region', {name: 'deploy-web'});

    const duration = screen.getByText('2m 14s');
    expect(duration).toBeInTheDocument();
    expect(duration).toHaveAttribute('aria-label', 'running 2m 14s');
  });

  test('omits source control when source is unavailable', async () => {
    renderSummary();

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByRole('button', {name: 'View source'})).not.toBeInTheDocument();
  });

  test('shows the cancel action when the run can be cancelled', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderSummary({}, {onCancel});

    await user.click(await screen.findByRole('button', {name: 'Cancel workflow'}));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('omits the cancel action for terminal runs', async () => {
    renderSummary({status: 'succeeded'});

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByRole('button', {name: 'Cancel workflow'})).not.toBeInTheDocument();
  });

  test('disables the cancel action while cancellation is pending', async () => {
    renderSummary({}, {cancelling: true, onCancel: vi.fn()});

    const button = await screen.findByRole('button', {name: 'Cancel workflow'});
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  test('hides the cancel action when no cancel handler is provided', async () => {
    renderSummary({status: 'running'});

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByRole('button', {name: 'Cancel workflow'})).not.toBeInTheDocument();
  });

  test('derives the cancel action for non-terminal runs', async () => {
    const onCancel = vi.fn();
    const onRerun = vi.fn();
    renderSummary({status: 'running'}, {onCancel, onRerun});

    await screen.findByRole('button', {name: 'Cancel workflow'});

    expect(screen.queryByRole('button', {name: 'Re-run workflow'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Re-run jobs'})).not.toBeInTheDocument();
  });

  test('re-runs all jobs from a succeeded run', async () => {
    const user = userEvent.setup();
    const onRerun = vi.fn();
    renderSummary({status: 'succeeded'}, {onRerun});

    await user.click(await screen.findByRole('button', {name: 'Re-run workflow'}));

    expect(onRerun).toHaveBeenCalledWith('all');
  });

  test('hides the re-run action when no re-run handler is provided', async () => {
    renderSummary({status: 'succeeded'});

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByRole('button', {name: 'Re-run workflow'})).not.toBeInTheDocument();
  });

  test('shows re-run choices for a failed run', async () => {
    const user = userEvent.setup();
    const onRerun = vi.fn();
    renderSummary({status: 'failed', jobs: [workflowJobDto({status: 'failed'})]}, {onRerun});

    await user.click(await screen.findByRole('button', {name: 'Re-run jobs'}));
    expect(await screen.findByRole('menuitem', {name: 'Re-run all jobs'})).toBeInTheDocument();
    await user.click(await screen.findByRole('menuitem', {name: 'Re-run failed jobs'}));

    expect(onRerun).toHaveBeenCalledWith('failed');
  });

  test('shows re-run choices for a cancelled run', async () => {
    const user = userEvent.setup();
    const onRerun = vi.fn();
    renderSummary({status: 'cancelled', jobs: [workflowJobDto({status: 'cancelled'})]}, {onRerun});

    await user.click(await screen.findByRole('button', {name: 'Re-run jobs'}));

    expect(await screen.findByRole('menuitem', {name: 'Re-run all jobs'})).toBeInTheDocument();
    expect(screen.getByRole('menuitem', {name: 'Re-run failed jobs'})).toBeInTheDocument();
  });

  test('re-runs the full workflow when a failed run has no failed jobs', async () => {
    const user = userEvent.setup();
    const onRerun = vi.fn();
    renderSummary({status: 'failed', jobs: [workflowJobDto({status: 'succeeded'})]}, {onRerun});

    await user.click(await screen.findByRole('button', {name: 'Re-run workflow'}));

    expect(screen.queryByRole('button', {name: 'Re-run jobs'})).not.toBeInTheDocument();
    expect(onRerun).toHaveBeenCalledWith('all');
  });

  test('hides run actions when viewing a historical attempt', async () => {
    renderSummary(
      {
        status: 'failed',
        current_attempt: 2,
        run_attempt: {
          id: '11111111-1111-4111-8111-000000000001',
          workflow_run_id: RUN_ID,
          attempt: 1,
          status: 'failed',
          created_at: '2026-05-07T01:01:00.000Z',
          started_at: null,
          finished_at: null,
          rerun_mode: null,
        },
        jobs: [workflowJobDto({status: 'failed'})],
      },
      {onCancel: vi.fn(), onRerun: vi.fn()},
    );

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByRole('button', {name: 'Cancel workflow'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Re-run workflow'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Re-run jobs'})).not.toBeInTheDocument();
  });
});

function renderSummary(
  overrides: Parameters<typeof workflowRunDetailDto>[0] = {},
  props: Omit<Parameters<typeof WorkflowRunSummary>[0], 'run'> = {},
) {
  const run = workflowRunDetail({
    id: RUN_ID,
    project_id: '44444444-4444-4444-8444-444444444444',
    definition_id: '55555555-5555-4555-8555-555555555555',
    name: 'deploy-web',
    status: 'running',
    trigger_source: 'manual',
    trigger_event: 'fire',
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    ...overrides,
  });

  // These cases never mount the attempt switcher links, so no router is needed.
  render(<WorkflowRunSummary run={run} {...props} />);
}

function setElementWidths({scrollWidth, clientWidth}: {scrollWidth: number; clientWidth: number}) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      return scrollWidth;
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return clientWidth;
    },
  });
}

function restoreElementWidthDescriptors() {
  restoreElementWidthDescriptor('scrollWidth', originalScrollWidth);
  restoreElementWidthDescriptor('clientWidth', originalClientWidth);
}

function restoreElementWidthDescriptor(
  property: 'scrollWidth' | 'clientWidth',
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(window.HTMLElement.prototype, property, descriptor);
    return;
  }
  delete window.HTMLElement.prototype[property];
}
