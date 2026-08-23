import {configureApiClient} from '@shipfox/client-api';
import {
  getTriggerEvent,
  getTriggerEventFacets,
  listTriggerEvents,
  triggerEventsQueryKeys,
} from './trigger-events.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function requestFrom(fetchImpl: ReturnType<typeof vi.fn>): Request {
  return fetchImpl.mock.calls[0]?.[0] as Request;
}

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function triggerEventDto(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    event_ref: 'github:delivery-1:push',
    origin: 'integration',
    workspace_id: WORKSPACE_ID,
    provider: 'github',
    source: 'github',
    event: 'push',
    replay_of_event_id: null,
    delivery_id: 'delivery-1',
    connection_id: '33333333-3333-4333-8333-333333333333',
    outcome: 'routed',
    matched_count: 1,
    received_at: '2026-06-01T00:00:00.000Z',
    processed_at: '2026-06-01T00:00:01.000Z',
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('triggerEventsQueryKeys', () => {
  test('list key nests under the workspace lists key', () => {
    const workspaceId = WORKSPACE_ID;

    const key = triggerEventsQueryKeys.list(workspaceId, {});

    expect(key).toEqual([
      'trigger-events',
      'list',
      workspaceId,
      50,
      {source: null, event: null, outcome: null, from: null, to: null},
    ]);
    expect(key.slice(0, 3)).toEqual(triggerEventsQueryKeys.lists(workspaceId));
  });

  test('keeps distinct page limits on distinct keys', () => {
    const workspaceId = WORKSPACE_ID;

    const defaultLimit = triggerEventsQueryKeys.list(workspaceId, {});
    const compactLimit = triggerEventsQueryKeys.list(workspaceId, {}, 25);

    expect(defaultLimit).not.toEqual(compactLimit);
    expect(defaultLimit[3]).toBe(50);
    expect(compactLimit[3]).toBe(25);
  });

  test('normalizes absent filter fields to null so empty variants share a key', () => {
    const workspaceId = WORKSPACE_ID;

    const empty = triggerEventsQueryKeys.list(workspaceId, {});
    const allUndefined = triggerEventsQueryKeys.list(workspaceId, {
      source: undefined,
      event: undefined,
      outcome: undefined,
      from: undefined,
      to: undefined,
    });

    expect(allUndefined).toEqual(empty);
  });

  test('treats an empty outcome array as no outcome filter', () => {
    const workspaceId = WORKSPACE_ID;

    const key = triggerEventsQueryKeys.list(workspaceId, {outcome: []});

    expect(key[4]).toMatchObject({outcome: null});
  });

  test('treats empty source and event arrays as no filter', () => {
    const workspaceId = WORKSPACE_ID;

    const key = triggerEventsQueryKeys.list(workspaceId, {source: [], event: []});

    expect(key[4]).toMatchObject({source: null, event: null});
  });

  test('sorts and de-duplicates outcome so filter order does not split the cache', () => {
    const workspaceId = WORKSPACE_ID;

    const a = triggerEventsQueryKeys.list(workspaceId, {outcome: ['routed', 'failed']});
    const b = triggerEventsQueryKeys.list(workspaceId, {outcome: ['failed', 'routed', 'failed']});

    expect(a).toEqual(b);
    expect(a[4]).toMatchObject({outcome: ['failed', 'routed']});
  });

  test('sorts and de-duplicates source and event filters so order does not split the cache', () => {
    const workspaceId = WORKSPACE_ID;

    const a = triggerEventsQueryKeys.list(workspaceId, {
      source: ['github', 'gitea'],
      event: ['push', 'pull_request'],
    });
    const b = triggerEventsQueryKeys.list(workspaceId, {
      source: ['gitea', 'github', 'gitea'],
      event: ['pull_request', 'push', 'push'],
    });

    expect(a).toEqual(b);
    expect(a[4]).toMatchObject({
      source: ['gitea', 'github'],
      event: ['pull_request', 'push'],
    });
  });

  test('keeps distinct filters on distinct keys', () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';

    const push = triggerEventsQueryKeys.list(workspaceId, {event: ['push']});
    const pr = triggerEventsQueryKeys.list(workspaceId, {event: ['pull_request']});

    expect(push).not.toEqual(pr);
  });

  test('detail key carries the event id', () => {
    const id = '22222222-2222-4222-8222-222222222222';

    expect(triggerEventsQueryKeys.detail(id)).toEqual(['trigger-events', 'detail', id]);
  });

  test('facets key carries the workspace id', () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';

    expect(triggerEventsQueryKeys.facets(workspaceId)).toEqual([
      'trigger-events',
      'facets',
      workspaceId,
    ]);
  });
});

