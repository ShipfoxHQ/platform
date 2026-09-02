import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import type {TriggerDecision} from '#core/entities/decision.js';
import type {
  TriggerEventReplay,
  TriggerReceivedEvent,
  TriggerReceivedEventSummary,
} from '#core/entities/received-event.js';
import {createTriggersInterModulePresentation} from './inter-module.js';

const mocks = vi.hoisted(() => ({
  getTriggerEventById: vi.fn(),
  listDecisionsByReceivedEventId: vi.fn(),
  listDecisionsByReceivedEventIdPage: vi.fn(),
  listReplaysOfTriggerEvent: vi.fn(),
  listReplaysOfTriggerEventPage: vi.fn(),
  listTriggerEventFacets: vi.fn(),
  listTriggerEvents: vi.fn(),
}));

vi.mock('#db/index.js', () => mocks);

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const EVENT_ID = '00000000-0000-4000-8000-000000000002';

function event(overrides: Partial<TriggerReceivedEvent> = {}): TriggerReceivedEvent {
  return {
    id: EVENT_ID,
    eventRef: 'event-ref',
    origin: 'integration',
    workspaceId: WORKSPACE_ID,
    provider: 'github',
    source: 'github',
    event: 'push',
    replayOfEventId: null,
    deliveryId: 'delivery-id',
    connectionId: '00000000-0000-4000-8000-000000000003',
    connectionName: 'GitHub',
    outcome: 'routed',
    matchedCount: 1,
    payload: {ref: 'refs/heads/main'},
    receivedAt: new Date('2026-08-05T12:00:00.000Z'),
    processedAt: new Date('2026-08-05T12:00:01.000Z'),
    createdAt: new Date('2026-08-05T12:00:02.000Z'),
    ...overrides,
  };
}

function summary(value: TriggerReceivedEvent): TriggerReceivedEventSummary {
  const {payload: _payload, ...withoutPayload} = value;
  return withoutPayload;
}

function presentation() {
  return createTriggersInterModulePresentation();
}

async function rejection(promise: Promise<unknown> | unknown): Promise<unknown> {
  return await Promise.resolve(promise).catch((error: unknown) => error);
}

