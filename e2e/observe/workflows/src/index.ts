import type {
  TriggerEventDetailResponseDto,
  TriggerEventListResponseDto,
} from '@shipfox/api-triggers-dto';
import type {
  JobExecutionSummaryDto,
  StepAttemptDetailResponseDto,
  StepAttemptSummaryDto,
  StepGateResultDto,
  StepGateResultSummaryDto,
  StepSummaryDto,
  WorkflowExecutionEventDto,
  WorkflowJobDetailDto,
  WorkflowJobExecutionContextResponseDto,
  WorkflowJobExecutionDetailDto,
  WorkflowJobExecutionSummariesResponseDto,
  WorkflowRunAttemptDto,
  WorkflowRunJobListSummaryDto,
  WorkflowRunJobOverviewDto,
  WorkflowRunLineageHeadResponseDto,
  WorkflowRunListItemDto,
  WorkflowRunListResponseDto,
  WorkflowRunOverviewHeaderDto,
  WorkflowRunOverviewJobsResponseDto,
  WorkflowRunOverviewResponseDto,
  WorkflowRunStatusDto,
} from '@shipfox/api-workflows-dto';
import type {ApiFetch} from '@shipfox/e2e-core';
import {createApiClient as makeApiClient, pollUntil} from '@shipfox/e2e-core';

const DEFAULT_LIST_TIMEOUT_MS = 60_000;
const DEFAULT_TERMINAL_TIMEOUT_MS = 180_000;
const DEFAULT_INITIAL_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 4_000;
const DEFAULT_BACKOFF_FACTOR = 1.5;
const TERMINAL_STATUSES = new Set<WorkflowRunStatusDto>(['succeeded', 'failed', 'cancelled']);

type ApiClient = ReturnType<typeof makeApiClient>;

/** The bounded resources an observer may materialize for one run attempt. */
export interface WorkflowRunObservationSelection {
  jobs?: readonly WorkflowJobObservationSelection[] | undefined;
}

export interface WorkflowJobObservationSelection {
  jobKey: string;
  /** Omit execution resources when only the compact job status is asserted. */
  includeDefaultExecution?: boolean | undefined;
  /** `all` follows execution cursors until the assertion has enough history. */
  executionSequences?: readonly number[] | 'all' | undefined;
  /** Fetch context only when an assertion needs outputs or trigger events. */
  includeContext?: boolean | undefined;
  /** Fetch step summaries and diagnostics only for these keys or names. */
  stepKeys?: readonly string[] | undefined;
  /** Fetch selected attempt details, rather than only the current attempt. */
  stepAttempts?: readonly number[] | 'all' | undefined;
  /** Stop an `all` execution traversal as soon as this assertion matches. */
  executionMatches?: ((execution: WorkflowExecutionObservation) => boolean) | undefined;
}

export interface WorkflowStepObservation extends Omit<StepSummaryDto, 'attempts'> {
  /** Compact attempt history is normalized from the cursor page. */
  attempts: StepAttemptSummaryDto[];
  /** The selected attempt diagnostic fields are absent from compact summaries. */
  attempt_details: StepAttemptDetailResponseDto[];
  exit_code: number | null;
  outputs: Record<string, unknown> | null;
  response: string | null;
  gate_result: StepGateResultDto | StepGateResultSummaryDto | null;
  session: StepAttemptDetailResponseDto['session'];
}

export interface WorkflowExecutionObservation extends JobExecutionSummaryDto {
  job_id: string;
  runner: string[] | null;
  outputs: Record<string, unknown> | null;
  trigger_events: WorkflowExecutionEventDto[];
  context: WorkflowJobExecutionContextResponseDto | null;
  steps: WorkflowStepObservation[];
}

export interface WorkflowJobObservation {
  id: string;
  key: string;
  name: string | null;
  position: number;
  status: WorkflowRunJobOverviewDto['status'];
  status_reason: WorkflowRunJobOverviewDto['status_reason'];
  mode: WorkflowRunJobOverviewDto['mode'];
  listener_status: WorkflowRunJobOverviewDto['listener_status'];
  carried_over: boolean;
  execution_count: WorkflowRunJobOverviewDto['execution_count'];
  execution_status_counts: WorkflowRunJobOverviewDto['execution_status_counts'];
  default_execution: WorkflowRunJobOverviewDto['default_execution'];
  executions: WorkflowExecutionObservation[];
}

/**
 * A presentation-neutral E2E observation assembled from bounded resources.
 * `jobs` contains compact summaries for the observed overview page; execution,
 * step, attempt, and context data is present only when selected by the caller.
 */
