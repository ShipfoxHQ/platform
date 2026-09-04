import type {
  TriggerDecisionDiagnosticDto,
  TriggerDecisionDto,
  TriggerEventDto,
  TriggerEventListItemDto,
  TriggerEventReplayDto,
} from '@shipfox/api-triggers-dto';
import type {TriggerDecision} from '#core/entities/decision.js';
import type {TriggerDecisionDiagnostic} from '#core/entities/diagnostic.js';
import type {
  TriggerEventReplay,
  TriggerReceivedEvent,
  TriggerReceivedEventSummary,
} from '#core/entities/received-event.js';

const PUBLIC_LEGACY_DECISION_REASONS = new Set([
  'Trigger filter evaluation failed',
  'Listener filter evaluation failed',
  'Trigger subscription filter must be a non-empty string when set',
  'Listener subscription filter must be a non-empty string when set',
  'Listener filter snapshot must be an object when set',
  'Listener filter output types must be valid when set',
]);
const PUBLIC_LEGACY_WORKFLOW_REASON = new RegExp(
  '^workflows\\.(?:startRunFromTrigger|startDevRun|deliverEventToJobListener): ' +
    '(?:workspace-not-found|workspace-suspended|workspace-deleted|definition-not-found|' +
    'project-mismatch|agent-config-unresolvable|agent-integration-materialization-failed)$',
);

export function toTriggerEventListItemDto(
  event: TriggerReceivedEventSummary,
): TriggerEventListItemDto {
  return {
    id: event.id,
    event_ref: event.eventRef,
    origin: event.origin,
    workspace_id: event.workspaceId,
    provider: event.provider,
    source: event.source,
    event: event.event,
    replay_of_event_id: event.replayOfEventId,
    delivery_id: event.deliveryId,
    connection_id: event.connectionId,
    outcome: event.outcome,
    matched_count: event.matchedCount,
    received_at: event.receivedAt.toISOString(),
    processed_at: event.processedAt?.toISOString() ?? null,
    created_at: event.createdAt.toISOString(),
  };
}

export function toTriggerEventDto(event: TriggerReceivedEvent): TriggerEventDto {
  return {
    ...toTriggerEventListItemDto(event),
    connection_name: event.connectionName,
    payload: event.payload,
    processing_diagnostic: event.processingDiagnostic ?? null,
  };
}

export function toTriggerEventReplayDto(replay: TriggerEventReplay): TriggerEventReplayDto {
  return {
    id: replay.id,
    received_at: replay.receivedAt.toISOString(),
    outcome: replay.outcome,
    run_id: replay.runId,
  };
}

export function toTriggerDecisionDto(decision: TriggerDecision): TriggerDecisionDto {
  return {
    id: decision.id,
    received_event_id: decision.receivedEventId,
    subscription_kind: decision.subscriptionKind,
    subscription_id: decision.subscriptionId,
    subscription_name: decision.subscriptionName,
    workflow_definition_id: decision.workflowDefinitionId,
    project_id: decision.projectId,
    workflow_run_id: decision.workflowRunId,
    job_id: decision.jobId,
    matcher_kind: decision.matcherKind,
    matcher_ordinal: decision.matcherOrdinal,
    decision: decision.decision,
    run_id: decision.runId,
    run_name: decision.runName,
    reason: toPublicTriggerDecisionReason(decision.reason),
    diagnostic:
      decision.diagnostic == null ? null : toTriggerDecisionDiagnosticDto(decision.diagnostic),
    created_at: decision.createdAt.toISOString(),
  };
}

export function toPublicTriggerDecisionReason(reason: string | null): string | null {
  if (reason === null) return null;
  if (PUBLIC_LEGACY_DECISION_REASONS.has(reason)) return reason;
  return PUBLIC_LEGACY_WORKFLOW_REASON.test(reason) ? reason : null;
}

function toTriggerDecisionDiagnosticDto(
  diagnostic: TriggerDecisionDiagnostic,
): TriggerDecisionDiagnosticDto {
  switch (diagnostic.code) {
    case 'expression-result-not-boolean':
      return {
        version: diagnostic.version,
        code: diagnostic.code,
        actual_type: diagnostic.actualType,
      };
    case 'interpolation-unresolvable':
      return {
        version: diagnostic.version,
        code: diagnostic.code,
        field: diagnostic.field,
        ...(diagnostic.envKey === undefined ? {} : {env_key: diagnostic.envKey}),
      };
    case 'source-snapshot-too-large':
      return {
        version: diagnostic.version,
        code: diagnostic.code,
        limit_bytes: diagnostic.limitBytes,
        measured_bytes: diagnostic.measuredBytes,
      };
    case 'diagnostic-too-large':
      return {
        version: diagnostic.version,
        code: diagnostic.code,
        ...(diagnostic.field === undefined ? {} : {field: diagnostic.field}),
        limit_bytes: diagnostic.limitBytes,
        measured_bytes: diagnostic.measuredBytes,
      };
    case 'workflow-execution-payload-too-large':
      return {
        version: diagnostic.version,
        code: diagnostic.code,
        field: diagnostic.field,
        limit_bytes: diagnostic.limitBytes,
        measured_bytes: diagnostic.measuredBytes,
        overshoot_bytes: diagnostic.overshootBytes,
      };
    case 'listener-event-payload-too-large':
      return {
        version: diagnostic.version,
        code: diagnostic.code,
        limit_bytes: diagnostic.limitBytes,
        measured_bytes: diagnostic.measuredBytes,
        overshoot_bytes: diagnostic.overshootBytes,
      };
    default:
      return diagnostic;
  }
}
