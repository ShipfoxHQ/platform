import {type StepAttemptDto, workflowRunStatusSchema} from '@shipfox/api-workflows-dto';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import type {Job} from '#core/workflow-run.js';
import type {WorkflowStepFixtureDto} from '#test/fixtures/workflow-run.js';
import {
  type JobDtoOverrides,
  workflowJob,
  workflowJobExecutionDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {buildStepListModel, getStepStatusVisual, humanizeStatus} from './step-list-model.js';

describe('buildStepListModel', () => {
  test('sorts steps by position and uses display names before fallback labels', () => {
    const second = makeStep({
      key: 'deploy',
      name: 'deploy',
      position: 2,
      attempts: [makeAttempt({execution_order: 2})],
    });
    const first = makeStep({
      key: null,
      name: 'npm test',
      position: 1,
      config: {run: 'npm test'},
      attempts: [makeAttempt({execution_order: 1})],
    });
    const unnamed = makeStep({
      key: '',
      name: '',
      position: 3,
      attempts: [makeAttempt({execution_order: 3})],
    });

    const result = buildStepListModel({job: makeJob({steps: [second, first, unnamed]})});

    expect(result.entries.map((entry) => entry.step.label)).toEqual([
      'npm test',
      'deploy',
      'Step 3',
    ]);
  });

  test('uses backend display labels for unnamed setup, run, and agent steps', () => {
    const setup = makeStep({
      key: null,
      name: 'Set up job',
      type: 'setup',
      attempts: [makeAttempt()],
    });
    const run = makeStep({
      key: null,
      name: 'pnpm test',
      position: 1,
      type: 'run',
      config: {run: 'pnpm test\npnpm build'},
      attempts: [makeAttempt()],
    });
    const agent = makeStep({
      key: null,
      name: 'claude-opus-4-8 · Fix the failing tests.',
      position: 2,
      type: 'agent',
      config: {model: 'claude-opus-4-8', prompt: 'Fix the failing tests.\nKeep it small.'},
      attempts: [makeAttempt()],
    });

    const result = buildStepListModel({job: makeJob({steps: [setup, run, agent]})});

    expect(result.entries.map((entry) => entry.step.label)).toEqual([
      'Set up job',
      'pnpm test',
      'claude-opus-4-8 · Fix the failing tests.',
    ]);
  });

  test('falls back to the source name when the display label is empty', () => {
    const step = makeStep({key: 'lint', name: '', attempts: [makeAttempt()]});

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[0]?.step.label).toBe('lint');
  });

  test('uses a generic fallback when display name and source name are empty', () => {
    const custom = makeStep({
      key: null,
      name: '',
      type: 'deploy',
      attempts: [makeAttempt()],
    });

    const result = buildStepListModel({job: makeJob({steps: [custom]})});

    expect(result.entries[0]?.step.label).toBe('Step 1');
  });

  test('omits steps without attempts from the flat attempt list', () => {
    const attempted = makeStep({name: 'build', attempts: [makeAttempt()]});
    const pending = makeStep({name: 'deploy', position: 1});

    const result = buildStepListModel({job: makeJob({steps: [attempted, pending]})});

    expect(result.entries.map((entry) => entry.step.label)).toEqual(['build']);
  });

  test('does not land on a failed entry when no attempt is running', () => {
    const step = makeStep({
      attempts: [
        makeAttempt({attempt: 1, status: 'failed'}),
        makeAttempt({attempt: 2, status: 'succeeded'}),
      ],
    });

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.activeEntryId).toBeUndefined();
  });

  test('uses the latest running attempt by execution order as the active entry', () => {
    const earlier = makeAttempt({status: 'running', execution_order: 2});
    const later = makeAttempt({status: 'running', execution_order: 4});
    const finished = makeAttempt({status: 'succeeded', execution_order: 5});

    const result = buildStepListModel({
      job: makeJob({
        steps: [
          makeStep({name: 'install', status: 'running', attempts: [earlier]}),
          makeStep({name: 'deploy', position: 1, status: 'running', attempts: [later]}),
          makeStep({name: 'notify', position: 2, status: 'succeeded', attempts: [finished]}),
        ],
      }),
    });

    expect(result.entries.map((entry) => entry.id)).toEqual([earlier.id, later.id, finished.id]);
    expect(result.activeEntryId).toBe(later.id);
  });

  test('defaults to the running execution when no execution is provided', () => {
    const failedStep = makeStep({
      name: 'old attempt',
      attempts: [makeAttempt({status: 'failed'})],
    });
    const runningStep = makeStep({
      name: 'active attempt',
      attempts: [makeAttempt({status: 'running'})],
    });

    const result = buildStepListModel({
      job: makeJob({
        job_executions: [
          workflowJobExecutionDto({
            id: 'execution-1',
            sequence: 1,
            status: 'failed',
            steps: [failedStep],
          }),
          workflowJobExecutionDto({
            id: 'execution-2',
            sequence: 2,
            status: 'running',
            steps: [runningStep],
          }),
        ],
      }),
    });

    expect(result.jobExecutionId).toBe('execution-2');
    expect(result.entries[0]?.step.label).toBe('active attempt');
  });

  test('defaults to the highest sequence execution when none are running', () => {
    const firstStep = makeStep({
      name: 'first attempt',
      attempts: [makeAttempt({status: 'failed'})],
    });
    const latestStep = makeStep({
      name: 'latest attempt',
      attempts: [makeAttempt({status: 'succeeded'})],
    });

    const result = buildStepListModel({
      job: makeJob({
        job_executions: [
          workflowJobExecutionDto({
            id: 'execution-1',
            sequence: 1,
            status: 'failed',
            steps: [firstStep],
          }),
          workflowJobExecutionDto({
            id: 'execution-3',
            sequence: 3,
            status: 'succeeded',
            steps: [latestStep],
          }),
          workflowJobExecutionDto({id: 'execution-2', sequence: 2, status: 'cancelled'}),
        ],
      }),
    });

    expect(result.jobExecutionId).toBe('execution-3');
    expect(result.entries[0]?.step.label).toBe('latest attempt');
  });

  test('breaks active running-attempt execution-order ties by sorted entry order', () => {
    const first = makeAttempt({attempt: 1, execution_order: 7, status: 'running'});
    const second = makeAttempt({attempt: 2, execution_order: 7, status: 'running'});
    const step = makeStep({attempts: [second, first]});

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries.map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(result.activeEntryId).toBe(second.id);
  });

  test.each(
    workflowRunStatusSchema.options,
  )('maps the %s step status through the shared visual', (status) => {
    const visual = getStepStatusVisual(status);

    expect(visual).toEqual({...getWorkflowStatusVisual(status), ripple: status === 'running'});
  });

  test('humanizes unknown snake_case and kebab-case statuses without throwing', () => {
    expect(humanizeStatus('custom_blocked_state')).toBe('Custom blocked state');
    expect(humanizeStatus('custom-blocked-state')).toBe('Custom blocked state');
    expect(getStepStatusVisual('custom_blocked_state')).toMatchObject({
      label: 'Custom blocked state',
      dot: 'neutral',
    });
  });

  test('preserves sorted attempt fields and visual status', () => {
    const step = makeStep({
      attempts: [
        makeAttempt({attempt: 2, execution_order: 2, status: 'succeeded'}),
        makeAttempt({attempt: 1, execution_order: 1, status: 'failed', exit_code: 1}),
      ],
    });

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.attempt)).toEqual([1, 2]);
    expect(result.entries[1]).toMatchObject({
      attempt: 2,
      statusVisual: {label: 'Succeeded'},
    });
  });

  test('orders flattened attempts by backend execution order', () => {
    const step1 = makeStep({
      name: 'step-1',
      position: 0,
      attempts: [makeAttempt({attempt: 1, execution_order: 1, status: 'succeeded'})],
    });
    const step2 = makeStep({
      name: 'step-2',
      position: 1,
      attempts: [
        makeAttempt({attempt: 1, execution_order: 2, status: 'failed'}),
        makeAttempt({attempt: 2, execution_order: 4, status: 'succeeded'}),
      ],
    });
    const step3 = makeStep({
      name: 'step-3',
      position: 2,
      attempts: [
        makeAttempt({attempt: 1, execution_order: 3, status: 'failed'}),
        makeAttempt({attempt: 2, execution_order: 5, status: 'succeeded'}),
      ],
    });
    const step4 = makeStep({
      name: 'step-4',
      position: 3,
      attempts: [makeAttempt({attempt: 1, execution_order: 6, status: 'succeeded'})],
    });

    const result = buildStepListModel({
      job: makeJob({steps: [step1, step2, step3, step4]}),
    });

    expect(result.entries.map((entry) => `${entry.step.label}#${entry.attempt}`)).toEqual([
      'step-1#1',
      'step-2#1',
      'step-3#1',
      'step-2#2',
      'step-3#2',
      'step-4#1',
    ]);
  });

  test('shows restart feedback from the typed top-level attempt field', () => {
    const step = makeStep({
      attempts: [
        makeAttempt({attempt: 1}),
        makeAttempt({attempt: 2, restart_feedback: 'gate-opened'}),
      ],
    });

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[1]).toMatchObject({restartFeedback: 'gate-opened'});
  });

  test('exposes typed step error metadata without parsing opaque attempt blobs', () => {
    const step = makeStep({
      status: 'failed',
      error: {
        message: 'Checkout failed',
        category: 'setup',
        reason: 'checkout_failed',
      },
      attempts: [
        makeAttempt({
          error: {message: 'Opaque nested value', exitCode: 127},
          output: {tail: 'do not parse'},
          gate_result: {kind: 'unknown', data: {status: 'do not parse'}},
        }),
      ],
    });

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[0]?.step.error).toStrictEqual({
      message: 'Checkout failed',
      exitCode: null,
      signal: undefined,
      category: 'setup',
      reason: 'checkout_failed',
      agentConfigIssue: undefined,
    });
    expect(result.entries[0]?.error).toEqual({message: 'Opaque nested value', exitCode: 127});
    expect(result.entries[0]?.output).toEqual({tail: 'do not parse'});
    expect(result.entries[0]?.gateResult).toEqual({
      kind: 'unknown',
      data: {status: 'do not parse'},
    });
  });

  test('does not infer setup classification from step names', () => {
    const step = makeStep({
      name: 'checkout repository',
      type: 'checkout',
      attempts: [makeAttempt()],
    });

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[0]?.step.error).toBeNull();
  });
});

function makeJob(overrides: JobDtoOverrides = {}): Job {
  return workflowJob(overrides);
}

function makeStep(overrides: Partial<WorkflowStepFixtureDto> = {}): WorkflowStepFixtureDto {
  return workflowStepDto(overrides);
}

function makeAttempt(overrides: Partial<StepAttemptDto> = {}): StepAttemptDto {
  return workflowStepAttemptDto(overrides);
}
