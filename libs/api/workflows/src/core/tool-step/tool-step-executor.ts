import {randomUUID} from 'node:crypto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {MAX_RECORD_DATA_BYTES, type ServerLogRecord} from '@shipfox/api-logs-dto';
import type {LogsModuleClient} from '@shipfox/api-logs-dto/inter-module';
import {logsInterModuleContract} from '@shipfox/api-logs-dto/inter-module';
import {evaluateWorkflowExpression, type WorkflowExpression} from '@shipfox/expression';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {reportError} from '@shipfox/node-error-monitoring';
import type {ModuleService} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {recordStepProgressionMetrics, recordStepResultInTransaction} from '#core/job-execution.js';
import {type Tx, withTransaction} from '#db/db.js';
import {
  claimToolInvocations,
  getStepsByJobExecutionIdForUpdate,
  MAX_TOOL_STEP_CALLS_PER_ATTEMPT,
  retryToolInvocation,
  settleToolInvocation,
  type ToolInvocationClaim,
  type ToolStepWorkflowContext,
} from '#db/workflow-runs.js';
import {
  recordWorkflowToolInvocationDuration,
  recordWorkflowToolInvocationLogAppendFailure,
  recordWorkflowToolInvocationReclaims,
} from '#metrics/instance.js';

const CLAIM_HEADROOM_MS = 15_000;
const ERROR_BACKOFF_MS = 1_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const MAX_RETRY_AFTER_SECONDS = 120;
const MAX_TOOL_LOG_VALUE_BYTES = MAX_RECORD_DATA_BYTES * 64;
const TOOL_LOG_TRUNCATION_MARKER = '\n...[truncated]';

type ToolCallInput = Parameters<IntegrationsModuleClient['callTool']>[0];
type ToolCallOutput = Awaited<ReturnType<IntegrationsModuleClient['callTool']>>;

export interface ToolStepExecutorOptions {
  pollMs?: number;
  concurrency?: number;
  callTimeoutMs?: number;
  claimOwner?: string;
  runCycle?: (signal: AbortSignal) => Promise<boolean>;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  logError?: (error: unknown) => void;
}

export interface ToolStepExecutor {
  service: ModuleService;
  nudge(): void;
}

export function createToolStepExecutor(params: {
  integrations: IntegrationsModuleClient;
  logs: LogsModuleClient;
  options?: ToolStepExecutorOptions;
}): ToolStepExecutor {
  const options = params.options ?? {};
  const pollMs = options.pollMs ?? config.WORKFLOWS_TOOL_STEP_POLL_INTERVAL_MS;
  const concurrency = options.concurrency ?? config.WORKFLOWS_TOOL_STEP_EXECUTOR_CONCURRENCY;
  const callTimeoutMs = options.callTimeoutMs ?? config.WORKFLOWS_TOOL_STEP_CALL_TIMEOUT_MS;
  const claimOwner = options.claimOwner ?? `tool-step-executor-${randomUUID()}`;
  const reportLoopError =
    options.logError ??
    ((error) => {
      logger().error({err: error}, 'Tool step executor failed');
      reportError(error, {boundary: 'workflows.tool-step-executor'});
    });
  let wake: (() => void) | undefined;

  const nudge = (): void => {
    wake?.();
  };

  const waitForWork = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        if (wake === finish) wake = undefined;
        resolve();
      };

      wake = finish;
      timer = setTimeout(finish, ms);
      signal.addEventListener('abort', finish, {once: true});
      if (signal.aborted) finish();
    });

  const service: ModuleService = {
    name: 'tool-step-executor',
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    start: () => {
      const abortController = new AbortController();
      const finished = runToolStepExecutorLoop({
        pollMs,
        reportLoopError,
        runCycle:
          options.runCycle ??
          ((signal) =>
            runToolStepExecutorCycle({
              callTimeoutMs,
              claimOwner,
              concurrency,
              integrations: params.integrations,
              logs: params.logs,
              nudge,
              signal,
            })),
        signal: abortController.signal,
        wait: options.wait ?? waitForWork,
      });

      return Promise.resolve({
        stop: async () => {
          abortController.abort();
          await finished;
        },
        finished,
      });
    },
  };

  return {service, nudge};
}

