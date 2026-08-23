import type {
  TriggerDecisionDto,
  TriggerEventDto,
  TriggerEventListItemDto,
  TriggerEventReplayDto,
} from '@shipfox/api-triggers-dto';
import type {TriggerDecision} from '#core/entities/decision.js';
import type {
  TriggerReceivedEvent,
  TriggerReceivedEventSummary,
} from '#core/entities/received-event.js';
import type {TriggerEventReplay} from '#db/event-queries.js';

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
    reason: decision.reason,
    created_at: decision.createdAt.toISOString(),
  };
}