export interface WorkflowRunObservation extends WorkflowRunOverviewHeaderDto {
  status: WorkflowRunStatusDto;
  current_attempt: number;
  latest_attempt: number;
  updated_at: string;
  attempt: WorkflowRunAttemptDto;
  has_started_job_execution: boolean;
  jobs: WorkflowJobObservation[];
}

interface PollingOptions {
  apiUrl?: string | undefined;
  backoffFactor?: number | undefined;
  fetch?: ApiFetch | undefined;
  initialDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  token: string;
}

export interface WaitForRunByCommitOptions extends PollingOptions {
  headCommitSha: string;
  projectId: string;
}

export interface WaitForRunByDeliveryIdOptions extends PollingOptions {
  deliveryId: string;
  projectId: string;
  workspaceId: string;
}

export interface ObserveRunOptions extends PollingOptions {
  runId: string;
  attempt?: number | undefined;
  selection?: WorkflowRunObservationSelection | undefined;
}

export interface WaitForRunTerminalOptions extends ObserveRunOptions {}

interface ResourceTracker {
  last: string;
  deadline?: number | undefined;
}

function headCommitSha(run: WorkflowRunListItemDto): string | null {
  return run.trigger_reference?.commit ?? null;
}

function formatRunListObserved(
  response: WorkflowRunListResponseDto | null,
  expected: string,
  runField: (run: WorkflowRunListItemDto) => string,
): string {
  if (!response) return 'no workflow run list response observed';
  const runs = response.runs
    .slice(0, 5)
    .map((run) =>
      [
        `id=${run.id}`,
        `status=${run.status}`,
        `trigger=${run.trigger_source}/${run.trigger_event}`,
        runField(run),
        `updatedAt=${run.updated_at}`,
      ].join(' '),
    );
  const more = response.runs.length > runs.length ? ', ...' : '';
  return `${expected} runs=[${runs.join(', ')}${more}]`;
}

function formatRunObservationObserved(
  lineage: WorkflowRunLineageHeadResponseDto | null,
  overview: WorkflowRunOverviewResponseDto | null,
  runId: string,
  lastResource: string,
): string {
  if (!lineage && !overview) {
    return `runId=${runId} lastBoundedResource=${lastResource} no workflow overview observed`;
  }
  return [
    `runId=${runId}`,
    `status=${overview?.attempt.status ?? lineage?.current_status ?? 'null'}`,
    `currentAttempt=${lineage?.current_attempt ?? overview?.attempt.attempt ?? 'null'}`,
    `latestAttempt=${lineage?.latest_attempt ?? 'null'}`,
    `updatedAt=${lineage?.updated_at ?? 'null'}`,
    `lastBoundedResource=${lastResource}`,
  ].join(' ');
}

function assertWithinDeadline(tracker: ResourceTracker, label: string): void {
  if (tracker.deadline !== undefined && Date.now() > tracker.deadline) {
    throw new Error(`Timed out while reading ${label}; last bounded resource=${tracker.last}`);
  }
}

async function requestBounded<T>(
  client: ApiClient,
  tracker: ResourceTracker,
  label: string,
  path: string,
  signal: AbortSignal | undefined,
): Promise<T> {
  assertWithinDeadline(tracker, label);
  tracker.last = label;
  return await client.requestJson<T>('get', path, {signal});
}

function queryPath(path: string, params?: URLSearchParams): string {
  const query = params?.toString();
  return query ? `${path}?${query}` : path;
}

async function waitForRunMatching(
  options: PollingOptions & {
    expected: string;
    match: (run: WorkflowRunListItemDto) => boolean;
    projectId: string;
    runField: (run: WorkflowRunListItemDto) => string;
    timeoutMessage: string;
  },
): Promise<WorkflowRunListItemDto> {
  const client = makeApiClient({
    apiUrl: options.apiUrl,
    fetch: options.fetch,
    token: options.token,
  });
  const timeoutMs = options.timeoutMs ?? DEFAULT_LIST_TIMEOUT_MS;
  let lastResponse: WorkflowRunListResponseDto | null = null;

  return await pollUntil<WorkflowRunListItemDto>(
    {
      timeoutMs,
      intervalMs: options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
      maxIntervalMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
      backoffFactor: options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR,
      ...(options.signal ? {signal: options.signal} : {}),
      describe: () =>
        `${options.timeoutMessage}: ${formatRunListObserved(
          lastResponse,
          options.expected,
          options.runField,
        )}`,
    },
    async () => {
      options.signal?.throwIfAborted();
      const params = new URLSearchParams({project_id: options.projectId, limit: '100'});
      lastResponse = await client.requestJson<WorkflowRunListResponseDto>(
        'get',
        `/workflows/runs?${params}`,
        {signal: options.signal},
      );

      return lastResponse.runs.find(options.match) ?? null;
    },
  );
}