export function createToolStepExecutorService(params: {
  integrations: IntegrationsModuleClient;
  logs: LogsModuleClient;
  options?: ToolStepExecutorOptions;
}): ModuleService {
  return createToolStepExecutor(params).service;
}

export async function runToolStepExecutorCycle(params: {
  integrations: IntegrationsModuleClient;
  logs: LogsModuleClient;
  signal: AbortSignal;
  claimOwner: string;
  concurrency: number;
  callTimeoutMs: number;
  nudge?: () => void;
}): Promise<boolean> {
  if (params.signal.aborted) return false;

  const now = new Date();
  const claimed = await claimToolInvocations({
    limit: params.concurrency,
    now,
    claimOwner: params.claimOwner,
    claimExpiresAt: new Date(now.getTime() + params.callTimeoutMs + CLAIM_HEADROOM_MS),
  });
  recordWorkflowToolInvocationReclaims(
    claimed.requeued + claimed.claims.filter((claim) => claim.interrupted).length,
  );

  await Promise.all(
    claimed.claims.map((claim) =>
      executeToolInvocation({
        callTimeoutMs: params.callTimeoutMs,
        claim,
        integrations: params.integrations,
        logs: params.logs,
        nudge: params.nudge,
        serviceSignal: params.signal,
      }),
    ),
  );

  return claimed.claims.length > 0 || claimed.requeued > 0;
}

interface RunToolStepExecutorLoopParams {
  readonly pollMs: number;
  readonly reportLoopError: (error: unknown) => void;
  readonly runCycle: (signal: AbortSignal) => Promise<boolean>;
  readonly signal: AbortSignal;
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
}

async function runToolStepExecutorLoop(params: RunToolStepExecutorLoopParams): Promise<void> {
  while (!params.signal.aborted) {
    try {
      const hasWork = await params.runCycle(params.signal);
      if (!hasWork) await params.wait(params.pollMs, params.signal);
    } catch (error) {
      if (params.signal.aborted) return;
      params.reportLoopError(error);
      await params.wait(ERROR_BACKOFF_MS, params.signal);
    }
  }
}

interface ExecuteToolInvocationParams {
  readonly callTimeoutMs: number;
  readonly claim: ToolInvocationClaim;
  readonly integrations: IntegrationsModuleClient;
  readonly logs: LogsModuleClient;
  readonly nudge?: (() => void) | undefined;
  readonly serviceSignal: AbortSignal;
}

async function executeToolInvocation(params: ExecuteToolInvocationParams): Promise<void> {
  const {claim} = params;
  if (params.serviceSignal.aborted) return;

  const startedAt = new Date();
  const execution = claim.interrupted ? interruptedExecution() : await callToolInvocation(params);
  if (params.serviceSignal.aborted) return;

  if (execution.outcome === 'error') {
    const retryAfterMs = toolRetryDelayMs({
      callIndex: claim.invocation.callIndex,
      code: execution.error.code,
      retryAfterSeconds: execution.error.retryAfterSeconds,
      sensitivity: toolSensitivity(claim),
    });
    if (retryAfterMs !== undefined) {
      const dueAt = new Date(Date.now() + retryAfterMs);
      const retried = await retryToolInvocation({
        invocationId: claim.invocation.id,
        stepAttemptId: claim.invocation.stepAttemptId,
        claimOwner: claimOwnerFromInvocation(claim),
        callIndex: claim.invocation.callIndex,
        dueAt,
        errorCode: execution.error.code,
        finishedAt: new Date(),
        durationMs: elapsedMilliseconds(startedAt),
      });
      if (retried) {
        recordToolInvocationDuration(claim, execution, elapsedMilliseconds(startedAt));
        if (params.serviceSignal.aborted) return;
        await appendToolInvocationLog(params.logs, claim, execution);
        params.nudge?.();
      }
      return;
    }
  }

  const settled = await settleAndRecordToolInvocation({
    claim,
    execution,
    finishedAt: new Date(),
    durationMs: elapsedMilliseconds(startedAt),
  });
  if (!settled || params.serviceSignal.aborted) return;
  await appendToolInvocationLog(params.logs, claim, execution);
}

function claimOwnerFromInvocation(claim: ToolInvocationClaim): string {
  const owner = claim.invocation.claimedBy;
  if (owner === null) throw new Error(`Tool invocation is not owned: ${claim.invocation.id}`);
  return owner;
}

