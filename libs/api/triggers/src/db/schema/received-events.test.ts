import {eq} from 'drizzle-orm';
import {db} from '../db.js';
import {
  type TriggerReceivedEventDb,
  type TriggerReceivedEventInsertDb,
  toTriggerReceivedEvent,
  triggersReceivedEvents,
} from './received-events.js';

describe('toTriggerReceivedEvent', () => {
  test('maps a fully populated row to the domain entity', () => {
    const row: TriggerReceivedEventDb = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      eventRef: 'evt-1',
      origin: 'integration',
      workspaceId: '019e98ab-b90f-7265-b13c-8b441c991381',
      provider: 'github',
      source: 'github',
      event: 'push',
      replayOfEventId: '019e98ab-b90f-7265-b13c-8b441c991380',
      deliveryId: 'delivery-1',
      connectionId: '019e98ab-b90f-7265-b13c-8b441c991382',
      connectionName: 'Acme Production',
      outcome: 'routed',
      matchedCount: 3,
      payload: {ref: 'refs/heads/main'},
      receivedAt: new Date('2026-06-09T10:00:00.000Z'),
      processedAt: new Date('2026-06-09T10:00:01.000Z'),
      createdAt: new Date('2026-06-09T10:00:02.000Z'),
    };

    const result = toTriggerReceivedEvent(row);

    expect(result).toEqual({
      id: row.id,
      eventRef: 'evt-1',
      origin: 'integration',
      workspaceId: row.workspaceId,
      provider: 'github',
      source: 'github',
      event: 'push',
      replayOfEventId: '019e98ab-b90f-7265-b13c-8b441c991380',
      deliveryId: 'delivery-1',
      connectionId: row.connectionId,
      connectionName: 'Acme Production',
      outcome: 'routed',
      matchedCount: 3,
      payload: {ref: 'refs/heads/main'},
      receivedAt: row.receivedAt,
      processedAt: row.processedAt,
      createdAt: row.createdAt,
    });
  });

  test('passes through null delivery, connection, payload, and processed_at', () => {
    const row: TriggerReceivedEventDb = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      eventRef: 'evt-2',
      origin: 'manual',
      workspaceId: '019e98ab-b90f-7265-b13c-8b441c991381',
      provider: null,
      source: 'manual',
      event: 'fire',
      replayOfEventId: null,
      deliveryId: null,
      connectionId: null,
      connectionName: null,
      outcome: 'received',
      matchedCount: 0,
      payload: null,
      receivedAt: new Date('2026-06-09T10:00:00.000Z'),
      processedAt: null,
      createdAt: new Date('2026-06-09T10:00:02.000Z'),
    };

    const result = toTriggerReceivedEvent(row);

    expect(result.deliveryId).toBeNull();
    expect(result.connectionId).toBeNull();
    expect(result.connectionName).toBeNull();
    expect(result.payload).toBeNull();
    expect(result.processedAt).toBeNull();
    expect(result.replayOfEventId).toBeNull();
  });
});

describe('triggers_received_events schema', () => {
  test('applies defaults and maps an inserted row', async () => {
    const values: TriggerReceivedEventInsertDb = {
      eventRef: crypto.randomUUID(),
      origin: 'integration',
      workspaceId: crypto.randomUUID(),
      source: 'github',
      event: 'push',
      receivedAt: new Date(),
    };

    const [inserted] = await db()
      .insert(triggersReceivedEvents)
      .values(values)
      .returning({id: triggersReceivedEvents.id});
    if (!inserted) throw new Error('insert returned no rows');
    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, inserted.id));
    if (!row) throw new Error('select returned no rows');
    const result = toTriggerReceivedEvent(row);

    expect(row.outcome).toBe('received');
    expect(row.matchedCount).toBe(0);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({
      eventRef: values.eventRef,
      origin: 'integration',
      workspaceId: values.workspaceId,
      source: 'github',
      event: 'push',
      outcome: 'received',
      matchedCount: 0,
    });
  });

  test('rejects a duplicate event_ref', async () => {
    const values: TriggerReceivedEventInsertDb = {
      eventRef: crypto.randomUUID(),
      origin: 'integration',
      workspaceId: crypto.randomUUID(),
      source: 'github',
      event: 'push',
      receivedAt: new Date(),
    };
    await db().insert(triggersReceivedEvents).values(values);

    const duplicate = db().insert(triggersReceivedEvents).values(values);

    await expect(duplicate).rejects.toThrow();
  });

  test('stores a dev origin with a replay_of_event_id link', async () => {
    const source = await db()
      .insert(triggersReceivedEvents)
      .values({
        eventRef: crypto.randomUUID(),
        origin: 'integration',
        workspaceId: crypto.randomUUID(),
        source: 'github',
        event: 'push',
        receivedAt: new Date(),
      })
      .returning({id: triggersReceivedEvents.id});
    if (!source[0]) throw new Error('insert returned no rows');

    const values: TriggerReceivedEventInsertDb = {
      eventRef: crypto.randomUUID(),
      origin: 'dev',
      workspaceId: crypto.randomUUID(),
      source: 'github',
      event: 'push',
      replayOfEventId: source[0].id,
      payload: {ref: 'refs/heads/main'},
      receivedAt: new Date(),
    };
    const [inserted] = await db()
      .insert(triggersReceivedEvents)
      .values(values)
      .returning({id: triggersReceivedEvents.id});
    if (!inserted) throw new Error('insert returned no rows');
    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, inserted.id));

    expect(row?.origin).toBe('dev');
    expect(row?.replayOfEventId).toBe(source[0].id);
    expect(toTriggerReceivedEvent(row as TriggerReceivedEventDb).replayOfEventId).toBe(
      source[0].id,
    );
  });
});
