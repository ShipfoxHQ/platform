import type {LeasedJobContext} from '@shipfox/api-auth-context';
import {logger} from '@shipfox/node-opentelemetry';
import {
  type IntegrationAgentToolCallErrorLabel,
  type IntegrationAgentToolCallOutcome,
  recordIntegrationAgentToolCall,
} from '#metrics/index.js';
import type {AuthorizedIntegrationTool} from './resolve-authorized-tools.js';

export type {IntegrationAgentToolCallErrorCode} from '#metrics/index.js';

export const UNKNOWN_TOOL_LABEL = 'unknown';
export const NO_METHOD_LABEL = 'none';
export const INVALID_METHOD_LABEL = 'invalid';

export interface IntegrationToolArgumentSummary {
  keys: string[];
  serializedSizeBytes: number;
}

export interface IntegrationToolCallAuditRecord {
  authorizedTool?: AuthorizedIntegrationTool | undefined;
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
  lease: LeasedJobContext,
  options: CreateIntegrationToolCallRecorderOptions = {},
): IntegrationToolCallRecorder {
  const recordMetric = options.recordMetric ?? recordIntegrationAgentToolCall;
  const logInfo = options.logInfo ?? ((context, message) => logger().info(context, message));

  return (record) => {
    const provider = record.authorizedTool?.integration.provider ?? UNKNOWN_TOOL_LABEL;
    const toolId = record.authorizedTool?.tool.id ?? UNKNOWN_TOOL_LABEL;

    recordMetric({
      provider,
      tool: toolId,
      method: record.method,
      outcome: record.outcome,
      error_code: record.errorCode,
    });

    logInfo(
      {
        jobId: lease.jobId,
        jobExecutionId: lease.jobExecutionId,
        workflowRunId: lease.workflowRunId,
        workflowRunAttemptId: lease.workflowRunAttemptId,
        workspaceId: lease.workspaceId,
        currentStepId: lease.currentStepId,
        currentStepAttempt: lease.currentStepAttempt,
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
