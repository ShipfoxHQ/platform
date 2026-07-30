import type {
  JobStatusDto,
  StepAttemptDto,
  WorkflowRunAttemptDto,
  WorkflowRunAttemptsResponseDto,
  WorkflowRunDetailResponseDto,
  WorkflowRunJobDetailDto,
  WorkflowRunJobExecutionDetailDto,
  WorkflowRunListResponseDto,
  WorkflowRunResponseDto,
  WorkflowRunStatusDto,
  WorkflowRunStepDetailDto,
} from '@shipfox/api-workflows-dto';
import type {
  Job,
  Step,
  StepAttempt,
  WorkflowRunDetail,
  WorkflowRunListItem,
  WorkflowRunListPage,
} from '#core/workflow-run.js';
import {
  toJob,
  toStep,
  toStepAttempt,
  toWorkflowRunDetail,
  toWorkflowRunListItem,
  toWorkflowRunListPage,
} from '#hooks/api/workflow-run-mapper.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ATTEMPT_ID = '11111111-1111-4111-8111-111111111112';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-000000000001';
const JOB_EXECUTION_ID = '77777777-7777-4777-8777-000000000001';
const STEP_ID = '55555555-5555-4555-8555-000000000001';

let runSequence = 0;
let jobSequence = 0;
let jobExecutionSequence = 0;
let stepSequence = 0;
let attemptSequence = 0;

export type JobDtoOverrides = Partial<Omit<WorkflowRunJobDetailDto, 'job_executions'>> & {
  job_executions?: WorkflowRunJobDetailDto['job_executions'];
  steps?: WorkflowRunStepDetailDto[];
};

type JobDtoBase = Omit<WorkflowRunJobDetailDto, 'job_executions'>;