export async function waitForRunByCommit(
  options: WaitForRunByCommitOptions,
): Promise<WorkflowRunListItemDto> {
  return await waitForRunMatching({
    ...options,
    expected: `expectedHeadCommitSha=${options.headCommitSha}`,
    match: (run) => headCommitSha(run) === options.headCommitSha,
    runField: (run) => `headCommitSha=${headCommitSha(run) ?? 'null'}`,
    timeoutMessage: 'Timed out waiting for workflow run by commit',
  });
}

export async function waitForRunByDeliveryId(
  options: WaitForRunByDeliveryIdOptions,
): Promise<WorkflowRunListItemDto> {
  const client = makeApiClient({
    apiUrl: options.apiUrl,
    fetch: options.fetch,
    token: options.token,
  });
  const timeoutMs = options.timeoutMs ?? DEFAULT_LIST_TIMEOUT_MS;
  let lastResponse: TriggerEventListResponseDto | null = null;

  return await pollUntil<WorkflowRunListItemDto>(
    {
      timeoutMs,
      intervalMs: options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
      maxIntervalMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
      backoffFactor: options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR,
      ...(options.signal ? {signal: options.signal} : {}),
      describe: () =>
        `Timed out waiting for workflow run by delivery ID: ${formatTriggerEventsObserved(
          lastResponse,
          `expectedDeliveryId=${options.deliveryId}`,
        )}`,
    },
    async () => {
      options.signal?.throwIfAborted();
      const params = new URLSearchParams({workspace_id: options.workspaceId, limit: '100'});
      lastResponse = await client.requestJson<TriggerEventListResponseDto>(
        'get',
        `/trigger-events?${params}`,
        {signal: options.signal},
      );

      const event = lastResponse.trigger_events.find(
        (candidate) => candidate.delivery_id === options.deliveryId,
      );
      if (!event) return null;

      const detail = await client.requestJson<TriggerEventDetailResponseDto>(
        'get',
        `/trigger-events/${encodeURIComponent(event.id)}`,
        {signal: options.signal},
      );
      const runId = detail.decisions.find(
        (decision) =>
          decision.project_id === options.projectId &&
          decision.decision === 'triggered' &&
          decision.run_id !== null,
      )?.run_id;
      if (runId === undefined || runId === null) return null;

      const runParams = new URLSearchParams({project_id: options.projectId, limit: '100'});
      const runs = await client.requestJson<WorkflowRunListResponseDto>(
        'get',
        `/workflows/runs?${runParams}`,
        {signal: options.signal},
      );
      return runs.runs.find((run) => run.id === runId) ?? null;
    },
  );
}

function formatTriggerEventsObserved(
  response: TriggerEventListResponseDto | null,
  expected: string,
): string {
  if (!response) return `${expected} no trigger event list response observed`;
  const events = response.trigger_events
    .slice(0, 5)
    .map((event) => `deliveryId=${event.delivery_id ?? 'null'}`);
  const more = response.trigger_events.length > events.length ? ', ...' : '';
  return `${expected} triggerEvents=[${events.join(', ')}${more}]`;
}

async function readRunBase(options: {
  client: ApiClient;
  runId: string;
  attempt: number | undefined;
  signal: AbortSignal | undefined;
  tracker: ResourceTracker;
}): Promise<{
  lineage: WorkflowRunLineageHeadResponseDto;
  overview: WorkflowRunOverviewResponseDto;
}> {
  const lineage = await requestBounded<WorkflowRunLineageHeadResponseDto>(
    options.client,
    options.tracker,
    'workflow run lineage head',
    `/workflows/runs/${encodeURIComponent(options.runId)}/head`,
    options.signal,
  );
  const attempt = options.attempt ?? lineage.current_attempt;
  const query = new URLSearchParams({attempt: String(attempt)});
  const overview = await requestBounded<WorkflowRunOverviewResponseDto>(
    options.client,
    options.tracker,
    `workflow run overview attempt ${attempt}`,
    queryPath(`/workflows/runs/${encodeURIComponent(options.runId)}/overview`, query),
    options.signal,
  );
  return {lineage, overview};
}