describe('triggers inter-module presentation', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it('lists events with public filters and preserves the timestamp cursor', async () => {
    const nextCursor = {
      receivedAt: new Date('2026-08-05T11:00:00.000Z'),
      id: '00000000-0000-4000-8000-000000000004',
    };
    const item = event();
    mocks.listTriggerEvents.mockResolvedValue({
      events: [summary(item)],
      nextCursor,
    });
    const cursor = {
      receivedAt: '2026-08-05T13:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000005',
    };
    const from = '2026-08-01T00:00:00.000Z';
    const to = '2026-08-31T23:59:59.000Z';

    const result = await presentation().handlers.listTriggerEvents(
      {
        workspaceId: WORKSPACE_ID,
        limit: 10,
        cursor,
        filters: {
          source: ['github'],
          event: ['push'],
          origin: ['integration'],
          outcome: ['routed'],
          replayable: true,
          from,
          to,
        },
      },
      {signal: new AbortController().signal},
    );

    expect(mocks.listTriggerEvents).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      limit: 10,
      cursor: {receivedAt: new Date(cursor.receivedAt), id: cursor.id},
      filters: {
        source: ['github'],
        event: ['push'],
        origins: ['integration'],
        outcomes: ['routed'],
        replayable: true,
        from: new Date(from),
        to: new Date(to),
      },
    });
    expect(triggersInterModuleContract.methods.listTriggerEvents.output.parse(result)).toEqual({
      events: [
        {
          ...summary(item),
          receivedAt: item.receivedAt.toISOString(),
          processedAt: item.processedAt?.toISOString(),
          createdAt: item.createdAt.toISOString(),
        },
      ],
      nextCursor: {
        receivedAt: nextCursor.receivedAt.toISOString(),
        id: nextCursor.id,
      },
    });
  });

  it('lists the first page without optional inputs and returns a terminal cursor', async () => {
    mocks.listTriggerEvents.mockResolvedValue({events: [], nextCursor: null});

    const result = await presentation().handlers.listTriggerEvents(
      {workspaceId: WORKSPACE_ID, limit: 10},
      {signal: new AbortController().signal},
    );

    expect(mocks.listTriggerEvents).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      limit: 10,
      cursor: undefined,
      filters: undefined,
    });
    expect(triggersInterModuleContract.methods.listTriggerEvents.output.parse(result)).toEqual({
      events: [],
      nextCursor: null,
    });
  });

  it('rejects inverted list windows and invalid decision subscription pairings', () => {
    const listInput = triggersInterModuleContract.methods.listTriggerEvents.input.safeParse({
      workspaceId: WORKSPACE_ID,
      limit: 10,
      filters: {
        from: '2026-08-31T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      },
    });
    expect(listInput.success).toBe(false);

    const item = event();
    const baseDecision = {
      id: '00000000-0000-4000-8000-000000000006',
      receivedEventId: item.id,
      subscriptionKind: 'trigger' as const,
      subscriptionId: '00000000-0000-4000-8000-000000000007',
      subscriptionName: 'Deploy',
      workflowDefinitionId: null,
      projectId: null,
      workflowRunId: null,
      jobId: null,
      matcherKind: null,
      matcherOrdinal: null,
      decision: 'triggered' as const,
      runId: null,
      runName: null,
      reason: null,
      createdAt: '2026-08-05T12:00:03.000Z',
    };
    const detail = {
      ...summary(item),
      payload: item.payload,
      receivedAt: item.receivedAt.toISOString(),
      processedAt: item.processedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      decisions: [],
      replays: [],
    };
    const method = triggersInterModuleContract.methods.getTriggerEvent;

    expect(
      method.output.safeParse({
        ...detail,
        decisions: [{...baseDecision, subscriptionKind: 'dev', subscriptionId: item.id}],
      }).success,
    ).toBe(false);
    expect(
      method.output.safeParse({
        ...detail,
        decisions: [{...baseDecision, subscriptionId: null}],
      }).success,
    ).toBe(false);
    expect(
      method.output.safeParse({
        ...detail,
        decisions: [{...baseDecision, subscriptionKind: 'dev', subscriptionId: null}],
      }).success,
    ).toBe(true);
  });

  it('maps a missing event to not-found without loading related records', async () => {
    const eventId = '00000000-0000-4000-8000-000000000020';
    mocks.getTriggerEventById.mockResolvedValue(undefined);

    const error = await rejection(
      presentation().handlers.getTriggerEvent(
        {workspaceId: WORKSPACE_ID, eventId},
        {signal: new AbortController().signal},
      ),
    );

    const method = triggersInterModuleContract.methods.getTriggerEvent;
    expect(isInterModuleKnownError(method, error)).toBe(true);
    expect((error as {code: string}).code).toBe('trigger-event-not-found');
    expect((error as {details: unknown}).details).toEqual({eventId});
    expect(mocks.listDecisionsByReceivedEventId).not.toHaveBeenCalled();
    expect(mocks.listReplaysOfTriggerEvent).not.toHaveBeenCalled();
  });

  it('returns event details with decisions and replays', async () => {
    const item = event();
    const decision: TriggerDecision = {
      id: '00000000-0000-4000-8000-000000000006',
      receivedEventId: item.id,
      subscriptionKind: 'trigger',
      subscriptionId: '00000000-0000-4000-8000-000000000007',
      subscriptionName: 'Deploy',
      workflowDefinitionId: '00000000-0000-4000-8000-000000000008',
      projectId: '00000000-0000-4000-8000-000000000009',
      workflowRunId: '00000000-0000-4000-8000-000000000010',
      jobId: '00000000-0000-4000-8000-000000000011',
      matcherKind: null,
      matcherOrdinal: null,
      decision: 'triggered',
      runId: '00000000-0000-4000-8000-000000000012',
      runName: 'deploy',
      reason: null,
      createdAt: new Date('2026-08-05T12:00:03.000Z'),
    };
    const replay: TriggerEventReplay = {
      id: '00000000-0000-4000-8000-000000000013',
      receivedAt: new Date('2026-08-05T12:01:00.000Z'),
      outcome: 'routed',
      runId: '00000000-0000-4000-8000-000000000014',
    };
    mocks.getTriggerEventById.mockResolvedValue(item);
    mocks.listDecisionsByReceivedEventId.mockResolvedValue([decision]);
    mocks.listReplaysOfTriggerEvent.mockResolvedValue([replay]);

    const result = await presentation().handlers.getTriggerEvent(
      {workspaceId: WORKSPACE_ID, eventId: item.id},
      {signal: new AbortController().signal},
    );

    expect(mocks.listDecisionsByReceivedEventId).toHaveBeenCalledWith(item.id);
    expect(mocks.listReplaysOfTriggerEvent).toHaveBeenCalledWith(item.id, WORKSPACE_ID);
    expect(triggersInterModuleContract.methods.getTriggerEvent.output.parse(result)).toEqual({
      ...summary(item),
      payload: item.payload,
      receivedAt: item.receivedAt.toISOString(),
      processedAt: item.processedAt?.toISOString(),
      createdAt: item.createdAt.toISOString(),
      decisions: [
        {
          ...decision,
          createdAt: decision.createdAt.toISOString(),
        },
      ],
      replays: [
        {
          ...replay,
          receivedAt: replay.receivedAt.toISOString(),
        },
      ],
    });
  });

  it('returns empty decisions and replays for an event without related records', async () => {
    const item = event({origin: 'cron', source: 'cron', event: 'scheduled'});
    mocks.getTriggerEventById.mockResolvedValue(item);
    mocks.listDecisionsByReceivedEventId.mockResolvedValue([]);
    mocks.listReplaysOfTriggerEvent.mockResolvedValue([]);

    const result = await presentation().handlers.getTriggerEvent(
      {workspaceId: WORKSPACE_ID, eventId: item.id},
      {signal: new AbortController().signal},
    );

    expect(triggersInterModuleContract.methods.getTriggerEvent.output.parse(result)).toMatchObject({
      decisions: [],
      replays: [],
    });
  });

  it('uses bounded producer pages and carries exact history totals for diagnostics', async () => {
    const item = event();
    mocks.getTriggerEventById.mockResolvedValue(item);
    mocks.listDecisionsByReceivedEventIdPage.mockResolvedValue({items: [], totalCount: 55});
    mocks.listReplaysOfTriggerEventPage.mockResolvedValue({items: [], totalCount: 25});

    const result = await presentation().handlers.getTriggerEvent(
      {
        workspaceId: WORKSPACE_ID,
        eventId: item.id,
        diagnostic: {decisions: 50, replays: 20},
      },
      {signal: new AbortController().signal},
    );

    expect(mocks.listDecisionsByReceivedEventIdPage).toHaveBeenCalledWith({
      receivedEventId: item.id,
      limit: 50,
    });
    expect(mocks.listReplaysOfTriggerEventPage).toHaveBeenCalledWith({
      eventId: item.id,
      workspaceId: WORKSPACE_ID,
      limit: 20,
    });
    expect(triggersInterModuleContract.methods.getTriggerEvent.output.parse(result)).toMatchObject({
      decisions: [],
      decisionsTotalCount: 55,
      replays: [],
      replaysTotalCount: 25,
    });
    expect(mocks.listDecisionsByReceivedEventId).not.toHaveBeenCalled();
    expect(mocks.listReplaysOfTriggerEvent).not.toHaveBeenCalled();
  });

  it('uses one not-found error for an event outside the requested workspace', async () => {
    const item = event({workspaceId: '00000000-0000-4000-8000-000000000020'});
    mocks.getTriggerEventById.mockResolvedValue(item);

    const error = await rejection(
      presentation().handlers.getTriggerEvent(
        {workspaceId: WORKSPACE_ID, eventId: item.id},
        {signal: new AbortController().signal},
      ),
    );

    const method = triggersInterModuleContract.methods.getTriggerEvent;
    expect(isInterModuleKnownError(method, error)).toBe(true);
    expect((error as {code: string}).code).toBe('trigger-event-not-found');
    expect((error as {details: unknown}).details).toEqual({eventId: item.id});
    expect(mocks.listDecisionsByReceivedEventId).not.toHaveBeenCalled();
    expect(mocks.listReplaysOfTriggerEvent).not.toHaveBeenCalled();
  });

  it('lists workspace facet counts through the existing query', async () => {
    const facets = {
      sources: [{value: 'github', count: 2}],
      events: [{value: 'push', count: 2}],
      origins: [{value: 'integration', count: 2}],
    };
    mocks.listTriggerEventFacets.mockResolvedValue(facets);

    const result = await presentation().handlers.getTriggerEventFacets(
      {workspaceId: WORKSPACE_ID},
      {signal: new AbortController().signal},
    );

    expect(mocks.listTriggerEventFacets).toHaveBeenCalledWith({workspaceId: WORKSPACE_ID});
    expect(triggersInterModuleContract.methods.getTriggerEventFacets.output.parse(result)).toEqual(
      facets,
    );
  });

  it('returns empty facet counts for a workspace without events', async () => {
    const facets = {sources: [], events: [], origins: []};
    mocks.listTriggerEventFacets.mockResolvedValue(facets);

    const result = await presentation().handlers.getTriggerEventFacets(
      {workspaceId: WORKSPACE_ID},
      {signal: new AbortController().signal},
    );

    expect(triggersInterModuleContract.methods.getTriggerEventFacets.output.parse(result)).toEqual(
      facets,
    );
  });
});