export function workflowRunDto(
  overrides: Partial<WorkflowRunResponseDto> = {},
): WorkflowRunResponseDto {
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    definition_id: DEFINITION_ID,
    name: 'deploy-web',
    workflow_name: 'deploy-web',
    status: 'running',
    current_attempt: 1,
    latest_attempt: 1,
    trigger_provider: null,
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {},
    inputs: null,
    source_snapshot: null,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

export function workflowRunListItem(
  overrides: Partial<WorkflowRunResponseDto> = {},
): WorkflowRunListItem {
  return toWorkflowRunListItem(
    workflowRunDto({
      workflow_name: overrides.workflow_name ?? overrides.name ?? 'deploy-web',
      ...overrides,
    }),
  );
}

export function workflowRunListResponseDto(
  overrides: Partial<WorkflowRunListResponseDto> = {},
): WorkflowRunListResponseDto {
  return {
    runs: [workflowRunDto()],
    next_cursor: null,
    filtered_total_count: 1,
    ...overrides,
  };
}

export function workflowRunListPage(
  overrides: Partial<WorkflowRunListResponseDto> = {},
): WorkflowRunListPage {
  return toWorkflowRunListPage(workflowRunListResponseDto(overrides));
}

export function workflowRunDetailDto(
  overrides: Partial<WorkflowRunDetailResponseDto> = {},
): WorkflowRunDetailResponseDto {
  const {jobs, run_attempt: runAttemptOverride, ...runOverrides} = overrides;
  const run = workflowRunDto(runOverrides);

  return {
    ...run,
    latest_attempt: run.latest_attempt,
    run_attempt:
      runAttemptOverride ??
      workflowRunAttemptDto({
        workflow_run_id: run.id,
        attempt: run.current_attempt,
        status: run.status,
        started_at: run.started_at,
        finished_at: run.finished_at,
      }),
    jobs: jobs ?? [],
  };
}

export function workflowRunDetail(
  overrides: Partial<WorkflowRunDetailResponseDto> = {},
): WorkflowRunDetail {
  return toWorkflowRunDetail(workflowRunDetailDto(overrides));
}

export function workflowRunAttemptDto(
  overrides: Partial<WorkflowRunAttemptDto> = {},
): WorkflowRunAttemptDto {
  return {
    id: RUN_ATTEMPT_ID,
    workflow_run_id: RUN_ID,
    attempt: 1,
    status: 'running',
    created_at: '2026-06-21T12:00:00.000Z',
    started_at: null,
    finished_at: null,
    rerun_mode: null,
    ...overrides,
  };
}

export function runAttemptsResponseDto(
  overrides: Partial<WorkflowRunAttemptsResponseDto> = {},
): WorkflowRunAttemptsResponseDto {
  return {
    attempts: [workflowRunAttemptDto()],
    ...overrides,
  };
}

export function workflowJobDto(overrides: JobDtoOverrides = {}): WorkflowRunJobDetailDto {
  jobSequence += 1;
  const {job_executions, steps, ...jobOverrides} = overrides;
  const key =
    jobOverrides.key ?? (typeof jobOverrides.name === 'string' ? jobOverrides.name : 'build');
  const job: JobDtoBase = {
    id: `44444444-4444-4444-8444-${String(jobSequence).padStart(12, '0')}`,
    run_attempt_id: RUN_ID,
    key,
    name: null,
    mode: 'one_shot',
    status: 'pending',
    status_reason: null,
    carried_over: false,
    listening: null,
    listener_status: 'inactive',
    resolution_reason: null,
    outputs: null,
    dependencies: [],
    position: 0,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    ...jobOverrides,
  };

  return {
    ...job,
    job_executions:
      job_executions ?? (steps ? [workflowJobExecutionDto({job_id: job.id, steps})] : []),
  };
}

export function workflowJob(overrides: JobDtoOverrides = {}): Job {
  return toJob(workflowJobDto(overrides));
}

export function workflowJobExecutionDto(
  overrides: Partial<WorkflowRunJobExecutionDetailDto> = {},
): WorkflowRunJobExecutionDetailDto {
  jobExecutionSequence += 1;
  const id =
    overrides.id ?? `77777777-7777-4777-8777-${String(jobExecutionSequence).padStart(12, '0')}`;
  const {steps: overrideSteps, ...restOverrides} = overrides;
  const steps = overrideSteps?.map((step) => ({...step, job_execution_id: id})) ?? [];

  return {
    id,
    job_id: JOB_ID,
    sequence: 1,
    name: 'build',
    status: 'pending',
    status_reason: null,
    trigger_events: [],
    outputs: null,
    queued_at: null,
    started_at: null,
    finished_at: null,
    timed_out_at: null,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    steps,
    ...restOverrides,
  };
}

export function workflowStepDto(
  overrides: Partial<WorkflowRunStepDetailDto> = {},
): WorkflowRunStepDetailDto {
  stepSequence += 1;

  return {
    id: `55555555-5555-4555-8555-${String(stepSequence).padStart(12, '0')}`,
    job_execution_id: JOB_EXECUTION_ID,
    key: 'build',
    name: 'build',
    source_location: null,
    status: 'pending',
    type: 'run',
    config: {},
    error: null,
    position: 0,
    current_attempt: 1,
    exit_code: null,
    outputs: null,
    response: null,
    gate_result: null,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    attempts: [],
    ...overrides,
  };
}

export function workflowStep(overrides: Partial<WorkflowRunStepDetailDto> = {}): Step {
  return toStep(workflowStepDto(overrides));
}

export function workflowStepAttemptDto(overrides: Partial<StepAttemptDto> = {}): StepAttemptDto {
  attemptSequence += 1;
  return {
    id: `66666666-6666-4666-8666-${String(attemptSequence).padStart(12, '0')}`,
    step_id: STEP_ID,
    attempt: 1,
    execution_order: attemptSequence,
    status: 'pending',
    exit_code: null,
    output: null,
    outputs: null,
    response: null,
    error: null,
    gate_result: null,
    restart_feedback: null,
    started_at: '2026-06-21T12:00:00.000Z',
    finished_at: null,
    ...overrides,
  };
}

export function workflowStepAttempt(overrides: Partial<StepAttemptDto> = {}): StepAttempt {
  return toStepAttempt(workflowStepAttemptDto(overrides), JOB_EXECUTION_ID);
}

export function sequencedWorkflowRunDto(
  status: WorkflowRunStatusDto,
  name: string,
  minutesAgo: number,
  overrides: Partial<WorkflowRunResponseDto> = {},
): WorkflowRunResponseDto {
  runSequence += 1;
  return workflowRunDto({
    id: `run-${String(runSequence).padStart(8, '0')}`,
    project_id: 'proj-demo',
    definition_id: 'def-demo',
    name,
    workflow_name: name,
    status,
    trigger_provider: status === 'pending' ? null : 'github',
    trigger_source: status === 'pending' ? '' : 'github_acme',
    trigger_event: status === 'pending' ? '' : 'push',
    created_at: new Date(Date.now() - minutesAgo * 120_000).toISOString(),
    updated_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    ...overrides,
  });
}

export function sequencedWorkflowRunListItem(
  status: WorkflowRunStatusDto,
  name: string,
  minutesAgo: number,
  overrides: Partial<WorkflowRunResponseDto> = {},
): WorkflowRunListItem {
  return toWorkflowRunListItem(sequencedWorkflowRunDto(status, name, minutesAgo, overrides));
}

export function workflowJobWithName(
  name: string,
  overrides: JobDtoOverrides = {},
): WorkflowRunJobDetailDto {
  return workflowJobDto({name, ...overrides});
}

export type {JobStatusDto, WorkflowRunStatusDto};