describe('listTriggerEvents', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('sends workspace_id and the default limit with no filters', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({trigger_events: [], next_cursor: null}));
    configureApiClient({fetchImpl});

    await listTriggerEvents({workspaceId});

    const url = new URL(requestFrom(fetchImpl).url);
    expect(url.pathname).toBe('/trigger-events');
    expect(url.searchParams.get('workspace_id')).toBe(workspaceId);
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(url.searchParams.has('outcome')).toBe(false);
  });

  test('serializes every filter, the cursor, and a custom limit', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({trigger_events: [], next_cursor: null}));
    configureApiClient({fetchImpl});

    await listTriggerEvents({
      workspaceId,
      limit: 25,
      cursor: 'cursor-abc',
      filters: {
        source: ['github', 'gitea'],
        event: ['push', 'pull_request'],
        outcome: ['routed', 'failed'],
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-22T00:00:00.000Z',
      },
    });

    const url = new URL(requestFrom(fetchImpl).url);
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('cursor')).toBe('cursor-abc');
    expect(url.searchParams.get('source')).toBe('gitea,github');
    expect(url.searchParams.get('event')).toBe('pull_request,push');
    expect(url.searchParams.get('from')).toBe('2026-06-01T00:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-06-22T00:00:00.000Z');
    expect(url.searchParams.get('outcome')).toBe('failed,routed');
  });

  test('omits list params when the filter arrays are empty', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({trigger_events: [], next_cursor: null}));
    configureApiClient({fetchImpl});

    await listTriggerEvents({workspaceId, filters: {source: [], event: [], outcome: []}});

    const url = new URL(requestFrom(fetchImpl).url);
    expect(url.searchParams.has('source')).toBe(false);
    expect(url.searchParams.has('event')).toBe(false);
    expect(url.searchParams.has('outcome')).toBe(false);
  });

  test('sorts and de-duplicates the serialized outcome param', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({trigger_events: [], next_cursor: null}));
    configureApiClient({fetchImpl});

    await listTriggerEvents({workspaceId, filters: {outcome: ['routed', 'failed', 'routed']}});

    const url = new URL(requestFrom(fetchImpl).url);
    expect(url.searchParams.get('outcome')).toBe('failed,routed');
  });

  test('returns the parsed list response', async () => {
    const page = {
      trigger_events: [triggerEventDto()],
      next_cursor: 'next-page',
    };
    configureApiClient({fetchImpl: vi.fn(async () => jsonResponse(page))});

    const result = await listTriggerEvents({workspaceId});

    expect(result).toEqual({
      events: [
        expect.objectContaining({
          id: EVENT_ID,
          eventRef: 'github:delivery-1:push',
          matchedCount: 1,
        }),
      ],
      nextCursor: 'next-page',
    });
  });
});

describe('getTriggerEvent', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('requests the event detail by id', async () => {
    const id = EVENT_ID;
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ...triggerEventDto({id, connection_name: null, payload: null}),
        decisions: [],
        replays: [],
      }),
    );
    configureApiClient({fetchImpl});

    await getTriggerEvent({id});

    const url = new URL(requestFrom(fetchImpl).url);
    expect(url.pathname).toBe(`/trigger-events/${id}`);
    expect(requestFrom(fetchImpl).method).toBe('GET');
  });
});

describe('getTriggerEventFacets', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('requests the workspace facets', async () => {
    const workspaceId = WORKSPACE_ID;
    const fetchImpl = vi.fn(async () => jsonResponse({sources: [], events: [], origins: []}));
    configureApiClient({fetchImpl});

    await getTriggerEventFacets({workspaceId});

    const url = new URL(requestFrom(fetchImpl).url);
    expect(url.pathname).toBe('/trigger-events/facets');
    expect(url.searchParams.get('workspace_id')).toBe(workspaceId);
    expect(requestFrom(fetchImpl).method).toBe('GET');
  });
});