function toJobObservation(
  job: WorkflowRunJobOverviewDto | WorkflowRunJobListSummaryDto,
): WorkflowJobObservation {
  return {
    id: job.id,
    key: job.key,
    name: job.name,
    position: job.position,
    status: job.status,
    status_reason: job.status_reason,
    mode: job.mode,
    listener_status: job.listener_status,
    carried_over: job.carried_over,
    execution_count: job.execution_count,
    execution_status_counts: job.execution_status_counts,
    default_execution: job.default_execution,
    executions: [],
  };
}

function initialOverviewJobs(
  overview: WorkflowRunOverviewResponseDto,
): Array<WorkflowRunJobOverviewDto | WorkflowRunJobListSummaryDto> {
  return overview.jobs.kind === 'complete' ? overview.jobs.items : overview.jobs.first_page.items;
}

async function readOverviewJobs(options: {
  client: ApiClient;
  runId: string;
  attempt: number;
  overview: WorkflowRunOverviewResponseDto;
  selection: readonly WorkflowJobObservationSelection[] | undefined;
  signal: AbortSignal | undefined;
  tracker: ResourceTracker;
}): Promise<Map<string, WorkflowJobObservation>> {
  const jobs = new Map<string, WorkflowJobObservation>();
  for (const job of initialOverviewJobs(options.overview)) {
    jobs.set(job.key, toJobObservation(job));
  }

  const requiredKeys = new Set(options.selection?.map((selection) => selection.jobKey) ?? []);
  for (const key of jobs.keys()) requiredKeys.delete(key);

  let cursor =
    options.overview.jobs.kind === 'large' ? options.overview.jobs.first_page.next_cursor : null;
  const seenCursors = new Set<string>();
  while (requiredKeys.size > 0 && cursor !== null) {
    if (seenCursors.has(cursor)) {
      throw new Error(
        `Repeated workflow run job cursor while reading bounded job summaries; last bounded resource=${options.tracker.last}`,
      );
    }
    seenCursors.add(cursor);
    const query = new URLSearchParams({
      attempt: String(options.attempt),
      limit: '100',
      cursor,
    });
    const page = await requestBounded<WorkflowRunOverviewJobsResponseDto>(
      options.client,
      options.tracker,
      `workflow run job summaries cursor ${cursor}`,
      queryPath(`/workflows/runs/${encodeURIComponent(options.runId)}/jobs`, query),
      options.signal,
    );
    for (const job of page.items) {
      jobs.set(job.key, toJobObservation(job));
      requiredKeys.delete(job.key);
    }
    cursor = page.next_cursor;
  }

  if (requiredKeys.size > 0) {
    throw new Error(
      `Requested workflow run job keys were not found in bounded overview pages: ${[
        ...requiredKeys,
      ].join(', ')}; last bounded resource=${options.tracker.last}`,
    );
  }

  return jobs;
}

function selectionForJob(
  selections: readonly WorkflowJobObservationSelection[] | undefined,
  jobKey: string,
): WorkflowJobObservationSelection | undefined {
  return selections?.find((selection) => selection.jobKey === jobKey);
}

async function readJobDetail(options: {
  client: ApiClient;
  jobId: string;
  executionId?: string | undefined;
  signal: AbortSignal | undefined;
  tracker: ResourceTracker;
}): Promise<WorkflowJobDetailDto> {
  const query =
    options.executionId === undefined
      ? undefined
      : new URLSearchParams({execution_id: options.executionId});
  return await requestBounded<WorkflowJobDetailDto>(
    options.client,
    options.tracker,
    `workflow job ${options.jobId} detail${options.executionId === undefined ? '' : ` execution ${options.executionId}`}`,
    queryPath(`/workflows/runs/jobs/${encodeURIComponent(options.jobId)}`, query),
    options.signal,
  );
}

