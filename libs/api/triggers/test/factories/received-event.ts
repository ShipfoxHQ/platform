import {Factory} from 'fishery';
import type {TriggerReceivedEvent} from '#core/entities/received-event.js';
import {db} from '#db/db.js';
import {toTriggerReceivedEvent, triggersReceivedEvents} from '#db/schema/received-events.js';

export const receivedEventFactory = Factory.define<TriggerReceivedEvent>(({sequence, onCreate}) => {
  onCreate(async (event) => {
    const [row] = await db()
      .insert(triggersReceivedEvents)
      .values({
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
        payload: event.payload,
        processingDiagnostic: event.processingDiagnostic ?? null,
        receivedAt: event.receivedAt,
        processedAt: event.processedAt,
      })
      .returning();
    if (!row) throw new Error('Insert returned no rows');
    return toTriggerReceivedEvent(row);
  });

  return {
    id: crypto.randomUUID(),
    eventRef: crypto.randomUUID(),
    origin: 'integration',
    workspaceId: crypto.randomUUID(),
    provider: 'github',
    source: 'github',
    event: 'push',
    replayOfEventId: null,
    deliveryId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    connectionName: 'Acme Production',
    outcome: 'routed',
    matchedCount: 1,
    payload: {ref: `refs/heads/main-${sequence}`},
    processingDiagnostic: null,
    receivedAt: new Date(),
    processedAt: new Date(),
    createdAt: new Date(),
  };
});
