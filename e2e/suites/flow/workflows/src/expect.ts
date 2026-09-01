import type {LogRecord} from '@shipfox/api-logs-dto';
import type {
  JobStatusReasonDto,
  StepErrorReasonDto,
  StepGateResultDto,
  WorkflowRunDetailResponseDto,
  WorkflowRunJobDetailDto,
  WorkflowRunStepDetailDto,
} from '@shipfox/api-workflows-dto';
import {z} from 'zod';

// expect.yaml is the suite's assertion language, validated here and owned by the
// suite package (not a domain helper). It stays intentionally small: anything not
// listed is not asserted, and a scenario that outgrows it moves to a bespoke
// spec.e2e.ts rather than growing the schema.

const runStatusSchema = z.enum(['succeeded', 'failed', 'cancelled']);
const jobStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);
const jobStatusReasonSchema = z.enum([
  'dependency_not_completed',
  'condition_false',
  'default_gate_rejected',
  'condition_rejected',
  'condition_errored',
  'user_cancelled',
  'run_cancelled',
  'timed_out',
  'runner_lost',
  'output_too_large',
  'step_failed',
  'unknown',
  'output_invalid',
]);
const stepStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
]);
const stepTypeSchema = z.enum(['setup', 'run', 'agent', 'checkout', 'tool']);
const stepErrorReasonSchema = z.enum([
  'checkout_failed',
  'checkout_auth_failed',
  'checkout_unavailable',
  'checkout_path_invalid',
  'checkout_destination_occupied',
  'git_unavailable',
  'workspace_prep_failed',
  'setup_aborted',
  'config_unresolvable',
  'output_invalid',
  'agent_config_invalid',
  'agent_invocation_failed',
  'agent_harness_unavailable',
  'agent_session_key_invalid',
  'agent_session_held',
  'agent_session_harness_mismatch',
  'agent_session_unavailable',
  'tool_error',
  'tool_config_invalid',
  'invocation_interrupted',
]);
type AssertExact<Actual, Expected> = [Actual] extends [Expected]
  ? [Expected] extends [Actual]
    ? true
    : never
  : never;
// Assigned to a value so a mismatch is a compile error: a bare `type X = AssertExact<…>`
// alias resolves to `never` without failing the build, which lets the DTO add a reason
// this suite silently cannot assert.
const _expectJobStatusReasonSchemaMatchesDto: AssertExact<
  z.infer<typeof jobStatusReasonSchema>,
  JobStatusReasonDto
> = true;
const _expectStepErrorReasonSchemaMatchesDto: AssertExact<
  z.infer<typeof stepErrorReasonSchema>,
  StepErrorReasonDto
> = true;

const logsExpectationSchema = z
  .object({
    include: z.array(z.string()).default([]),
    exclude: z.array(z.string()).default([]),
  })
  .strict();

const pushExpectationSchema = z
  .object({
    message: z.string().min(1).optional(),
  })
  .strict();

