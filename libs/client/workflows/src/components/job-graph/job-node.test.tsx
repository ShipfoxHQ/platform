import type {WorkflowRunJobDetailDto} from '@shipfox/api-workflows-dto';
import {TimeTickerProvider} from '@shipfox/react-ui/time-ticker';
import {act, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {workflowJob, workflowJobExecutionDto} from '#test/fixtures/workflow-run.js';
import type {JobGraphNode} from './graph-model.js';
import {JobNode} from './job-node.js';

const NOW = Date.parse('2026-06-26T12:00:00.000Z');

type NodeOverrides = Omit<Partial<WorkflowRunJobDetailDto>, 'job_executions'> & {
  name: string;
  job_executions?: WorkflowRunJobDetailDto['job_executions'];
  queued_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

function makeNode(overrides: NodeOverrides): JobGraphNode {
  const {queued_at, started_at, finished_at, job_executions, ...jobOverrides} = overrides;
  const shouldCreateExecution =
    job_executions === undefined &&
    (queued_at !== undefined || started_at !== undefined || finished_at !== undefined);
  const jobOverrideWithExecutions: NodeOverrides = {...jobOverrides};
  if (shouldCreateExecution) {
    jobOverrideWithExecutions.job_executions = [
      workflowJobExecutionDto({
        ...(jobOverrides.id === undefined ? {} : {job_id: jobOverrides.id}),
        ...(jobOverrides.status === undefined
          ? {}
          : {status: jobOverrides.status === 'skipped' ? 'cancelled' : jobOverrides.status}),
        queued_at: queued_at ?? null,
        started_at: started_at ?? null,
        finished_at: finished_at ?? null,
      }),
    ];
  } else if (job_executions !== undefined) {
    jobOverrideWithExecutions.job_executions = job_executions;
  }
  const job = workflowJob(jobOverrideWithExecutions);
  return Object.assign(Object.create(Object.getPrototypeOf(job)), job, {
    column: 0,
    row: 0,
    currentDependencyCount: 0,
  });
}

function renderNode(node: JobGraphNode, {live = false}: {live?: boolean} = {}) {
  const element = (
    <JobNode
      node={node}
      selected={false}
      onSelect={() => undefined}
      onKeyDown={() => undefined}
      onHoverStart={() => undefined}
      onHoverEnd={() => undefined}
    />
  );

  if (live) {
    return render(<TimeTickerProvider intervalMs={1000}>{element}</TimeTickerProvider>);
  }

  return render(element);
}

function setMatchMedia(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('reduce') ? reduced : query.includes('min-width'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {configurable: true, value: state});
}

describe('JobNode duration', () => {
  beforeEach(() => {
    setMatchMedia(false);
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setMatchMedia(false);
    setVisibility('visible');
  });

  test('shows the static span for a finished job', () => {
    const node = makeNode({
      name: 'build',
      status: 'succeeded',
      started_at: '2026-06-26T11:57:46.000Z',
      finished_at: '2026-06-26T12:00:00.000Z',
    });

    renderNode(node);

    expect(screen.getByText('2m 14s')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'build, Succeeded, ran 2m 14s'})).toBeInTheDocument();
  });

  test('clamps a skewed finished span (finishedAt before startedAt) to 0s', () => {
    const node = makeNode({
      name: 'build',
      status: 'succeeded',
      started_at: '2026-06-26T12:00:00.000Z',
      finished_at: '2026-06-26T11:59:55.000Z',
    });

    renderNode(node);

    expect(screen.getByText('0s')).toBeInTheDocument();
  });

  test('shows no duration for a skipped job that never executed', () => {
    const node = makeNode({name: 'lint', status: 'skipped'});

    renderNode(node);

    // Exact accessible name proves no duration phrase was appended.
    expect(screen.getByRole('button', {name: 'lint, Skipped'})).toBeInTheDocument();
  });

  test('shows live elapsed from startedAt for a running job', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const node = makeNode({
      name: 'test',
      status: 'running',
      queued_at: '2026-06-26T11:54:00.000Z',
      started_at: '2026-06-26T11:57:46.000Z',
    });

    renderNode(node);

    expect(screen.getByText('2m 14s')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'test, Running, running 2m 14s'})).toBeInTheDocument();
  });

  test('keeps live accessible duration in sync with visible duration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const node = makeNode({
      name: 'test',
      status: 'running',
      queued_at: '2026-06-26T11:54:00.000Z',
      started_at: '2026-06-26T11:57:46.000Z',
    });

    renderNode(node, {live: true});

    expect(screen.getByText('2m 14s')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'test, Running, running 2m 14s'})).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('2m 15s')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'test, Running, running 2m 15s'})).toBeInTheDocument();
  });

  test('shows live elapsed from queuedAt for a job waiting in the queue', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const node = makeNode({
      name: 'deploy',
      status: 'pending',
      queued_at: '2026-06-26T11:54:00.000Z',
      started_at: null,
    });

    renderNode(node);

    expect(screen.getByText('6m 00s')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: 'deploy, Pending, queueing 6m 00s'}),
    ).toBeInTheDocument();
  });

  test('does not show a duration for listening jobs', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const node = makeNode({
      name: 'deploy-window',
      mode: 'listening',
      status: 'running',
      listener_status: 'listening',
    });

    renderNode(node);

    expect(screen.queryByText('2m 14s')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'deploy-window, Running'})).toBeInTheDocument();
  });
});

