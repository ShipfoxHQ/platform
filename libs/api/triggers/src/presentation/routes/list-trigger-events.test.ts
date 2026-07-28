import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {encodeTimestampIdCursor} from '@shipfox/node-drizzle';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {receivedEventFactory} from '#test/index.js';
import {listTriggerEventsRoute} from './list-trigger-events.js';

const eventIds = (res: {json: () => {trigger_events: Array<{id: string}>}}) =>
  res.json().trigger_events.map((event) => event.id);

describe('GET /trigger-events', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let memberships: Array<{
    workspaceId: string;
    role: 'admin';
    workspaceStatus: 'active' | 'suspended' | 'deleted';
  }>;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({userId: crypto.randomUUID(), email: 'user@example.com', memberships}),
      );
      done();
    });
    app.get('/trigger-events', listTriggerEventsRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
  });

  test('returns a workspace events newest first, isolated and payload-free', async () => {
    const older = await receivedEventFactory.create({
      workspaceId,
      receivedAt: new Date('2026-05-07T00:00:00.000Z'),
    });
    const newer = await receivedEventFactory.create({
      workspaceId,
      receivedAt: new Date('2026-05-07T02:00:00.000Z'),
    });
    await receivedEventFactory.create({receivedAt: new Date('2026-05-07T03:00:00.000Z')});

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(eventIds(res)).toEqual([newer.id, older.id]);
    expect(res.json().next_cursor).toBeNull();
    expect(res.json().trigger_events[0]).not.toHaveProperty('payload');
  });

  test('filters by source', async () => {
    const gitea = await receivedEventFactory.create({workspaceId, source: 'gitea'});
    await receivedEventFactory.create({workspaceId, source: 'github'});

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&source=gitea`,
    });

    expect(eventIds(res)).toEqual([gitea.id]);
  });

  test('filters by repeated source keys (IN-list)', async () => {
    const gitea = await receivedEventFactory.create({workspaceId, source: 'gitea'});
    const github = await receivedEventFactory.create({workspaceId, source: 'github'});
    await receivedEventFactory.create({workspaceId, source: 'manual'});

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&source=gitea&source=github`,
    });

    expect(eventIds(res).sort()).toEqual([gitea.id, github.id].sort());
  });

  test('filters by comma-separated sources', async () => {
    const gitea = await receivedEventFactory.create({workspaceId, source: 'gitea'});
    const github = await receivedEventFactory.create({workspaceId, source: 'github'});
    await receivedEventFactory.create({workspaceId, source: 'manual'});

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&source=gitea,github`,
    });

    expect(eventIds(res).sort()).toEqual([gitea.id, github.id].sort());
  });

  test('filters by event', async () => {
    const pullRequest = await receivedEventFactory.create({workspaceId, event: 'pull_request'});
    await receivedEventFactory.create({workspaceId, event: 'push'});

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&event=pull_request`,
    });

    expect(eventIds(res)).toEqual([pullRequest.id]);
  });

  test('filters by repeated event keys (IN-list)', async () => {
    const pullRequest = await receivedEventFactory.create({workspaceId, event: 'pull_request'});
    const push = await receivedEventFactory.create({workspaceId, event: 'push'});
    await receivedEventFactory.create({workspaceId, event: 'release'});

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&event=pull_request&event=push`,
    });

    expect(eventIds(res).sort()).toEqual([pullRequest.id, push.id].sort());
  });

  test('filters by comma-separated events', async () => {
    const pullRequest = await receivedEventFactory.create({workspaceId, event: 'pull_request'});
    const push = await receivedEventFactory.create({workspaceId, event: 'push'});
    await receivedEventFactory.create({workspaceId, event: 'release'});

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&event=pull_request,push`,
    });

    expect(eventIds(res).sort()).toEqual([pullRequest.id, push.id].sort());
  });

  test('filters by repeated outcome keys (IN-list)', async () => {
    const {routed, discarded, failed} = await seedOutcomes(workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&outcome=routed&outcome=failed`,
    });

    expect(eventIds(res).sort()).toEqual([routed.id, failed.id].sort());
    expect(eventIds(res)).not.toContain(discarded.id);
  });

  test('filters by comma-separated outcomes', async () => {
    const {routed, discarded, failed} = await seedOutcomes(workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&outcome=routed,failed`,
    });

    expect(eventIds(res).sort()).toEqual([routed.id, failed.id].sort());
    expect(eventIds(res)).not.toContain(discarded.id);
  });

  test('filters by a single outcome', async () => {
    const {discarded} = await seedOutcomes(workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&outcome=discarded`,
    });

    expect(eventIds(res)).toEqual([discarded.id]);
  });

  test('filters and serializes the errored outcome', async () => {
    const errored = await receivedEventFactory.create({workspaceId, outcome: 'errored'});

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&outcome=errored`,
    });

    expect(res.statusCode).toBe(200);
    expect(eventIds(res)).toEqual([errored.id]);
  });

  test('treats a blank outcome as no filter', async () => {
    const {routed, discarded, failed} = await seedOutcomes(workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&outcome=`,
    });

    expect(res.statusCode).toBe(200);
    expect(eventIds(res).sort()).toEqual([routed.id, discarded.id, failed.id].sort());
  });

  test('drops a trailing comma in the outcome filter', async () => {
    const {routed, discarded, failed} = await seedOutcomes(workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&outcome=routed,`,
    });

    expect(eventIds(res)).toEqual([routed.id]);
    expect(eventIds(res)).not.toContain(discarded.id);
    expect(eventIds(res)).not.toContain(failed.id);
  });

  test('filters by received_at window', async () => {
    await receivedEventFactory.create({
      workspaceId,
      receivedAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    const inWindow = await receivedEventFactory.create({
      workspaceId,
      receivedAt: new Date('2026-05-10T00:00:00.000Z'),
    });
    await receivedEventFactory.create({
      workspaceId,
      receivedAt: new Date('2026-05-20T00:00:00.000Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&from=2026-05-05T00:00:00.000Z&to=2026-05-15T00:00:00.000Z`,
    });

    expect(eventIds(res)).toEqual([inWindow.id]);
  });

  test('includes events on the from and to window boundaries', async () => {
    const onFrom = await receivedEventFactory.create({
      workspaceId,
      receivedAt: new Date('2026-05-05T00:00:00.000Z'),
    });
    const onTo = await receivedEventFactory.create({
      workspaceId,
      receivedAt: new Date('2026-05-15T00:00:00.000Z'),
    });
    await receivedEventFactory.create({
      workspaceId,
      receivedAt: new Date('2026-05-04T23:59:59.999Z'),
    });
    await receivedEventFactory.create({
      workspaceId,
      receivedAt: new Date('2026-05-15T00:00:00.001Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&from=2026-05-05T00:00:00.000Z&to=2026-05-15T00:00:00.000Z`,
    });

    expect(eventIds(res).sort()).toEqual([onFrom.id, onTo.id].sort());
  });

  test('paginates with a received_at + id cursor', async () => {
    const first = await receivedEventFactory.create({
      workspaceId,
      receivedAt: new Date('2026-05-07T00:00:00.000Z'),
    });
    const second = await receivedEventFactory.create({
      workspaceId,
      receivedAt: new Date('2026-05-07T01:00:00.000Z'),
    });
    const third = await receivedEventFactory.create({
      workspaceId,
      receivedAt: new Date('2026-05-07T02:00:00.000Z'),
    });

    const page1 = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&limit=2`,
    });

    expect(eventIds(page1)).toEqual([third.id, second.id]);
    expect(page1.json().next_cursor).toBe(
      encodeTimestampIdCursor({createdAt: second.receivedAt, id: second.id}),
    );

    const page2 = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&limit=2&cursor=${page1.json().next_cursor}`,
    });

    expect(eventIds(page2)).toEqual([first.id]);
    expect(page2.json().next_cursor).toBeNull();
  });

  test('breaks received_at ties by id without duplicating or skipping rows', async () => {
    const tie = new Date('2026-05-07T00:00:00.000Z');
    const a = await receivedEventFactory.create({workspaceId, receivedAt: tie});
    const b = await receivedEventFactory.create({workspaceId, receivedAt: tie});
    const earlier = await receivedEventFactory.create({
      workspaceId,
      receivedAt: new Date('2026-05-06T00:00:00.000Z'),
    });

    const page1 = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&limit=2`,
    });
    const page2 = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&limit=2&cursor=${page1.json().next_cursor}`,
    });

    expect(eventIds(page1)).toEqual([a.id, b.id].sort().reverse());
    expect(eventIds(page2)).toEqual([earlier.id]);
    expect(new Set([...eventIds(page1), ...eventIds(page2)]).size).toBe(3);
  });

  test('returns an empty page for a workspace with no events', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({trigger_events: [], next_cursor: null});
  });

  test('returns workspace-suspended for a suspended membership claim', async () => {
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'suspended'}];

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('workspace-suspended');
  });

  test('denies a workspace the caller does not belong to', async () => {
    const otherWorkspaceId = crypto.randomUUID();

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${otherWorkspaceId}`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  test('rejects an invalid cursor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&cursor=not-a-cursor`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid-cursor');
  });

  test('requires a workspace_id', async () => {
    const res = await app.inject({method: 'GET', url: '/trigger-events'});

    expect(res.statusCode).toBe(400);
  });

  test('rejects a non-uuid workspace_id', async () => {
    const res = await app.inject({method: 'GET', url: '/trigger-events?workspace_id=nope'});

    expect(res.statusCode).toBe(400);
  });

  test('rejects an unknown outcome value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&outcome=bogus`,
    });

    expect(res.statusCode).toBe(400);
  });

  test('rejects a reversed date window', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events?workspace_id=${workspaceId}&from=2026-05-10T00:00:00.000Z&to=2026-05-01T00:00:00.000Z`,
    });

    expect(res.statusCode).toBe(400);
  });
});

async function seedOutcomes(workspaceId: string) {
  const routed = await receivedEventFactory.create({workspaceId, outcome: 'routed'});
  const discarded = await receivedEventFactory.create({workspaceId, outcome: 'discarded'});
  const failed = await receivedEventFactory.create({workspaceId, outcome: 'failed'});
  return {routed, discarded, failed};
}
