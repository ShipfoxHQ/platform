import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {TriggerEventFacetItemDto} from '@shipfox/api-triggers-dto';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {receivedEventFactory} from '#test/index.js';
import {listTriggerEventFacetsRoute} from './list-trigger-event-facets.js';

const facets = (res: {
  json: () => {
    sources: TriggerEventFacetItemDto[];
    events: TriggerEventFacetItemDto[];
    origins: TriggerEventFacetItemDto[];
  };
}) => res.json();

describe('GET /trigger-events/facets', () => {
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
    app.get('/trigger-events/facets', listTriggerEventFacetsRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
  });

  test('returns distinct sources and events with counts, ordered by count desc', async () => {
    await receivedEventFactory.create({workspaceId, source: 'github', event: 'push'});
    await receivedEventFactory.create({workspaceId, source: 'github', event: 'pull_request'});
    await receivedEventFactory.create({workspaceId, source: 'gitea', event: 'push'});

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events/facets?workspace_id=${workspaceId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(facets(res).sources).toEqual([
      {value: 'github', count: 2},
      {value: 'gitea', count: 1},
    ]);
    expect(facets(res).events).toEqual([
      {value: 'push', count: 2},
      {value: 'pull_request', count: 1},
    ]);
  });

  test('returns distinct origins with counts, ordered by count desc', async () => {
    await receivedEventFactory.create({workspaceId, source: 'github', event: 'push'});
    await receivedEventFactory.create({
      workspaceId,
      origin: 'dev',
      source: 'github',
      event: 'push',
    });
    await receivedEventFactory.create({
      workspaceId,
      origin: 'dev',
      source: 'github',
      event: 'push',
    });
    await receivedEventFactory.create({
      workspaceId,
      origin: 'manual',
      source: 'manual',
      event: 'fire',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events/facets?workspace_id=${workspaceId}`,
    });

    expect(facets(res).origins).toEqual([
      {value: 'dev', count: 2},
      {value: 'integration', count: 1},
      {value: 'manual', count: 1},
    ]);
  });

  test('caps each facet at the top 50 values by count', async () => {
    await Promise.all(
      Array.from({length: 51}, (_, index) =>
        receivedEventFactory.create({workspaceId, source: `source-${index}`}),
      ),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events/facets?workspace_id=${workspaceId}`,
    });

    expect(facets(res).sources).toHaveLength(50);
  });

  test('scopes facets to the workspace', async () => {
    await receivedEventFactory.create({workspaceId, source: 'github'});
    await receivedEventFactory.create({source: 'gitlab'});

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events/facets?workspace_id=${workspaceId}`,
    });

    expect(facets(res).sources.map((facet) => facet.value)).toEqual(['github']);
  });

  test('returns empty facets for a workspace with no events', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events/facets?workspace_id=${workspaceId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({sources: [], events: [], origins: []});
  });

  test('returns workspace-suspended for a suspended membership claim', async () => {
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'suspended'}];

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events/facets?workspace_id=${workspaceId}`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('workspace-suspended');
  });

  test('denies a workspace the caller does not belong to', async () => {
    const otherWorkspaceId = crypto.randomUUID();

    const res = await app.inject({
      method: 'GET',
      url: `/trigger-events/facets?workspace_id=${otherWorkspaceId}`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  test('rejects a non-uuid workspace_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/trigger-events/facets?workspace_id=nope',
    });

    expect(res.statusCode).toBe(400);
  });
});