async function callToolInvocation(params: ExecuteToolInvocationParams): Promise<ToolExecution> {
  const prepared = prepareToolCall(params.claim);
  if (prepared.kind === 'error') {
    return {outcome: 'error', error: prepared.error};
  }

  const timeoutSignal = AbortSignal.timeout(params.callTimeoutMs);
  const signal = AbortSignal.any([params.serviceSignal, timeoutSignal]);
  try {
    const output = await params.integrations.callTool(prepared.input, {signal});
    return resolveToolCallOutput(output, prepared, params, timeoutSignal);
  } catch (error) {
    return resolveToolCallError(error, params, timeoutSignal);
  }
}

function resolveToolCallOutput(
  output: ToolCallOutput,
  prepared: Extract<PreparedToolCallResult, {kind: 'ok'}>,
  params: ExecuteToolInvocationParams,
  timeoutSignal: AbortSignal,
): ToolExecution {
  if (params.serviceSignal.aborted) return interruptedExecution();
  if (timeoutSignal.aborted) return timedOutExecution();
  if (output.outcome === 'error') {
    return {
      outcome: 'error',
      error: {
        code: output.code,
        message: output.message,
        ...(output.retryAfterSeconds === undefined
          ? {}
          : {retryAfterSeconds: output.retryAfterSeconds}),
        ...(output.status === undefined ? {} : {status: output.status}),
      },
    };
  }

  const result = fullToolResult(output);
  try {
    return {
      outcome: 'success',
      result,
      output: mapToolOutputs(prepared.toolConfig, result, params.claim.workflowContext),
    };
  } catch (error) {
    return {
      outcome: 'output_invalid',
      result,
      error: {code: 'output_invalid', message: errorMessage(error), reason: 'output_invalid'},
    };
  }
}

function resolveToolCallError(
  error: unknown,
  params: ExecuteToolInvocationParams,
  timeoutSignal: AbortSignal,
): ToolExecution {
  if (params.serviceSignal.aborted) return interruptedExecution();
  if (timeoutSignal.aborted) return timedOutExecution();
  if (isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)) {
    return {
      outcome: 'error',
      error: {code: error.code, message: error.message},
    };
  }
  reportUnexpectedToolError(error, params.claim, 'call');
  return {
    outcome: 'error',
    error: {code: 'tool_error', message: errorMessage(error)},
  };
}

type PreparedToolCallResult =
  | {kind: 'ok'; input: ToolCallInput; toolConfig: Record<string, unknown>}
  | {kind: 'error'; error: ToolExecutionError};

function prepareToolCall(claim: ToolInvocationClaim): PreparedToolCallResult {
  const rawTool = claim.step.config.tool;
  if (!isRecord(rawTool)) return invalidToolConfig('Tool step config is missing its tool object');

  const connectionId = stringField(rawTool.connection_id);
  const provider = stringField(rawTool.provider);
  const id = stringField(rawTool.id);
  const sensitivity = rawTool.sensitivity;
  const sensitive = rawTool.sensitive;
  const requiredScope = rawTool.required_scope;
  const inputSchema = rawTool.input_schema;
  const outputSchema = rawTool.output_schema;
  if (
    connectionId === undefined ||
    provider === undefined ||
    id === undefined ||
    (sensitivity !== 'read' && sensitivity !== 'write') ||
    typeof sensitive !== 'boolean' ||
    !Array.isArray(requiredScope) ||
    !isRecord(inputSchema) ||
    (outputSchema !== undefined && !isRecord(outputSchema))
  ) {
    return invalidToolConfig('Tool step config is incomplete');
  }

  const argumentsValue = rawTool.with ?? {};
  if (!isRecord(argumentsValue)) {
    return invalidToolConfig('Tool step arguments must be an object');
  }

  const caller = {
    kind: 'tool_step' as const,
    projectId: claim.workflowContext.projectId,
    runId: claim.workflowContext.workflowRunId,
    jobExecutionId: claim.invocation.jobExecutionId,
    stepId: claim.invocation.stepId,
    stepAttempt: claim.attempt.attempt,
    callIndex: claim.invocation.callIndex,
  };
  const tool = {
    id,
    provider,
    sensitivity: sensitivity as 'read' | 'write',
    sensitive,
    requiredScope: [...requiredScope],
    inputSchema,
    ...(outputSchema === undefined ? {} : {outputSchema}),
  };
  return {
    kind: 'ok',
    input: {
      workspaceId: claim.invocation.workspaceId,
      connectionId,
      tool,
      arguments: argumentsValue,
      // The project-scoped caller field is present in the current integration
      // contract; cast for compatibility with older checked-out DTO sources.
      caller: caller as ToolCallInput['caller'],
    },
    toolConfig: rawTool,
  };
}

