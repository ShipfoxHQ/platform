import type {
  TriggerDecisionDiagnosticDto,
  TriggerDecisionDto,
  TriggerEventDetailResponseDto,
  TriggerEventFacetItemDto,
  TriggerEventFacetsResponseDto,
  TriggerEventListItemDto,
  TriggerEventListResponseDto,
} from '@shipfox/api-triggers-dto';
import type {
  TriggerEventDecisionDiagnostic,
  TriggerEventDetail,
  TriggerEventFacetItem,
  TriggerEventFacets,
  TriggerEventListPage,
  TriggerEventMatchedWorkflowResult,
  TriggerEventSummary,
} from '#core/trigger-event.js';

export function toTriggerEventSummary(event: TriggerEventListItemDto): TriggerEventSummary {
  return {
    id: event.id,
    eventRef: event.event_ref,
    origin: event.origin,
    workspaceId: event.workspace_id,
    provider: event.provider,
    source: event.source,
    event: event.event,
    deliveryId: event.delivery_id,
    connectionId: event.connection_id,
    outcome: event.outcome,
    matchedCount: event.matched_count,
    receivedAt: event.received_at,
    processedAt: event.processed_at,
    createdAt: event.created_at,
  };
}

export function toTriggerEventListPage(
  response: TriggerEventListResponseDto,
): TriggerEventListPage {
  return {
    events: response.trigger_events.map(toTriggerEventSummary),
    nextCursor: response.next_cursor,
  };
}

function toMatchedWorkflowResult(decision: TriggerDecisionDto): TriggerEventMatchedWorkflowResult {
  return {
    id: decision.id,
    subscriptionKind: decision.subscription_kind,
    subscriptionName: decision.subscription_name,
    workflowDefinitionId: decision.workflow_definition_id,
    decision: decision.decision,
    projectId: decision.project_id,
    workflowRunId: decision.workflow_run_id,
    jobId: decision.job_id,
    matcherKind: decision.matcher_kind,
    matcherOrdinal: decision.matcher_ordinal,
    runId: decision.run_id,
    runName: decision.run_name,
    reason: decision.reason,
    diagnostic: decision.diagnostic == null ? null : toDecisionDiagnostic(decision.diagnostic),
  };
}

export function toTriggerEventDetail(response: TriggerEventDetailResponseDto): TriggerEventDetail {
  return {
    ...toTriggerEventSummary(response),
    connectionName: response.connection_name,
    payload: response.payload,
    processingDiagnostic: response.processing_diagnostic ?? null,
    decisions: response.decisions.map(toMatchedWorkflowResult),
  };
}

function toDecisionDiagnostic(
  diagnostic: TriggerDecisionDiagnosticDto,
): TriggerEventDecisionDiagnostic {
  switch (diagnostic.code) {
    case 'expression-result-not-boolean':
      return {
        version: diagnostic.version,
        code: diagnostic.code,
        actualType: diagnostic.actual_type,
      };
    case 'interpolation-unresolvable':
      return {
        version: diagnostic.version,
        code: diagnostic.code,
        field: diagnostic.field,
        ...(diagnostic.env_key === undefined ? {} : {envKey: diagnostic.env_key}),
      };
    case 'source-snapshot-too-large':
      return {
        version: diagnostic.version,
        code: diagnostic.code,
        limitBytes: diagnostic.limit_bytes,
        measuredBytes: diagnostic.measured_bytes,
      };
    case 'diagnostic-too-large':
      return {
        version: diagnostic.version,
        code: diagnostic.code,
        ...(diagnostic.field === undefined ? {} : {field: diagnostic.field}),
        limitBytes: diagnostic.limit_bytes,
        measuredBytes: diagnostic.measured_bytes,
      };
    case 'workflow-execution-payload-too-large':
      return {
        version: diagnostic.version,
        code: diagnostic.code,
        field: diagnostic.field,
        limitBytes: diagnostic.limit_bytes,
        measuredBytes: diagnostic.measured_bytes,
        overshootBytes: diagnostic.overshoot_bytes,
      };
    case 'listener-event-payload-too-large':
      return {
        version: diagnostic.version,
        code: diagnostic.code,
        limitBytes: diagnostic.limit_bytes,
        measuredBytes: diagnostic.measured_bytes,
        overshootBytes: diagnostic.overshoot_bytes,
      };
    default:
      return diagnostic;
  }
}

function toTriggerEventFacetItem(item: TriggerEventFacetItemDto): TriggerEventFacetItem {
  return {value: item.value, count: item.count};
}

export function toTriggerEventFacets(response: TriggerEventFacetsResponseDto): TriggerEventFacets {
  return {
    sources: response.sources.map(toTriggerEventFacetItem),
    events: response.events.map(toTriggerEventFacetItem),
  };
}
