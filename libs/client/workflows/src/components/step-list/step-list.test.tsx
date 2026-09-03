import type {StepAttemptDto, WorkflowRunStepDetailDto} from '@shipfox/api-workflows-dto';
import {Text} from '@shipfox/react-ui/typography';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import type {Job} from '#core/workflow-run.js';
import {
  type JobDtoOverrides,
  workflowJob,
  workflowJobExecutionDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {StepList} from './step-list.js';

const LOGS_FOR_RE = /^logs for /u;

describe('StepList', () => {
  test('renders a labelled flat step list', () => {
    render(
      <StepList
        job={makeJob({
          steps: [makeStep({name: 'build', attempts: [makeAttempt({status: 'running'})]})],
        })}
      />,
    );

    expect(screen.getByRole('region', {name: 'build'})).toBeInTheDocument();
    expect(screen.queryByText('1 step')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'build, Running, attempt 1'})).toBeInTheDocument();
    expect(screen.queryByText('Grouped')).not.toBeInTheDocument();
  });

  test('expands and collapses a row without rendering built-in detail content', async () => {
    const user = userEvent.setup();
    render(
      <StepList
        job={makeJob({
          steps: [makeStep({name: 'build', attempts: [makeAttempt({status: 'running'})]})],
        })}
      />,
    );
    const build = screen.getByRole('button', {name: 'build, Running, attempt 1'});

    await user.click(build);

    expect(build).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Source')).not.toBeInTheDocument();

    await user.click(build);

    expect(build).toHaveAttribute('aria-expanded', 'false');
  });

  test('renders expanded slot content with the selected attempt context', async () => {
    const user = userEvent.setup();
    const attempt = makeAttempt({status: 'running'});
    const step = makeStep({
      name: 'deploy',
      status: 'running',
      source_location: {start_line: 4, end_line: 6},
      attempts: [attempt],
    });
    render(
      <StepList
        job={makeJob({steps: [step]})}
        renderExpandedStep={({
          stepId,
          stepLabel,
          sourceLocation,
          attempt,
          attemptId,
          attemptStatus,
        }) => (
          <Text size="sm">
            slot for {stepId} label {stepLabel} lines{' '}
            {sourceLocation ? `${sourceLocation.startLine}-${sourceLocation.endLine}` : 'none'}{' '}
            attempt {attempt} id {attemptId} status {attemptStatus}
          </Text>
        )}
      />,
    );
    const deploy = screen.getByRole('button', {name: 'deploy, Running, attempt 1'});

    await user.click(deploy);

    expect(deploy).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText(
        `slot for ${step.id} label deploy lines 4-6 attempt 1 id ${attempt.id} status running`,
      ),
    ).toBeInTheDocument();
  });

  test('opens the inspector without expanding the step log', async () => {
    const user = userEvent.setup();
    const attempt = makeAttempt({status: 'succeeded'});
    const step = makeStep({name: 'deploy', attempts: [attempt]});

    function InspectableStepList() {
      const [inspectorOpenAttemptId, setInspectorOpenAttemptId] = useState<string | null>(null);

      return (
        <StepList
          job={makeJob({steps: [step]})}
          inspectorOpenAttemptId={inspectorOpenAttemptId}
          onInspectorOpenChange={setInspectorOpenAttemptId}
          renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
          renderInspector={(entry) => <Text size="sm">inspector for {entry.id}</Text>}
        />
      );
    }

    render(<InspectableStepList />);

    const deploy = screen.getByRole('button', {name: 'deploy, Succeeded, attempt 1'});
    await user.click(screen.getByRole('button', {name: 'Inspect deploy, attempt 1'}));

    expect(deploy).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(`logs for ${attempt.id}`)).not.toBeInTheDocument();
    expect(screen.getByText(`inspector for ${attempt.id}`)).toBeInTheDocument();
  });

  test('keeps multiple expanded rows open', async () => {
    const user = userEvent.setup();
    const buildAttempt = makeAttempt({status: 'succeeded'});
    const deployAttempt = makeAttempt({status: 'running'});
    const build = makeStep({name: 'build', attempts: [buildAttempt]});
    const deploy = makeStep({name: 'deploy', position: 1, attempts: [deployAttempt]});
    render(
      <StepList
        job={makeJob({steps: [build, deploy]})}
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );
    const buildRow = screen.getByRole('button', {name: 'build, Succeeded, attempt 1'});
    const deployRow = screen.getByRole('button', {name: 'deploy, Running, attempt 1'});

    await user.click(buildRow);
    await user.click(deployRow);

    expect(buildRow).toHaveAttribute('aria-expanded', 'true');
    expect(deployRow).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(`logs for ${buildAttempt.id}`)).toBeInTheDocument();
    expect(screen.getByText(`logs for ${deployAttempt.id}`)).toBeInTheDocument();
  });

  test('reports the expanded attempt ids as rows change', async () => {
    const user = userEvent.setup();
    const onExpandedAttemptIdsChange = vi.fn();
    const buildAttempt = makeAttempt({status: 'succeeded'});
    const deployAttempt = makeAttempt({status: 'running'});
    const build = makeStep({name: 'build', attempts: [buildAttempt]});
    const deploy = makeStep({name: 'deploy', position: 1, attempts: [deployAttempt]});
    render(
      <StepList
        job={makeJob({steps: [build, deploy]})}
        onExpandedAttemptIdsChange={onExpandedAttemptIdsChange}
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );

    await user.click(screen.getByRole('button', {name: 'build, Succeeded, attempt 1'}));
    expect(onExpandedAttemptIdsChange).toHaveBeenLastCalledWith([buildAttempt.id]);

    await user.click(screen.getByRole('button', {name: 'deploy, Running, attempt 1'}));
    expect(onExpandedAttemptIdsChange).toHaveBeenLastCalledWith([
      buildAttempt.id,
      deployAttempt.id,
    ]);

    await user.click(screen.getByRole('button', {name: 'build, Succeeded, attempt 1'}));
    expect(onExpandedAttemptIdsChange).toHaveBeenLastCalledWith([deployAttempt.id]);
  });

  test('keeps multiple expanded rows open when external attempt selection is singular', async () => {
    const user = userEvent.setup();
    const buildAttempt = makeAttempt({status: 'succeeded'});
    const deployAttempt = makeAttempt({status: 'running'});
    const build = makeStep({name: 'build', attempts: [buildAttempt]});
    const deploy = makeStep({name: 'deploy', position: 1, attempts: [deployAttempt]});
    const job = makeJob({steps: [build, deploy]});

    function ControlledStepList() {
      const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);

      return (
        <StepList
          job={job}
          selectedAttemptId={selectedAttemptId}
          onSelectedAttemptChange={(attemptId) => setSelectedAttemptId(attemptId ?? null)}
          renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
        />
      );
    }

    render(<ControlledStepList />);
    const buildRow = screen.getByRole('button', {name: 'build, Succeeded, attempt 1'});
    const deployRow = screen.getByRole('button', {name: 'deploy, Running, attempt 1'});

    await user.click(buildRow);
    await user.click(deployRow);

    expect(buildRow).toHaveAttribute('aria-expanded', 'true');
    expect(deployRow).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(`logs for ${buildAttempt.id}`)).toBeInTheDocument();
    expect(screen.getByText(`logs for ${deployAttempt.id}`)).toBeInTheDocument();
  });

  test('reports selection changes including collapse', async () => {
    const user = userEvent.setup();
    const onSelectedAttemptChange = vi.fn();
    const attempt = makeAttempt();
    const step = makeStep({name: 'deploy', attempts: [attempt]});
    render(
      <StepList job={makeJob({steps: [step]})} onSelectedAttemptChange={onSelectedAttemptChange} />,
    );
    const deploy = screen.getByRole('button', {name: 'deploy, Pending, attempt 1'});

    await user.click(deploy);
    await user.click(deploy);

    expect(onSelectedAttemptChange).toHaveBeenNthCalledWith(1, attempt.id);
    expect(onSelectedAttemptChange).toHaveBeenNthCalledWith(2, undefined);
  });

  test('keeps row selection singular when no expanded content is rendered', async () => {
    const user = userEvent.setup();
    const buildAttempt = makeAttempt({status: 'succeeded'});
    const deployAttempt = makeAttempt({status: 'running'});
    const build = makeStep({name: 'build', attempts: [buildAttempt]});
    const deploy = makeStep({name: 'deploy', position: 1, attempts: [deployAttempt]});
    render(<StepList job={makeJob({steps: [build, deploy]})} />);
    const buildRow = screen.getByRole('button', {name: 'build, Succeeded, attempt 1'});
    const deployRow = screen.getByRole('button', {name: 'deploy, Running, attempt 1'});

    await user.click(buildRow);
    await user.click(deployRow);

    expect(buildRow.parentElement?.parentElement).not.toHaveClass('bg-background-components-hover');
    expect(deployRow.parentElement?.parentElement).toHaveClass('bg-background-neutral-hover');
  });

  test('opens a default selected attempt', () => {
    const attempt = makeAttempt();
    const step = makeStep({name: 'deploy', attempts: [attempt]});
    render(
      <StepList
        job={makeJob({steps: [step]})}
        defaultSelectedAttemptId={attempt.id}
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );

    expect(screen.getByRole('button', {name: 'deploy, Pending, attempt 1'})).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText(`logs for ${attempt.id}`)).toBeInTheDocument();
  });

  test('starts collapsed for a controlled empty selected attempt', async () => {
    const user = userEvent.setup();
    const onSelectedAttemptChange = vi.fn();
    const attempt = makeAttempt();
    const step = makeStep({name: 'deploy', attempts: [attempt]});
    const job = makeJob({steps: [step]});
    const {rerender} = render(
      <StepList
        job={job}
        defaultSelectedAttemptId={attempt.id}
        selectedAttemptId={attempt.id}
        onSelectedAttemptChange={onSelectedAttemptChange}
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );
    const deploy = screen.getByRole('button', {name: 'deploy, Pending, attempt 1'});
    expect(screen.getByText(`logs for ${attempt.id}`)).toBeInTheDocument();

    rerender(
      <StepList
        job={job}
        defaultSelectedAttemptId={attempt.id}
        selectedAttemptId={null}
        onSelectedAttemptChange={onSelectedAttemptChange}
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );
    expect(screen.queryByText(`logs for ${attempt.id}`)).not.toBeInTheDocument();

    await user.click(deploy);

    expect(screen.getByText(`logs for ${attempt.id}`)).toBeInTheDocument();
    expect(onSelectedAttemptChange).toHaveBeenCalledWith(attempt.id);
  });

  test('auto-opens the latest running attempt', () => {
    const installAttempt = makeAttempt({status: 'running', execution_order: 2});
    const deployAttempt = makeAttempt({status: 'running', execution_order: 4});
    const finishedAttempt = makeAttempt({status: 'succeeded', execution_order: 5});
    render(
      <StepList
        job={makeJob({
          steps: [
            makeStep({
              name: 'install',
              status: 'running',
              attempts: [installAttempt],
            }),
            makeStep({
              name: 'deploy',
              position: 1,
              status: 'running',
              attempts: [deployAttempt],
            }),
            makeStep({
              name: 'notify',
              position: 2,
              status: 'succeeded',
              attempts: [finishedAttempt],
            }),
          ],
        })}
        autoSelectActiveAttempt
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );

    expect(screen.getByRole('button', {name: 'install, Running, attempt 1'})).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', {name: 'deploy, Running, attempt 1'})).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText(`logs for ${deployAttempt.id}`)).toBeInTheDocument();
  });

  test('does not auto-open inspectors for failed landing attempts', async () => {
    const user = userEvent.setup();
    const firstAttempt = makeAttempt({id: 'failed-attempt-first', status: 'failed'});
    const secondAttempt = makeAttempt({id: 'failed-attempt-second', status: 'failed'});
    const firstJob = makeJob({
      id: 'job-first',
      steps: [makeStep({name: 'build', status: 'failed', attempts: [firstAttempt]})],
    });
    const secondJob = makeJob({
      id: 'job-second',
      steps: [makeStep({name: 'deploy', status: 'failed', attempts: [secondAttempt]})],
    });

    function InspectableStepList({job, defaultAttemptId}: {job: Job; defaultAttemptId: string}) {
      const [inspectorOpenAttemptId, setInspectorOpenAttemptId] = useState<string | null>(null);

      return (
        <StepList
          job={job}
          defaultSelectedAttemptId={defaultAttemptId}
          inspectorOpenAttemptId={inspectorOpenAttemptId}
          onInspectorOpenChange={setInspectorOpenAttemptId}
          renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
          renderInspector={(entry) => <Text size="sm">inspector open {entry.id}</Text>}
        />
      );
    }

    const {rerender} = render(
      <InspectableStepList job={firstJob} defaultAttemptId={firstAttempt.id} />,
    );

    expect(screen.queryByText(`inspector open ${firstAttempt.id}`)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {name: `Inspect build, attempt ${firstAttempt.attempt}`}),
    );
    expect(screen.getByText(`inspector open ${firstAttempt.id}`)).toBeInTheDocument();

    rerender(<InspectableStepList job={secondJob} defaultAttemptId={secondAttempt.id} />);

    expect(screen.queryByText(`inspector open ${secondAttempt.id}`)).not.toBeInTheDocument();
  });

  test('does not replace the landing selection when a live job reports a new candidate', () => {
    const firstAttempt = makeAttempt({status: 'running'});
    const secondAttempt = makeAttempt({status: 'running'});
    const firstStep = makeStep({name: 'build', status: 'running', attempts: [firstAttempt]});
    const secondStep = makeStep({
      name: 'deploy',
      position: 1,
      status: 'running',
      attempts: [secondAttempt],
    });
    const job = makeJob({steps: [firstStep, secondStep]});
    const {rerender} = render(
      <StepList
        job={job}
        autoSelectActiveAttempt
        defaultSelectedAttemptId={firstAttempt.id}
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );

    rerender(
      <StepList
        job={job}
        autoSelectActiveAttempt
        defaultSelectedAttemptId={secondAttempt.id}
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );

    expect(screen.getByText(`logs for ${firstAttempt.id}`)).toBeInTheDocument();
    expect(screen.queryByText(`logs for ${secondAttempt.id}`)).not.toBeInTheDocument();
  });

  test('does not auto-open when no attempt is running', () => {
    render(
      <StepList
        job={makeJob({
          steps: [makeStep({name: 'deploy', attempts: [makeAttempt({status: 'succeeded'})]})],
        })}
        autoSelectActiveAttempt
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );

    expect(screen.getByRole('button', {name: 'deploy, Succeeded, attempt 1'})).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText(LOGS_FOR_RE)).not.toBeInTheDocument();
  });

  test('preserves manual collapse across same-job polling and resets on job change', async () => {
    const user = userEvent.setup();
    const attempt = makeAttempt({status: 'running'});
    const step = makeStep({name: 'deploy', status: 'running', attempts: [attempt]});
    const job = makeJob({steps: [step]});
    const {rerender} = render(
      <StepList
        job={job}
        autoSelectActiveAttempt
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );
    const deploy = screen.getByRole('button', {name: 'deploy, Running, attempt 1'});
    expect(screen.getByText(`logs for ${attempt.id}`)).toBeInTheDocument();

    await user.click(deploy);
    rerender(
      <StepList
        job={makeJob({
          id: job.id,
          name: job.name,
          key: job.key,
          status: job.status,
          job_executions: [
            workflowJobExecutionDto({
              id: job.jobExecutions[0]?.id ?? '77777777-7777-4777-8777-000000000001',
              job_id: job.id,
              steps: [step],
            }),
          ],
          updated_at: '2026-06-21T12:02:00.000Z',
        })}
        autoSelectActiveAttempt
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );

    expect(screen.queryByText(`logs for ${attempt.id}`)).not.toBeInTheDocument();

    const nextAttempt = makeAttempt({status: 'running'});
    const nextStep = makeStep({name: 'test', status: 'running', attempts: [nextAttempt]});
    rerender(
      <StepList
        job={makeJob({
          id: '44444444-4444-4444-8444-000000000002',
          name: 'test',
          steps: [nextStep],
        })}
        autoSelectActiveAttempt
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );

    expect(screen.getByText(`logs for ${nextAttempt.id}`)).toBeInTheDocument();
  });

  test('renders each attempt as its own flat row', () => {
    render(
      <StepList
        job={makeJob({
          steps: [
            makeStep({
              name: 'gate',
              status: 'failed',
              error: {message: 'Gate failed', category: 'user', reason: 'agent_invocation_failed'},
              attempts: [
                makeAttempt({attempt: 1, status: 'failed', exit_code: 1}),
                makeAttempt({
                  attempt: 2,
                  status: 'failed',
                  exit_code: 2,
                  restart_feedback: 'retry',
                }),
              ],
            }),
          ],
        })}
      />,
    );

    expect(
      screen.getByRole('button', {
        name: 'gate, Failed, attempt 1, User',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'gate, Failed, attempt 2, User',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('User')).not.toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.queryByText('2 attempts')).not.toBeInTheDocument();
    expect(screen.queryByText('exit 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Restarted')).not.toBeInTheDocument();
    expect(screen.queryByText('Gate failed')).not.toBeInTheDocument();
  });

  test('renders a step footer only after the final non-contiguous attempt', () => {
    const buildFirstAttempt = makeAttempt({
      id: 'build-attempt-first',
      execution_order: 1,
    });
    const deployAttempt = makeAttempt({
      id: 'deploy-attempt',
      execution_order: 2,
    });
    const buildLastAttempt = makeAttempt({
      id: 'build-attempt-last',
      attempt: 2,
      execution_order: 3,
    });
    render(
      <StepList
        job={makeJob({
          steps: [
            makeStep({
              name: 'build',
              attempts: [buildFirstAttempt, buildLastAttempt],
            }),
            makeStep({
              name: 'deploy',
              position: 1,
              attempts: [deployAttempt],
            }),
          ],
        })}
        renderStepFooter={(step) => <Text size="sm">footer {step.name}</Text>}
      />,
    );

    expect(screen.getAllByText('footer build')).toHaveLength(1);
    expect(screen.getAllByText('footer deploy')).toHaveLength(1);
  });

  test('renders finished attempt duration from the step attempt model', () => {
    render(
      <StepList
        job={makeJob({
          steps: [
            makeStep({
              name: 'deploy',
              status: 'succeeded',
              attempts: [
                makeAttempt({
                  status: 'succeeded',
                  started_at: '2026-06-21T12:00:00.000Z',
                  finished_at: '2026-06-21T12:01:05.000Z',
                }),
              ],
            }),
          ],
        })}
      />,
    );

    expect(screen.getByRole('button', {name: 'deploy, Succeeded, attempt 1'})).toBeInTheDocument();
    expect(screen.getByText('1m 05s')).toBeInTheDocument();
  });

  test('omits zero-attempt steps and hides the attempt chip for one-attempt rows', () => {
    render(
      <StepList
        job={makeJob({
          steps: [
            makeStep({name: 'queued', position: 1}),
            makeStep({
              name: 'build',
              position: 2,
              status: 'succeeded',
              attempts: [makeAttempt({attempt: 1, status: 'succeeded'})],
            }),
          ],
        })}
      />,
    );

    expect(screen.queryByRole('button', {name: 'queued, Pending'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'build, Succeeded, attempt 1'})).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
    expect(screen.queryByText('1 attempt')).not.toBeInTheDocument();
  });

  test('defaults to the active execution when no execution is provided', () => {
    render(
      <StepList
        job={makeJob({
          job_executions: [
            workflowJobExecutionDto({
              id: 'execution-1',
              sequence: 1,
              status: 'failed',
              steps: [
                makeStep({
                  name: 'old attempt',
                  attempts: [makeAttempt({status: 'failed'})],
                }),
              ],
            }),
            workflowJobExecutionDto({
              id: 'execution-2',
              sequence: 2,
              status: 'running',
              steps: [
                makeStep({
                  name: 'active attempt',
                  attempts: [makeAttempt({status: 'running'})],
                }),
              ],
            }),
          ],
        })}
      />,
    );

    expect(
      screen.getByRole('button', {name: 'active attempt, Running, attempt 1'}),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'old attempt, Failed, attempt 1'})).toBeNull();
  });

  test('renders an empty state', () => {
    render(<StepList job={makeJob({steps: []})} />);

    expect(screen.getByText('No steps recorded')).toBeInTheDocument();
    expect(screen.getByText('This job has not recorded any steps.')).toBeInTheDocument();
  });

  test('renders a running empty state without the animated status glyph', () => {
    render(
      <StepList
        job={makeJob({status: 'running', steps: []})}
        emptyState={{
          title: 'Waiting for the first step',
          description: 'This job is running, but no steps have started yet.',
          status: 'running',
        }}
      />,
    );

    expect(screen.getByText('Waiting for the first step')).toBeInTheDocument();
    expect(
      screen.getByText('This job is running, but no steps have started yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img', {name: 'Running'})).not.toBeInTheDocument();
  });

  test('renders a skipped empty state with a status glyph', () => {
    render(
      <StepList
        job={makeJob({status: 'skipped', status_reason: 'dependency_not_completed', steps: []})}
        emptyState={{
          title: 'This job was skipped',
          description: 'A required job did not complete, so this job was skipped.',
          status: 'skipped',
        }}
      />,
    );

    expect(screen.getByText('This job was skipped')).toBeInTheDocument();
    expect(
      screen.getByText('A required job did not complete, so this job was skipped.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', {name: 'Skipped'})).toBeInTheDocument();
  });

  test('renders a cancelled empty state with distinct copy', () => {
    render(
      <StepList
        job={makeJob({status: 'cancelled', steps: []})}
        emptyState={{
          title: 'Cancelled before start',
          description: 'This job was cancelled before any step started.',
          status: 'cancelled',
        }}
      />,
    );

    expect(screen.getByText('Cancelled before start')).toBeInTheDocument();
    expect(screen.getByText('This job was cancelled before any step started.')).toBeInTheDocument();
    expect(screen.getByRole('img', {name: 'Cancelled'})).toBeInTheDocument();
  });

  test('keeps long labels accessible', () => {
    const name = 'release-production-multi-region-with-canary-and-smoke-tests';
    render(<StepList job={makeJob({steps: [makeStep({name, attempts: [makeAttempt()]})]})} />);

    expect(screen.getByRole('button', {name: `${name}, Pending, attempt 1`})).toBeInTheDocument();
  });

  test('uses the catalog provider name in tool row semantics', () => {
    render(
      <StepList
        job={makeJob({
          steps: [
            makeStep({
              name: 'Post release notice',
              type: 'tool',
              config: {
                tool: {
                  provider: 'github',
                  connection_slug: 'release-notifications',
                  id: 'chat_post_message',
                  sensitivity: 'write',
                },
              },
              attempts: [makeAttempt({status: 'succeeded'})],
            }),
          ],
        })}
      />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Post release notice, Succeeded, attempt 1, GitHub integration',
      }),
    ).toBeInTheDocument();
  });
});

function makeJob(overrides: JobDtoOverrides = {}): Job {
  return workflowJob(overrides);
}

function makeStep(overrides: Partial<WorkflowRunStepDetailDto> = {}): WorkflowRunStepDetailDto {
  return workflowStepDto(overrides);
}

function makeAttempt(overrides: Partial<StepAttemptDto> = {}): StepAttemptDto {
  return workflowStepAttemptDto(overrides);
}