function invalidToolConfig(message: string): PreparedToolCallResult {
  return {
    kind: 'error',
    error: {code: 'tool_config_invalid', message, reason: 'tool_config_invalid'},
  };
}

function fullToolResult(output: Extract<ToolCallOutput, {outcome: 'success'}>): unknown {
  if (output.result !== null) return output.result;
  const text = output.content.find(
    (block) => block.type === 'text' && typeof block.text === 'string',
  );
  if (!text || typeof text.text !== 'string') return null;
  try {
    return JSON.parse(text.text) as unknown;
  } catch {
    return text.text;
  }
}

function mapToolOutputs(
  toolConfig: Record<string, unknown>,
  result: unknown,
  workflowContext: ToolStepWorkflowContext,
): Record<string, unknown> {
  const output: Record<string, unknown> = {result};
  const mappings = toolConfig.output_mappings;
  if (!isRecord(mappings)) return output;

  for (const [key, rawExpression] of Object.entries(mappings)) {
    if (!isRecord(rawExpression) || typeof rawExpression.source !== 'string') {
      throw new Error(`Tool output mapping "${key}" is invalid`);
    }
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      value: evaluateWorkflowExpression(rawExpression as unknown as WorkflowExpression, {
        result,
        vars: workflowContext.vars ?? {},
      }),
      writable: true,
    });
  }
  return output;
}

interface ToolExecutionError {
  code: string;
  message: string;
  retryAfterSeconds?: number;
  status?: number;
  reason?: 'tool_error' | 'tool_config_invalid' | 'output_invalid' | 'invocation_interrupted';
}

type ToolExecution =
  | {outcome: 'success'; result: unknown; output: Record<string, unknown>}
  | {outcome: 'output_invalid'; result: unknown; error: ToolExecutionError}
  | {outcome: 'error'; error: ToolExecutionError};

function interruptedExecution(): ToolExecution {
  return {
    outcome: 'error',
    error: {
      code: 'invocation_interrupted',
      message: 'Tool invocation was interrupted while it was in flight',
      reason: 'invocation_interrupted',
    },
  };
}

function timedOutExecution(): ToolExecution {
  return {
    outcome: 'error',
    error: {
      code: 'provider-timeout',
      message: 'Integration provider timed out',
    },
  };
}

export function toolRetryDelayMs(params: {
  code: string;
  sensitivity: 'read' | 'write';
  callIndex: number;
  retryAfterSeconds?: number | undefined;
}): number | undefined {
  if (params.callIndex + 1 >= MAX_TOOL_STEP_CALLS_PER_ATTEMPT) return undefined;
  const retryable =
    params.code === 'rate-limited' ||
    (params.sensitivity === 'read' &&
      (params.code === 'provider-timeout' || params.code === 'provider-unavailable'));
  if (!retryable) return undefined;
  if (params.retryAfterSeconds !== undefined && params.retryAfterSeconds > 0) {
    return Math.min(params.retryAfterSeconds, MAX_RETRY_AFTER_SECONDS) * 1_000;
  }
  return 1_000 * 4 ** params.callIndex;
}

async function settleAndRecordToolInvocation(params: {
  claim: ToolInvocationClaim;
  execution: ToolExecution;
  finishedAt: Date;
  durationMs: number;
}): Promise<boolean> {
  const progression = await withTransaction((tx) =>
    settleAndRecordToolInvocationInTransaction(params, tx),
  );
  if (!progression) return false;
  recordStepProgressionMetrics(progression.metrics);
  recordToolInvocationDuration(params.claim, params.execution, params.durationMs);
  return true;
}