const webhookExpectationSchema = z
  .object({
    body: z.unknown().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const stepErrorExpectationSchema = z
  .object({
    reason: stepErrorReasonSchema.optional(),
    field: z.string().optional(),
    source: z.string().optional(),
  })
  .strict();

const stepGateResultKindSchema = z.enum([
  'none',
  'not_evaluated',
  'passed',
  'failed',
  'uncheckable',
  'evaluation_error',
  'unknown',
]);

const stepGateResultExpectationSchema = z
  .object({
    kind: stepGateResultKindSchema.optional(),
    reason: z.string().optional(),
    exit_code: z.number().int().nullable().optional(),
  })
  .strict();

const giteaExpectationSchema = z
  .object({
    issue: z
      .object({
        title: z.string().min(1),
        body: z.string().min(1),
      })
      .strict(),
    comment: z.string().min(1),
  })
  .strict();

const stepExpectationSchema = z
  .object({
    type: stepTypeSchema.optional(),
    status: stepStatusSchema.optional(),
    exit_code: z.number().int().optional(),
    error: stepErrorExpectationSchema.optional(),
    gate_result: stepGateResultExpectationSchema.optional(),
    logs: logsExpectationSchema.optional(),
  })
  .strict();

const jobExpectationSchema = z
  .object({
    status: jobStatusSchema.optional(),
    status_reason: jobStatusReasonSchema.optional(),
    steps: z.record(z.string(), stepExpectationSchema).optional(),
  })
  .strict();

export const expectationSchema = z
  .object({
    trigger: z.enum(['push', 'manual', 'webhook']).default('push'),
    push: pushExpectationSchema.optional(),
    webhook: webhookExpectationSchema.optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),
    timeout_seconds: z.number().int().positive().default(180),
    run: z.object({status: runStatusSchema}).strict(),
    jobs: z.record(z.string(), jobExpectationSchema).optional(),
    runner_log: logsExpectationSchema.optional(),
    gitea: giteaExpectationSchema.optional(),
  })
  .strict();

export type Expectation = z.infer<typeof expectationSchema>;

export function parseExpectation(raw: unknown): Expectation {
  return expectationSchema.parse(raw);
}

/**
 * A single expectation mismatch. `path` locates the field, and expected/actual are
 * rendered for failure attachments.
 */
export interface Mismatch {
  path: string;
  expected: string;
  actual: string;
}

/**
 * A step whose expect.yaml asks for log content. The evaluator resolves the step id
 * and attempt; the harness fetches the logs and passes the text to `evaluateLogs`.
 */
export interface StepLogRequirement {
  path: string;
  stepId: string;
  attempt: number;
  include: string[];
  exclude: string[];
}

export interface ExpectationResult {
  mismatches: Mismatch[];
  logRequirements: StepLogRequirement[];
}

function findJob(
  runDetail: WorkflowRunDetailResponseDto,
  key: string,
): WorkflowRunJobDetailDto | undefined {
  return runDetail.jobs.find((job) => job.key === key);
}

// Steps live under each job execution; a listening or restarted job has more than one
// execution. Search every execution and prefer the latest, so an assertion targets the
// most recent run of the step rather than a stale earlier attempt.
function findStep(
  job: WorkflowRunJobDetailDto,
  stepKey: string,
): WorkflowRunStepDetailDto | undefined {
  let match: WorkflowRunStepDetailDto | undefined;
  for (const execution of job.job_executions) {
    for (const step of execution.steps) {
      if (step.key === stepKey || step.name === stepKey) match = step;
    }
  }
  return match;
}

function latestExitCode(step: WorkflowRunStepDetailDto): number | null {
  const current = step.attempts.find((attempt) => attempt.attempt === step.current_attempt);
  const attempt = current ?? step.attempts.at(-1);
  return attempt?.exit_code ?? null;
}

function latestGateResult(step: WorkflowRunStepDetailDto): StepGateResultDto | null {
  const current = step.attempts.find((attempt) => attempt.attempt === step.current_attempt);
  const attempt = current ?? step.attempts.at(-1);
  return attempt?.gate_result ?? null;
}

function stringField(value: Record<string, unknown>, field: string): string | null {
  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === 'string' ? fieldValue : null;
}

function intOrNullField(value: Record<string, unknown>, field: string): number | null | undefined {
  const fieldValue = value[field];
  if (fieldValue === null) return null;
  return typeof fieldValue === 'number' && Number.isInteger(fieldValue) ? fieldValue : undefined;
}

function formatOptionalInteger(value: number | null | undefined): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  return String(value);
}

type JobExpectation = NonNullable<Expectation['jobs']>[string];
type StepExpectation = NonNullable<JobExpectation['steps']>[string];

function evaluateStepError(
  step: WorkflowRunStepDetailDto,
  expectation: NonNullable<StepExpectation['error']>,
  path: string,
  mismatches: Mismatch[],
): void {
  if (step.error === null) {
    mismatches.push({path, expected: 'present', actual: 'null'});
    return;
  }

  if (expectation.reason !== undefined && step.error.reason !== expectation.reason) {
    mismatches.push({
      path: `${path}.reason`,
      expected: expectation.reason,
      actual: step.error.reason ?? 'null',
    });
  }

  if (expectation.field !== undefined) {
    const field = stringField(step.error, 'field');
    if (field !== expectation.field) {
      mismatches.push({
        path: `${path}.field`,
        expected: expectation.field,
        actual: field ?? 'null',
      });
    }
  }

  if (expectation.source !== undefined) {
    const source = stringField(step.error, 'source');
    if (source === null || !source.includes(expectation.source)) {
      mismatches.push({
        path: `${path}.source`,
        expected: `include ${expectation.source}`,
        actual: source ?? 'null',
      });
    }
  }
}

function evaluateGateResult(
  step: WorkflowRunStepDetailDto,
  expectation: NonNullable<StepExpectation['gate_result']>,
  path: string,
  mismatches: Mismatch[],
): void {
  const gateResult = latestGateResult(step);
  if (gateResult === null) {
    mismatches.push({path, expected: 'present', actual: 'null'});
    return;
  }

  if (expectation.kind !== undefined && gateResult.kind !== expectation.kind) {
    mismatches.push({path: `${path}.kind`, expected: expectation.kind, actual: gateResult.kind});
  }

  if (expectation.reason !== undefined) {
    const reason = stringField(gateResult, 'reason');
    if (reason !== expectation.reason) {
      mismatches.push({
        path: `${path}.reason`,
        expected: expectation.reason,
        actual: reason ?? 'null',
      });
    }
  }

  if (expectation.exit_code !== undefined) {
    const exitCode = intOrNullField(gateResult, 'exit_code');
    if (exitCode !== expectation.exit_code) {
      mismatches.push({
        path: `${path}.exit_code`,
        expected: formatOptionalInteger(expectation.exit_code),
        actual: formatOptionalInteger(exitCode),
      });
    }
  }
}

