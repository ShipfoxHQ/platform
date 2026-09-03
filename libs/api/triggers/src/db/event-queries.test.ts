import {decisionFactory, receivedEventFactory} from '#test/index.js';
import {db} from './db.js';
import {
  listDecisionsByReceivedEventIdPage,
  listReplaysOfTriggerEventPage,
} from './event-queries.js';
import {triggersDecisions} from './schema/decisions.js';

describe('diagnostic event history pages', () => {
  test('returns newest decisions first with a descending id tie-break and full totals', async () => {
    const event = await receivedEventFactory.create();
    const tiedAt = new Date('2026-08-05T12:00:00.000Z');
    const olderAt = new Date('2026-08-04T12:00:00.000Z');

    await insertDecision(event.id, '00000000-0000-4000-8000-000000000101', tiedAt);
    await insertDecision(event.id, '00000000-0000-4000-8000-000000000102', tiedAt);
    await insertDecision(event.id, '00000000-0000-4000-8000-000000000103', olderAt);

    const page = await listDecisionsByReceivedEventIdPage({
      receivedEventId: event.id,
      limit: 2,
    });

    expect(page.items.map((item) => item.id)).toEqual([
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000101',
    ]);
    expect(page.totalCount).toBe(3);
  });

  test('returns newest workspace dev replays with full scoped totals', async () => {
    const workspaceId = crypto.randomUUID();
    const otherWorkspaceId = crypto.randomUUID();
    const source = await receivedEventFactory.create({workspaceId, origin: 'integration'});
    const tiedAt = new Date('2026-08-05T12:00:00.000Z');
    const olderAt = new Date('2026-08-04T12:00:00.000Z');
    const first = await receivedEventFactory.create({
      workspaceId,
      origin: 'dev',
      replayOfEventId: source.id,
      receivedAt: tiedAt,
    });
    const second = await receivedEventFactory.create({
      workspaceId,
      origin: 'dev',
      replayOfEventId: source.id,
      receivedAt: tiedAt,
    });
    const older = await receivedEventFactory.create({
      workspaceId,
      origin: 'dev',
      replayOfEventId: source.id,
      receivedAt: olderAt,
    });
    await receivedEventFactory.create({
      workspaceId,
      origin: 'integration',
      replayOfEventId: source.id,
      receivedAt: tiedAt,
    });
    await receivedEventFactory.create({
      workspaceId: otherWorkspaceId,
      origin: 'dev',
      replayOfEventId: source.id,
      receivedAt: tiedAt,
    });

    const firstRunId = crypto.randomUUID();
    const secondRunId = crypto.randomUUID();
    await decisionFactory.create({
      receivedEventId: first.id,
      subscriptionKind: 'dev',
      subscriptionId: null,
      workflowDefinitionId: null,
      projectId: null,
      runId: firstRunId,
    });
    await decisionFactory.create({
      receivedEventId: second.id,
      subscriptionKind: 'dev',
      subscriptionId: null,
      workflowDefinitionId: null,
      projectId: null,
      runId: secondRunId,
    });

    const page = await listReplaysOfTriggerEventPage({
      eventId: source.id,
      workspaceId,
      limit: 2,
    });
    const expectedIds = [first.id, second.id].sort().reverse();

    expect(page.items.map((item) => item.id)).toEqual(expectedIds);
    expect(page.items.map((item) => item.runId)).toEqual(
      expectedIds.map((id) => (id === first.id ? firstRunId : secondRunId)),
    );
    expect(page.totalCount).toBe(3);
    expect(page.items.map((item) => item.id)).not.toContain(older.id);
  });
});

async function insertDecision(receivedEventId: string, id: string, createdAt: Date): Promise<void> {
  await db()
    .insert(triggersDecisions)
    .values({
      id,
      receivedEventId,
      subscriptionKind: 'trigger',
      subscriptionId: crypto.randomUUID(),
      subscriptionName: `decision-${id}`,
      workflowDefinitionId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workflowRunId: null,
      jobId: null,
      matcherKind: null,
      matcherOrdinal: null,
      decision: 'triggered',
      runId: crypto.randomUUID(),
      runName: 'diagnostic test run',
      reason: null,
      createdAt,
    });
}