async function settleAndRecordToolInvocationInTransaction(
  params: {
    claim: ToolInvocationClaim;
    execution: ToolExecution;
    finishedAt: Date;
    durationMs: number;
  },
  tx: Tx,
): Promise<Awaited<ReturnType<typeof recordStepResultInTransaction>> | undefined> {
  const {claim, execution} = params;
  // Keep the lock order aligned with recordStepResult: the step projection is
  // locked before the invocation history is finalized.
  await getStepsByJobExecutionIdForUpdate(claim.invocation.jobExecutionId, tx);
  const settled = await settleToolInvocation(
    {
      invocationId: claim.invocation.id,
      stepAttemptId: claim.invocation.stepAttemptId,
      claimOwner: claimOwnerFromInvocation(claim),
      callIndex: claim.invocation.callIndex,
      outcome: execution.outcome === 'error' ? 'error' : 'success',
      ...(settledErrorCode(execution) === undefined
        ? {}
        : {errorCode: settledErrorCode(execution)}),
      finishedAt: params.finishedAt,
      durationMs: params.durationMs,
    },
    tx,
  );
  if (!settled) return undefined;
  return recordSettledToolInvocation(claim, execution, tx);
}

function recordSettledToolInvocation(
  claim: ToolInvocationClaim,
  execution: ToolExecution,
  tx: Tx,
): Promise<Awaited<ReturnType<typeof recordStepResultInTransaction>>> {
  if (execution.outcome === 'success') {
    return recordStepResultInTransaction(
      {
        jobExecutionId: claim.invocation.jobExecutionId,
        stepId: claim.invocation.stepId,
        status: 'succeeded',
        output: execution.output,
        response: null,
        exitCode: null,
        attempt: claim.attempt.attempt,
        logOutcome: 'drained',
      },
      tx,
    );
  }

  return recordStepResultInTransaction(
    {
      jobExecutionId: claim.invocation.jobExecutionId,
      stepId: claim.invocation.stepId,
      status: 'failed',
      error: {
        message: execution.error.message,
        code: execution.error.code,
        reason: execution.error.reason ?? 'tool_error',
        ...(execution.error.status === undefined ? {} : {status: execution.error.status}),
      },
      output: null,
      response: null,
      exitCode: null,
      attempt: claim.attempt.attempt,
      logOutcome: 'drained',
    },
    tx,
  );
}

function settledErrorCode(execution: ToolExecution): string | undefined {
  return execution.outcome === 'error' ? execution.error.code : undefined;
}

async function appendToolInvocationLog(
  logs: LogsModuleClient,
  claim: ToolInvocationClaim,
  execution: ToolExecution,
): Promise<void> {
  const rawTool = isRecord(claim.step.config.tool) ? claim.step.config.tool : {};
  const provider = toolProvider(claim);
  const id = stringField(rawTool.id) ?? 'unknown-tool';
  const groupId = `tool-${claim.invocation.id}-${claim.invocation.callIndex}`;
  const timestamp = Date.now();
  const result =
    execution.outcome === 'error'
      ? {
          code: execution.error.code,
          message: execution.error.message,
          ...(execution.error.retryAfterSeconds === undefined
            ? {}
            : {retry_after_seconds: execution.error.retryAfterSeconds}),
        }
      : execution.result;
  const sensitive = rawTool.sensitive === true;
  const records: ServerLogRecord[] = [
    {
      v: 1,
      ts: timestamp,
      type: 'group_start',
      group_id: groupId,
      parent_group_id: null,
      name: `tool ${provider}/${id}`,
    },
    ...outputRecords(
      timestamp,
      sensitive ? '[sensitive tool arguments redacted]' : prettyJson(readToolArguments(claim)),
    ),
    ...outputRecords(
      timestamp,
      sensitive ? '[sensitive tool result redacted]' : prettyJson(result),
    ),
    {v: 1, ts: timestamp, type: 'group_end', group_id: groupId},
  ];

  // The Logs module owns the request-size limit, so append records separately.
  // A large provider result must not cause the complete group to be rejected.
  for (const record of records) {
    try {
      await logs.appendServerRecords({
        jobId: claim.workflowContext.jobId,
        workspaceId: claim.workflowContext.workspaceId,
        projectId: claim.workflowContext.projectId,
        workflowRunAttemptId: claim.workflowContext.workflowRunAttemptId,
        stepId: claim.invocation.stepId,
        attempt: claim.attempt.attempt,
        records: [record],
      });
    } catch (error) {
      if (isInterModuleKnownError(logsInterModuleContract.methods.appendServerRecords, error)) {
        recordWorkflowToolInvocationLogAppendFailure('known');
        logger().warn(
          {code: error.code, invocationId: claim.invocation.id},
          'Tool step invocation log was not appended',
        );
        return;
      }
      logger().error(
        {err: error, invocationId: claim.invocation.id},
        'Tool step log append failed',
      );
      recordWorkflowToolInvocationLogAppendFailure('unexpected');
      reportError(error, {
        boundary: 'workflows.tool-step-executor',
        operation: 'append-log',
      });
      return;
    }
  }
}