describe('JobNode listening indicator', () => {
  beforeEach(() => {
    setMatchMedia(false);
    setVisibility('visible');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false);
    setVisibility('visible');
  });

  test('shows active listening jobs through the status icon', async () => {
    const user = userEvent.setup();
    const node = makeNode({
      name: 'deploy-window',
      mode: 'listening',
      status: 'running',
      listener_status: 'listening',
    });

    renderNode(node);

    expect(screen.getByRole('button', {name: 'deploy-window, Running'})).toBeInTheDocument();
    expect(screen.queryByLabelText('Waiting for events to start job')).not.toBeInTheDocument();

    await user.hover(screen.getByRole('img', {name: 'Running'}));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Running');
  });

  test('does not show the listener icon before the listener is armed or after it resolves', () => {
    const pendingNode = makeNode({
      name: 'release-gates',
      mode: 'listening',
      status: 'pending',
      listener_status: 'inactive',
    });
    const resolvedNode = makeNode({
      name: 'release-gates',
      mode: 'listening',
      status: 'succeeded',
      listener_status: 'resolved',
    });

    const {unmount} = renderNode(pendingNode);
    expect(screen.queryByLabelText('Waiting for events to start job')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'release-gates, Pending'})).toBeInTheDocument();
    unmount();

    renderNode(resolvedNode);
    expect(screen.queryByLabelText('Waiting for events to start job')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'release-gates, Succeeded'})).toBeInTheDocument();
  });
});

describe('JobNode status indicator', () => {
  beforeEach(() => {
    setMatchMedia(false);
    setVisibility('visible');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false);
    setVisibility('visible');
  });

  test('shows a tooltip with the human-readable job status', async () => {
    const user = userEvent.setup();
    const node = makeNode({
      name: 'deploy',
      status: 'running',
    });

    renderNode(node);

    await user.hover(screen.getByRole('img', {name: 'Running'}));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Running');
  });

  test('shows a running execution as running while the job is still pending', () => {
    const node = makeNode({
      name: 'deploy',
      status: 'pending',
      job_executions: [workflowJobExecutionDto({status: 'running'})],
    });

    renderNode(node);

    expect(screen.getByRole('button', {name: 'deploy, Running'})).toBeInTheDocument();
  });
});

describe('JobNode execution count indicator', () => {
  beforeEach(() => {
    setMatchMedia(false);
    setVisibility('visible');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false);
    setVisibility('visible');
  });

  test('shows a muted execution count with status tooltip', async () => {
    const user = userEvent.setup();
    const node = makeNode({
      name: 'release-gates',
      mode: 'listening',
      status: 'running',
      job_executions: [
        workflowJobExecutionDto({status: 'pending'}),
        workflowJobExecutionDto({status: 'running'}),
        workflowJobExecutionDto({status: 'running'}),
        workflowJobExecutionDto({status: 'succeeded'}),
        workflowJobExecutionDto({status: 'succeeded'}),
        workflowJobExecutionDto({status: 'succeeded'}),
        workflowJobExecutionDto({status: 'failed'}),
        workflowJobExecutionDto({status: 'cancelled'}),
      ],
    });

    renderNode(node);

    const button = screen.getByRole('button', {name: 'release-gates, Running, 8 executions'});
    expect(within(button).getByText('8')).toBeInTheDocument();
    expect(within(button).queryByText('8 exec')).not.toBeInTheDocument();
    expect(button.querySelector('[data-execution-status-segment]')).not.toBeInTheDocument();

    await user.hover(within(button).getByText('8'));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      '1 pending, 2 running, 3 succeeded, 1 failed, 1 cancelled',
    );
  });

  test('hides the execution badge when there are no executions', () => {
    const node = makeNode({
      name: 'release-gates',
      mode: 'listening',
      status: 'pending',
      job_executions: [],
    });

    renderNode(node);

    const button = screen.getByRole('button', {name: 'release-gates, Pending'});
    expect(within(button).queryByText('0')).not.toBeInTheDocument();
  });
});