async function readStepPages(options: {
  client: ApiClient;
  jobId: string;
  executionId: string;
  initial: WorkflowJobExecutionDetailDto['steps'];
  stepKeys: readonly string[] | undefined;
  stepAttempts: readonly number[] | 'all' | undefined;
  signal: AbortSignal | undefined;
  tracker: ResourceTracker;
}): Promise<StepSummaryDto[]> {
  const steps = [...options.initial.items];
  const requiredKeys = new Set(options.stepKeys ?? []);
  for (const step of steps) {
    if (step.key !== null) requiredKeys.delete(step.key);
    requiredKeys.delete(step.name);
  }

  const shouldReadAllSteps = shouldReadAllStepPages(options.stepKeys, options.stepAttempts);
  let cursor = initialStepPageCursor(
    options.stepKeys,
    shouldReadAllSteps,
    options.initial.next_cursor,
  );
  const seenCursors = new Set<string>();
  while (hasRemainingStepPages(requiredKeys, shouldReadAllSteps, cursor)) {
    if (seenCursors.has(cursor)) {
      throw new Error(
        `Repeated workflow execution step cursor; last bounded resource=${options.tracker.last}`,
      );
    }
    seenCursors.add(cursor);
    const query = new URLSearchParams({limit: '100', cursor});
    const page = await requestBounded<{items: StepSummaryDto[]; next_cursor: string | null}>(
      options.client,
      options.tracker,
      `workflow execution ${options.executionId} step summaries cursor ${cursor}`,
      queryPath(
        `/workflows/runs/jobs/${encodeURIComponent(options.jobId)}/executions/${encodeURIComponent(options.executionId)}/steps`,
        query,
      ),
      options.signal,
    );
    steps.push(...page.items);
    for (const step of page.items) {
      if (step.key !== null) requiredKeys.delete(step.key);
      requiredKeys.delete(step.name);
    }
    cursor = page.next_cursor;
  }

  if (options.stepKeys === undefined) return steps;
  const selectedKeys = new Set(options.stepKeys);
  return steps.filter(
    (step) => (step.key !== null && selectedKeys.has(step.key)) || selectedKeys.has(step.name),
  );
}

function shouldReadAllStepPages(
  stepKeys: readonly string[] | undefined,
  stepAttempts: readonly number[] | 'all' | undefined,
): boolean {
  return stepKeys === undefined && stepAttempts !== undefined;
}

function initialStepPageCursor(
  stepKeys: readonly string[] | undefined,
  shouldReadAllSteps: boolean,
  cursor: string | null,
): string | null {
  if (stepKeys === undefined && !shouldReadAllSteps) return null;
  return cursor;
}

function hasRemainingStepPages(
  requiredKeys: Set<string>,
  shouldReadAllSteps: boolean,
  cursor: string | null,
): cursor is string {
  return cursor !== null && (shouldReadAllSteps || requiredKeys.size > 0);
}

async function readStepAttemptSummaries(options: {
  client: ApiClient;
  stepId: string;
  initial: StepSummaryDto['attempts'];
  signal: AbortSignal | undefined;
  tracker: ResourceTracker;
}): Promise<StepAttemptSummaryDto[]> {
  const attempts = [...options.initial.items];
  let cursor = options.initial.next_cursor;
  const seenCursors = new Set<string>();
  while (cursor !== null) {
    if (seenCursors.has(cursor)) {
      throw new Error(
        `Repeated workflow step-attempt cursor; last bounded resource=${options.tracker.last}`,
      );
    }
    seenCursors.add(cursor);
    const query = new URLSearchParams({limit: '100', cursor});
    const page = await requestBounded<{
      items: StepAttemptSummaryDto[];
      next_cursor: string | null;
    }>(
      options.client,
      options.tracker,
      `workflow step ${options.stepId} attempt summaries cursor ${cursor}`,
      queryPath(`/workflows/runs/steps/${encodeURIComponent(options.stepId)}/attempts`, query),
      options.signal,
    );
    attempts.push(...page.items);
    cursor = page.next_cursor;
  }
  return attempts;
}

async function readStepObservation(options: {
  client: ApiClient;
  step: StepSummaryDto;
  stepAttempts: readonly number[] | 'all' | undefined;
  signal: AbortSignal | undefined;
  tracker: ResourceTracker;
}): Promise<WorkflowStepObservation> {
  let attemptSummaries: StepAttemptSummaryDto[];
  if (options.stepAttempts === 'all') {
    attemptSummaries = await readStepAttemptSummaries({
      client: options.client,
      stepId: options.step.id,
      initial: options.step.attempts,
      signal: options.signal,
      tracker: options.tracker,
    });
  } else {
    attemptSummaries = [...options.step.attempts.items];
  }

  const currentSummary = attemptSummaries.find(
    (attempt) => attempt.attempt === options.step.current_attempt,
  );
  let attemptNumbers: readonly number[];
  if (options.stepAttempts === 'all') {
    attemptNumbers = attemptSummaries.map((attempt) => attempt.attempt);
  } else if (options.stepAttempts !== undefined) {
    attemptNumbers = options.stepAttempts;
  } else {
    attemptNumbers = currentSummary === undefined ? [] : [options.step.current_attempt];
  }

  const details = await Promise.all(
    attemptNumbers.map((attempt) =>
      requestBounded<StepAttemptDetailResponseDto>(
        options.client,
        options.tracker,
        `workflow step ${options.step.id} attempt ${attempt} detail`,
        `/workflows/runs/steps/${encodeURIComponent(options.step.id)}/attempts/${attempt}`,
        options.signal,
      ),
    ),
  );
  const current = details.find((detail) => detail.attempt === options.step.current_attempt);

  return {
    ...options.step,
    attempts: attemptSummaries,
    attempt_details: details,
    exit_code: currentSummary?.exit_code ?? null,
    outputs: current?.outputs ?? null,
    response: current?.response ?? null,
    gate_result: current?.gate_result ?? currentSummary?.gate_result ?? null,
    session: current?.session,
  };
}