function readToolArguments(claim: ToolInvocationClaim): Record<string, unknown> {
  const tool = claim.step.config.tool;
  if (!isRecord(tool) || !isRecord(tool.with)) return {};
  return tool.with;
}

function outputRecords(timestamp: number, data: string): ServerLogRecord[] {
  return splitLogData(truncateLogData(data)).map((chunk) => ({
    v: 1,
    ts: timestamp,
    type: 'output' as const,
    stream: 'stdout' as const,
    data: chunk,
  }));
}

function splitLogData(data: string): string[] {
  const encoded = new TextEncoder().encode(data);
  if (encoded.length === 0) return ['{}'];

  const decoder = new TextDecoder('utf-8', {ignoreBOM: true});
  const chunks: string[] = [];
  let offset = 0;
  while (offset < encoded.length) {
    const limit = Math.min(offset + MAX_RECORD_DATA_BYTES, encoded.length);
    const end = utf8ChunkEnd(encoded, offset, limit);
    chunks.push(decoder.decode(encoded.subarray(offset, end)));
    offset = end;
  }
  return chunks;
}

function truncateLogData(data: string): string {
  const encoded = new TextEncoder().encode(data);
  if (encoded.length <= MAX_TOOL_LOG_VALUE_BYTES) return data;

  const end = utf8ChunkEnd(encoded, 0, MAX_TOOL_LOG_VALUE_BYTES);
  const prefix = new TextDecoder('utf-8', {ignoreBOM: true}).decode(encoded.subarray(0, end));
  return `${prefix}${TOOL_LOG_TRUNCATION_MARKER}`;
}

function utf8ChunkEnd(bytes: Uint8Array, start: number, limit: number): number {
  let end = limit;
  while (end > start && end < bytes.length && isUtf8ContinuationByte(bytes[end])) end -= 1;
  if (end > start) return end;

  // MAX_RECORD_DATA_BYTES and MAX_TOOL_LOG_VALUE_BYTES are larger than one
  // UTF-8 code point, but keep this fallback safe if a smaller limit is used.
  end = Math.min(start + 1, bytes.length);
  while (end < bytes.length && isUtf8ContinuationByte(bytes[end])) end += 1;
  return end;
}

function isUtf8ContinuationByte(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

function prettyJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function toolSensitivity(claim: ToolInvocationClaim): 'read' | 'write' {
  const tool = claim.step.config.tool;
  return isRecord(tool) && tool.sensitivity === 'read' ? 'read' : 'write';
}

function toolProvider(claim: ToolInvocationClaim): string {
  const tool = claim.step.config.tool;
  return isRecord(tool) ? (stringField(tool.provider) ?? 'unknown-provider') : 'unknown-provider';
}

function recordToolInvocationDuration(
  claim: ToolInvocationClaim,
  execution: ToolExecution,
  durationMs: number,
): void {
  if (claim.interrupted) return;
  recordWorkflowToolInvocationDuration(
    toolProvider(claim),
    execution.outcome === 'error' ? 'error' : 'success',
    durationMs,
  );
}

function elapsedMilliseconds(startedAt: Date): number {
  return Math.max(0, Date.now() - startedAt.getTime());
}

function reportUnexpectedToolError(
  error: unknown,
  claim: ToolInvocationClaim,
  operation: string,
): void {
  logger().error({err: error, invocationId: claim.invocation.id}, 'Tool step invocation failed');
  reportError(error, {
    boundary: 'workflows.tool-step-executor',
    operation,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
