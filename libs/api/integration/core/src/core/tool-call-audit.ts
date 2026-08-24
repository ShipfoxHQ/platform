import type {
  MaterializedAgentIntegrationConfigDto,
  MaterializedAgentIntegrationToolConfigDto,
} from '@shipfox/api-agent-dto';
import type {LeasedJobContext} from '@shipfox/api-auth-context';
import {logger} from '@shipfox/node-opentelemetry';
import {
  type IntegrationAgentToolCallErrorLabel,
  type IntegrationAgentToolCallOutcome,
  recordIntegrationAgentToolCall,
} from '#metrics/index.js';
import type {IntegrationConnection} from './entities/connection.js';

/**
 * Who asked for an integration tool call. The agent caller is the MCP gateway
 * serving a model under a job lease; the tool-step caller is the workflow tool
 * step executor. The metric label stays `agent` | `tool_step`, while the audit
 * line expands each caller's identity fields.
 */
export type IntegrationToolCallCaller =
  | {caller: 'agent'; lease?: LeasedJobContext | undefined}
  | {
      caller: 'tool_step';
      workspaceId: string;
      runId: string;
      jobExecutionId: string;
      stepId: string;
      stepAttempt: number;
      callIndex: number;
    };

/**
 * Expands a caller into the shared audit/log context. One builder consumed by
 * the tool-call service's error log and by the tool-call recorder, so the
 * enrichment never drifts between the two.
 */
export function callerLogContext(caller: IntegrationToolCallCaller): Record<string, unknown> {
  return caller.caller === 'agent'
    ? {
        caller: 'agent',
        ...(caller.lease === undefined
          ? {}
          : {
              jobId: caller.lease.jobId,
              jobExecutionId: caller.lease.jobExecutionId,
              workflowRunId: caller.lease.workflowRunId,
              workflowRunAttemptId: caller.lease.workflowRunAttemptId,
              workspaceId: caller.lease.workspaceId,
              currentStepId: caller.lease.currentStepId,
              currentStepAttempt: caller.lease.currentStepAttempt,
            }),
      }
    : {
        caller: 'tool_step',
        workspaceId: caller.workspaceId,
        runId: caller.runId,
        jobExecutionId: caller.jobExecutionId,
        stepId: caller.stepId,
        stepAttempt: caller.stepAttempt,
        callIndex: caller.callIndex,
      };
}

export const NO_METHOD_LABEL = 'none';
export const UNKNOWN_TOOL_LABEL = 'unknown';
export const INVALID_METHOD_LABEL = 'invalid';

/** The pieces the audit needs from the authorized tool, without presentation types. */
export interface IntegrationToolCallAuditTarget {
  connection: IntegrationConnection;
  integration: MaterializedAgentIntegrationConfigDto;
  tool: MaterializedAgentIntegrationToolConfigDto;
}

export interface IntegrationToolCallAuditRecord {
  authorizedTool?: IntegrationToolCallAuditTarget | undefined;
  arguments: unknown;
  method: string;
  outcome: IntegrationAgentToolCallOutcome;
  errorCode: IntegrationAgentToolCallErrorLabel;
  providerStatus?: number | undefined;
}

export type IntegrationToolCallRecorder = (record: IntegrationToolCallAuditRecord) => void;

export interface CreateIntegrationToolCallRecorderOptions {
  recordMetric?: typeof recordIntegrationAgentToolCall | undefined;
  logInfo?:
    | ((context: Record<string, unknown>, message: 'integration tool call audited') => void)
    | undefined;
}

export function createIntegrationToolCallRecorder(
  caller: IntegrationToolCallCaller,
  options: CreateIntegrationToolCallRecorderOptions = {},
): IntegrationToolCallRecorder {
  const recordMetric = options.recordMetric ?? recordIntegrationAgentToolCall;
  const logInfo = options.logInfo ?? ((context, message) => logger().info(context, message));

  return (record) => {
    const provider = record.authorizedTool?.integration.provider ?? UNKNOWN_TOOL_LABEL;
    const toolId = record.authorizedTool?.tool.id ?? UNKNOWN_TOOL_LABEL;

    recordMetric({
      caller: caller.caller,
      provider,
      tool: toolId,
      method: record.method,
      outcome: record.outcome,
      error_code: record.errorCode,
    });

    logInfo(
      {
        ...callerLogContext(caller),
        connectionId: record.authorizedTool?.connection.id,
        provider,
        toolId,
        method: record.method,
        outcome: record.outcome,
        errorCode: record.errorCode,
        ...(record.providerStatus === undefined ? {} : {providerStatus: record.providerStatus}),
        argumentSummary: summarizeIntegrationToolArguments(record.arguments),
      },
      'integration tool call audited',
    );
  };
}

export interface IntegrationToolArgumentSummary {
  keys: string[];
  serializedSizeBytes: number;
}

export function summarizeIntegrationToolArguments(value: unknown): IntegrationToolArgumentSummary {
  return {
    keys: isRecord(value) ? Object.keys(value).sort() : [],
    serializedSizeBytes: serializedSize(value),
  };
}

function serializedSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return 0;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