async function readExecutionObservation(options: {
  client: ApiClient;
  jobId: string;
  execution: JobExecutionSummaryDto;
  jobDetail?: WorkflowJobExecutionDetailDto | undefined;
  selection: WorkflowJobObservationSelection;
  signal: AbortSignal | undefined;
  tracker: ResourceTracker;
}): Promise<WorkflowExecutionObservation> {
  const detail =
    options.jobDetail ??
    (
      await readJobDetail({
        client: options.client,
        jobId: options.jobId,
        executionId: options.execution.id,
        signal: options.signal,
        tracker: options.tracker,
      })
    ).selected_execution;

  let context: WorkflowJobExecutionContextResponseDto | null = null;
  if (options.selection.includeContext === true && detail?.has_context === true) {
    context = await requestBounded<WorkflowJobExecutionContextResponseDto>(
      options.client,
      options.tracker,
      `workflow job execution ${options.execution.id} context`,
      `/workflows/runs/jobs/${encodeURIComponent(options.jobId)}/executions/${encodeURIComponent(options.execution.id)}/context`,
      options.signal,
    );
  }

  const shouldReadSteps =
    detail !== null &&
    ((options.selection.stepKeys?.length ?? 0) > 0 || options.selection.stepAttempts !== undefined);
  const steps = shouldReadSteps
    ? await readStepPages({
        client: options.client,
        jobId: options.jobId,
        executionId: options.execution.id,
        initial: detail.steps,
        stepKeys: options.selection.stepKeys,
        stepAttempts: options.selection.stepAttempts,
        signal: options.signal,
        tracker: options.tracker,
      }).then((items) =>
        Promise.all(
          items.map((step) =>
            readStepObservation({
              client: options.client,
              step,
              stepAttempts: options.selection.stepAttempts,
              signal: options.signal,
              tracker: options.tracker,
            }),
          ),
        ),
      )
    : [];

  return {
    ...options.execution,
    job_id: options.jobId,
    runner: context?.execution_runner ?? null,
    outputs: context?.execution_outputs ?? null,
    trigger_events: context?.trigger_events ?? [],
    context,
    steps,
  };
}

function assertNewCursor(
  cursor: string | null,
  seenCursors: Set<string>,
  tracker: ResourceTracker,
): void {
  if (cursor !== null && seenCursors.has(cursor)) {
    throw new Error(
      `Repeated workflow job execution cursor; last bounded resource=${tracker.last}`,
    );
  }
  if (cursor !== null) seenCursors.add(cursor);
}

async function readExecutionSummaryPage(options: {
  client: ApiClient;
  jobId: string;
  cursor: string | null;
  signal: AbortSignal | undefined;
  tracker: ResourceTracker;
}): Promise<WorkflowJobExecutionSummariesResponseDto> {
  const query = new URLSearchParams({limit: '25'});
  if (options.cursor !== null) query.set('cursor', options.cursor);
  return await requestBounded<WorkflowJobExecutionSummariesResponseDto>(
    options.client,
    options.tracker,
    `workflow job ${options.jobId} execution summaries${options.cursor === null ? '' : ` cursor ${options.cursor}`}`,
    queryPath(`/workflows/runs/jobs/${encodeURIComponent(options.jobId)}/executions`, query),
    options.signal,
  );
}

function selectedExecutionSummaries(
  items: JobExecutionSummaryDto[],
  wanted: Set<number> | undefined,
  excludedExecutionId: string | undefined,
): JobExecutionSummaryDto[] {
  return items.filter(
    (execution) =>
      execution.id !== excludedExecutionId &&
      (wanted === undefined || wanted.has(execution.sequence)),
  );
}