function evaluateStepExpectation(
  job: WorkflowRunJobDetailDto,
  stepKey: string,
  expectation: StepExpectation,
  path: string,
  result: ExpectationResult,
): void {
  const step = findStep(job, stepKey);
  if (!step) {
    result.mismatches.push({path, expected: 'present', actual: 'missing'});
    return;
  }

  if (expectation.status && step.status !== expectation.status) {
    result.mismatches.push({
      path: `${path}.status`,
      expected: expectation.status,
      actual: step.status,
    });
  }

  if (expectation.type !== undefined && step.type !== expectation.type) {
    result.mismatches.push({
      path: `${path}.type`,
      expected: expectation.type,
      actual: step.type,
    });
  }

  if (expectation.exit_code !== undefined) {
    const exitCode = latestExitCode(step);
    if (exitCode !== expectation.exit_code) {
      result.mismatches.push({
        path: `${path}.exit_code`,
        expected: String(expectation.exit_code),
        actual: exitCode === null ? 'null' : String(exitCode),
      });
    }
  }

  if (expectation.error) {
    evaluateStepError(step, expectation.error, `${path}.error`, result.mismatches);
  }
  if (expectation.gate_result) {
    evaluateGateResult(step, expectation.gate_result, `${path}.gate_result`, result.mismatches);
  }
  if (expectation.logs) {
    result.logRequirements.push({
      path,
      stepId: step.id,
      attempt: step.current_attempt,
      include: expectation.logs.include,
      exclude: expectation.logs.exclude,
    });
  }
}

function evaluateJobExpectation(
  runDetail: WorkflowRunDetailResponseDto,
  jobKey: string,
  expectation: JobExpectation,
  result: ExpectationResult,
): void {
  const path = `jobs.${jobKey}`;
  const job = findJob(runDetail, jobKey);
  if (!job) {
    result.mismatches.push({path, expected: 'present', actual: 'missing'});
    return;
  }

  if (expectation.status && job.status !== expectation.status) {
    result.mismatches.push({
      path: `${path}.status`,
      expected: expectation.status,
      actual: job.status,
    });
  }
  if (expectation.status_reason !== undefined && job.status_reason !== expectation.status_reason) {
    result.mismatches.push({
      path: `${path}.status_reason`,
      expected: expectation.status_reason,
      actual: job.status_reason ?? 'null',
    });
  }

  for (const [stepKey, stepExpectation] of Object.entries(expectation.steps ?? {})) {
    evaluateStepExpectation(job, stepKey, stepExpectation, `${path}.steps.${stepKey}`, result);
  }
}

/**
 * Compares a run detail against an expectation, returning every structural mismatch
 * (run/job/step status, step type, and step exit code) plus the log requirements the
 * harness still needs to fetch. Pure and synchronous, so it is unit-tested against canned
 * run detail.
 */
export function evaluateExpectations(
  runDetail: WorkflowRunDetailResponseDto,
  expectation: Expectation,
): ExpectationResult {
  const result: ExpectationResult = {mismatches: [], logRequirements: []};

  if (runDetail.status !== expectation.run.status) {
    result.mismatches.push({
      path: 'run.status',
      expected: expectation.run.status,
      actual: runDetail.status,
    });
  }

  for (const [jobKey, jobExpectation] of Object.entries(expectation.jobs ?? {})) {
    evaluateJobExpectation(runDetail, jobKey, jobExpectation, result);
  }

  return result;
}

// A pattern wrapped in slashes (/foo/) is a regular expression; anything else is a
// substring. This is the whole matching grammar for expect.yaml log assertions. The
// body must be non-empty (length > 2): a bare `//` is the literal substring, not an
// empty regex, which would silently match anything and pass a log assertion by accident.
function matchesPattern(text: string, pattern: string): boolean {
  if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
    return new RegExp(pattern.slice(1, -1), 'u').test(text);
  }
  return text.includes(pattern);
}

export interface EvaluateLogsParams {
  path: string;
  text: string;
  include: string[];
  exclude: string[];
}

export function evaluateLogs(params: EvaluateLogsParams): Mismatch[] {
  const mismatches: Mismatch[] = [];
  for (const pattern of params.include) {
    if (!matchesPattern(params.text, pattern)) {
      mismatches.push({
        path: `${params.path}.logs.include`,
        expected: `match ${pattern}`,
        actual: 'not found',
      });
    }
  }
  for (const pattern of params.exclude) {
    if (matchesPattern(params.text, pattern)) {
      mismatches.push({
        path: `${params.path}.logs.exclude`,
        expected: `absent ${pattern}`,
        actual: 'present',
      });
    }
  }
  return mismatches;
}

// The human-visible log text is the concatenation of stdout/stderr output records;
// control records (group markers, gaps, tombstones) carry no asserted content.
export function logText(records: LogRecord[]): string {
  return records
    .filter((record): record is Extract<LogRecord, {type: 'output'}> => record.type === 'output')
    .map((record) => record.data)
    .join('');
}
