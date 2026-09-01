import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import type {TriggerDecision} from '#core/entities/decision.js';
import type {
  TriggerEventReplay,
  TriggerReceivedEvent,
  TriggerReceivedEventSummary,
} from '#core/entities/received-event.js';
import {
  getTriggerEventById,
  listDecisionsByReceivedEventId,
  listReplaysOfTriggerEvent,
  listTriggerEventFacets,
  listTriggerEvents,
} from '#db/index.js';

export function createTriggersInterModulePresentation(): InterModulePresentation<
  typeof triggersInterModuleContract
> {
  return defineInterModulePresentation(triggersInterModuleContract, {
    listTriggerEvents: async ({workspaceId, limit, cursor, filters}) => {
      const result = await listTriggerEvents({
        workspaceId,
        limit,
        cursor: cursor ? {receivedAt: new Date(cursor.receivedAt), id: cursor.id} : undefined,
        filters: filters
          ? {
              source: filters.source,
              event: filters.event,
              origins: filters.origin,
              outcomes: filters.outcome,
              replayable: filters.replayable,
              from: filters.from ? new Date(filters.from) : undefined,
              to: filters.to ? new Date(filters.to) : undefined,
            }
          : undefined,
      });

      return {
        events: result.events.map(toTriggerEventListItem),
        nextCursor: result.nextCursor
          ? {
              receivedAt: result.nextCursor.receivedAt.toISOString(),
              id: result.nextCursor.id,
            }
          : null,
      };
    },
    getTriggerEvent: async ({workspaceId, eventId}) => {
      const event = await getTriggerEventById(eventId);
      if (!event || event.workspaceId !== workspaceId) {
        throw createInterModuleKnownError(
          triggersInterModuleContract.methods.getTriggerEvent,
          'trigger-event-not-found',
          {eventId},
        );
      }

      const [decisions, replays] = await Promise.all([
        listDecisionsByReceivedEventId(event.id),
        listReplaysOfTriggerEvent(event.id, event.workspaceId),
      ]);

      return {
        ...toTriggerEvent(event),
        decisions: decisions.map(toTriggerDecision),
        replays: replays.map(toTriggerEventReplay),
      };
    },
    getTriggerEventFacets: async ({workspaceId}) => await listTriggerEventFacets({workspaceId}),
  });
}

function toTriggerEventListItem(event: TriggerReceivedEventSummary) {
  return {
    id: event.id,
    eventRef: event.eventRef,
    origin: event.origin,
    workspaceId: event.workspaceId,
    provider: event.provider,
    source: event.source,
    event: event.event,
    replayOfEventId: event.replayOfEventId,
    deliveryId: event.deliveryId,
    connectionId: event.connectionId,
    connectionName: event.connectionName,
    outcome: event.outcome,
    matchedCount: event.matchedCount,
    receivedAt: event.receivedAt.toISOString(),
    processedAt: event.processedAt?.toISOString() ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}

function toTriggerEvent(event: TriggerReceivedEvent) {
  return {
    ...toTriggerEventListItem(event),
    payload: event.payload,
  };
}

function toTriggerDecision(decision: TriggerDecision) {
  return {
    id: decision.id,
    receivedEventId: decision.receivedEventId,
    subscriptionKind: decision.subscriptionKind,
    subscriptionId: decision.subscriptionId,
    subscriptionName: decision.subscriptionName,
    workflowDefinitionId: decision.workflowDefinitionId,
    projectId: decision.projectId,
    workflowRunId: decision.workflowRunId,
    jobId: decision.jobId,
    matcherKind: decision.matcherKind,
    matcherOrdinal: decision.matcherOrdinal,
    decision: decision.decision,
    runId: decision.runId,
    runName: decision.runName,
    reason: decision.reason,
    createdAt: decision.createdAt.toISOString(),
  };
}

function toTriggerEventReplay(replay: TriggerEventReplay) {
  return {
    id: replay.id,
    receivedAt: replay.receivedAt.toISOString(),
    outcome: replay.outcome,
    runId: replay.runId,
  };
}