function hasAllRequestedExecutions(
  observations: WorkflowExecutionObservation[],
  wanted: Set<number> | undefined,
): boolean {
  return (
    wanted !== undefined &&
    [...wanted].every((sequence) =>
      observations.some((execution) => execution.sequence === sequence),
    )
  );
}

function hasMatchingExecution(
  observations: WorkflowExecutionObservation[],
  matcher: ((execution: WorkflowExecutionObservation) => boolean) | undefined,
): boolean {
  return matcher !== undefined && observations.some(matcher);
}

async function readExecutionSummaries(options: {
  client: ApiClient;
  jobId: string;
  sequences: readonly number[] | 'all';
  selection: WorkflowJobObservationSelection;
  preloadedExecutions?: readonly WorkflowExecutionObservation[] | undefined;
  excludedExecutionId?: string | undefined;
  signal: AbortSignal | undefined;
  tracker: ResourceTracker;
}): Promise<WorkflowExecutionObservation[]> {
  const wanted = options.sequences === 'all' ? undefined : new Set(options.sequences);
  const observations = [...(options.preloadedExecutions ?? [])];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();

  for (;;) {
    assertNewCursor(cursor, seenCursors, options.tracker);
    const page = await readExecutionSummaryPage({
      client: options.client,
      jobId: options.jobId,
      cursor,
      signal: options.signal,
      tracker: options.tracker,
    });

    const pageItems = selectedExecutionSummaries(page.items, wanted, options.excludedExecutionId);
    const pageObservations = await Promise.all(
      pageItems.map((execution) =>
        readExecutionObservation({
          client: options.client,
          jobId: options.jobId,
          execution,
          selection: options.selection,
          signal: options.signal,
          tracker: options.tracker,
        }),
      ),
    );
    observations.push(...pageObservations);

    if (hasMatchingExecution(observations, options.selection.executionMatches)) break;
    if (hasAllRequestedExecutions(observations, wanted)) break;
    cursor = page.next_cursor;
    if (cursor === null) break;
  }

  return observations.sort((left, right) => left.sequence - right.sequence);
}

async function readJobObservation(options: {
  client: ApiClient;
  job: WorkflowJobObservation;
  selection: WorkflowJobObservationSelection | undefined;
  signal: AbortSignal | undefined;
  tracker: ResourceTracker;
}): Promise<WorkflowJobObservation> {
  const selection = options.selection;
  if (selection === undefined) return options.job;

  const needsDefault =
    selection.includeDefaultExecution === true ||
    (selection.executionSequences === undefined &&
      ((selection.stepKeys?.length ?? 0) > 0 ||
        selection.includeContext === true ||
        selection.stepAttempts !== undefined));
  const executions: WorkflowExecutionObservation[] = [];
  let defaultExecutionId: string | undefined;
  let defaultExecution: WorkflowExecutionObservation | undefined;

  if (needsDefault) {
    const detail = await readJobDetail({
      client: options.client,
      jobId: options.job.id,
      signal: options.signal,
      tracker: options.tracker,
    });
    if (detail.selected_execution !== null) {
      defaultExecutionId = detail.selected_execution.id;
      defaultExecution = await readExecutionObservation({
        client: options.client,
        jobId: options.job.id,
        execution: detail.selected_execution,
        jobDetail: detail.selected_execution,
        selection,
        signal: options.signal,
        tracker: options.tracker,
      });
      executions.push(defaultExecution);
    }
  }

  if (selection.executionSequences !== undefined) {
    executions.push(
      ...(await readExecutionSummaries({
        client: options.client,
        jobId: options.job.id,
        sequences: selection.executionSequences,
        selection,
        preloadedExecutions: defaultExecution === undefined ? undefined : [defaultExecution],
        excludedExecutionId: defaultExecutionId,
        signal: options.signal,
        tracker: options.tracker,
      })),
    );
  }

  const uniqueExecutions = new Map<string, WorkflowExecutionObservation>();
  for (const execution of executions) uniqueExecutions.set(execution.id, execution);
  return {
    ...options.job,
    executions: [...uniqueExecutions.values()].sort(
      (left, right) => left.sequence - right.sequence,
    ),
  };
}

async function readRunObservationFromBase(options: {
  client: ApiClient;
  runId: string;
  selection: WorkflowRunObservationSelection | undefined;
  signal: AbortSignal | undefined;
  tracker: ResourceTracker;
  base: {
    lineage: WorkflowRunLineageHeadResponseDto;
    overview: WorkflowRunOverviewResponseDto;
  };
}): Promise<WorkflowRunObservation> {
  const base = options.base;
  const {client, tracker} = options;
  const attempt = base.overview.attempt.attempt;
  const jobSelections = options.selection?.jobs;
  const compactJobs = await readOverviewJobs({
    client,
    runId: options.runId,
    attempt,
    overview: base.overview,
    selection: jobSelections,
    signal: options.signal,
    tracker,
  });

  const jobs = await Promise.all(
    [...compactJobs.values()].map((job) =>
      readJobObservation({
        client,
        job,
        selection: selectionForJob(jobSelections, job.key),
        signal: options.signal,
        tracker,
      }),
    ),
  );

  return {
    ...base.overview.run,
    status: base.overview.attempt.status,
    current_attempt: base.lineage.current_attempt,
    latest_attempt: base.lineage.latest_attempt,
    updated_at: base.lineage.updated_at,
    attempt: base.overview.attempt,
    has_started_job_execution: base.overview.has_started_job_execution,
    jobs: jobs.sort((left, right) => left.position - right.position),
  };
}

async function readRunObservation(
  options: ObserveRunOptions & {deadline?: number | undefined},
): Promise<WorkflowRunObservation> {
  const client = makeApiClient({
    apiUrl: options.apiUrl,
    fetch: options.fetch,
    token: options.token,
  });
  const deadline =
    options.deadline ??
    (options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs);
  const tracker: ResourceTracker = {
    last: 'workflow run lineage head',
    ...(deadline === undefined ? {} : {deadline}),
  };
  const base = await readRunBase({
    client,
    runId: options.runId,
    attempt: options.attempt,
    signal: options.signal,
    tracker,
  });
  return await readRunObservationFromBase({
    client,
    runId: options.runId,
    selection: options.selection,
    signal: options.signal,
    tracker,
    base,
  });
}

export async function observeRun(options: ObserveRunOptions): Promise<WorkflowRunObservation> {
  return await readRunObservation(options);
}

export async function waitForRunTerminal(
  options: WaitForRunTerminalOptions,
): Promise<WorkflowRunObservation> {
  const client = makeApiClient({
    apiUrl: options.apiUrl,
    fetch: options.fetch,
    token: options.token,
  });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TERMINAL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let lastLineage: WorkflowRunLineageHeadResponseDto | null = null;
  let lastOverview: WorkflowRunOverviewResponseDto | null = null;
  let lastResource = 'workflow run lineage head';

  return await pollUntil<WorkflowRunObservation>(
    {
      timeoutMs,
      intervalMs: options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
      maxIntervalMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
      backoffFactor: options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR,
      ...(options.signal ? {signal: options.signal} : {}),
      describe: () =>
        `Timed out waiting for workflow run terminal status: ${formatRunObservationObserved(
          lastLineage,
          lastOverview,
          options.runId,
          lastResource,
        )}`,
    },
    async () => {
      options.signal?.throwIfAborted();
      const tracker: ResourceTracker = {
        last: lastResource,
        deadline,
      };
      try {
        const base = await readRunBase({
          client,
          runId: options.runId,
          attempt: options.attempt,
          signal: options.signal,
          tracker,
        });
        lastLineage = base.lineage;
        lastOverview = base.overview;
        if (!TERMINAL_STATUSES.has(base.overview.attempt.status)) return null;

        return await readRunObservationFromBase({
          client,
          runId: options.runId,
          selection: options.selection,
          signal: options.signal,
          tracker,
          base,
        });
      } finally {
        lastResource = tracker.last;
      }
    },
  );
}

export function createWorkflowsHelper(options: {
  apiUrl?: string | undefined;
  fetch?: ApiFetch | undefined;
  token: string;
}) {
  return {
    waitForRunByCommit: (params: Omit<WaitForRunByCommitOptions, 'apiUrl' | 'fetch' | 'token'>) =>
      waitForRunByCommit({...options, ...params}),
    waitForRunByDeliveryId: (
      params: Omit<WaitForRunByDeliveryIdOptions, 'apiUrl' | 'fetch' | 'token'>,
    ) => waitForRunByDeliveryId({...options, ...params}),
    observeRun: (params: Omit<ObserveRunOptions, 'apiUrl' | 'fetch' | 'token'>) =>
      observeRun({...options, ...params}),
    waitForRunTerminal: (params: Omit<WaitForRunTerminalOptions, 'apiUrl' | 'fetch' | 'token'>) =>
      waitForRunTerminal({...options, ...params}),
  };
}

export type WorkflowsHelper = ReturnType<typeof createWorkflowsHelper>;
