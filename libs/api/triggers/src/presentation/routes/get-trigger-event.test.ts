import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {db} from '#db/db.js';
import {type TriggerDecisionInsertDb, triggersDecisions} from '#db/schema/decisions.js';
import {decisionFactory, receivedEventFactory} from '#test/index.js';
import {getTriggerEventRoute} from './get-trigger-event.js';

describe('GET /trigger-events/:id', () => {
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
    app.get('/trigger-events/:id', getTriggerEventRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
  });

  test('returns the event with its decisions and full payload', async () => {
    const event = await receivedEventFactory.create({
      workspaceId,
      outcome: 'routed',
      matchedCount: 2,
      payload: {ref: 'refs/heads/main', headCommitSha: 'abc123'},
    });
    const triggered = await decisionFactory.create({
      receivedEventId: event.id,
      decision: 'triggered',
      subscriptionName: 'Deploy production',
      runName: 'deploy',
    });
    const errored = await decisionFactory.create({
      receivedEventId: event.id,
      decision: 'dispatch-error',
      subscriptionName: 'Lint checks',
      runId: null,
      runName: null,
      reason: 'boom',
    });

    const res = await app.inject({method: 'GET', url: `/trigger-events/${event.id}`});

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(event.id);
    expect(body.matched_count).toBe(2);
    expect(body.payload).toEqual({ref: 'refs/heads/main', headCommitSha: 'abc123'});
    expect(body.decisions.map((decision: {id: string}) => decision.id)).toEqual([
      triggered.id,
      errored.id,
    ]);
    expect(
      body.decisions.map((decision: {subscription_name: string}) => decision.subscription_name),
    ).toEqual(['Deploy production', 'Lint checks']);
    expect(body.decisions[1].decision).toBe('dispatch-error');
    expect(body.decisions[1].run_id).toBeNull();
    expect(body.decisions[1].reason).toBe('boom');
  });

  test('normalizes legacy errored decisions before serializing the response', async () => {
    const event = await receivedEventFactory.create({
      workspaceId,
      outcome: 'errored',
      matchedCount: 1,
    });
    const legacyDecision = {
      receivedEventId: event.id,
      subscriptionKind: 'trigger',
      subscriptionId: crypto.randomUUID(),
      subscriptionName: 'Deploy production',
      workflowDefinitionId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      decision: 'errored',
      runId: null,
      runName: null,
      reason: 'legacy failure',
    } as unknown as TriggerDecisionInsertDb;
    await db().insert(triggersDecisions).values(legacyDecision);

    const res = await app.inject({method: 'GET', url: `/trigger-events/${event.id}`});

    expect(res.statusCode).toBe(200);
    expect(res.json().decisions).toMatchObject([
      {decision: 'dispatch-error', reason: 'legacy failure'},
    ]);
  });

  test('returns mixed trigger and listener decisions', async () => {
    const event = await receivedEventFactory.create({
      workspaceId,
      outcome: 'routed',
      matchedCount: 2,
    });
    await decisionFactory.create({
      receivedEventId: event.id,
      subscriptionKind: 'trigger',
      decision: 'triggered',
      subscriptionName: 'Deploy production',
    });
    const listener = await decisionFactory.create({
      receivedEventId: event.id,
      subscriptionKind: 'listener',
      subscriptionName: 'listener until[0] github/pull_request.closed',
      workflowDefinitionId: null,
      projectId: null,
      workflowRunId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      matcherKind: 'until',
      matcherOrdinal: 0,
      decision: 'triggered',
      runId: null,
      runName: null,
    });

    const res = await app.inject({method: 'GET', url: `/trigger-events/${event.id}`});

    expect(res.statusCode).toBe(200);
    expect(res.json().decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subscription_kind: 'listener',
          subscription_id: listener.subscriptionId,
          workflow_definition_id: null,
          project_id: null,
          workflow_run_id: listener.workflowRunId,
          job_id: listener.jobId,
          matcher_kind: 'until',
          matcher_ordinal: 0,
        }),
      ]),
    );
  });

  test('serializes a dev decision with a null subscription id', async () => {
    const event = await receivedEventFactory.create({
      workspaceId,
      origin: 'dev',
      source: 'dev',
      event: 'replay',
      outcome: 'routed',
      matchedCount: 1,
    });
    await decisionFactory.create({
      receivedEventId: event.id,
      subscriptionKind: 'dev',
      subscriptionId: null,
      subscriptionName: 'on_issue',
      workflowDefinitionId: crypto.randomUUID(),
      projectId: null,
      decision: 'filter-error',
      runId: null,
      runName: null,
      reason: 'filter is false',
    });

    const res = await app.inject({method: 'GET', url: `/trigger-events/${event.id}`});

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      origin: 'dev',
      replay_of_event_id: null,
      replays: [],
      decisions: [
        {
          subscription_kind: 'dev',
          subscription_id: null,
          decision: 'filter-error',
          reason: 'filter is false',
        },
      ],
    });
  });

  test('returns replay_of_event_id on a dev event that replayed a source event', async () => {
    const source = await receivedEventFactory.create({workspaceId});
    const replay = await receivedEventFactory.create({
      workspaceId,
      origin: 'dev',
      source: 'github',
      event: 'push',
      replayOfEventId: source.id,
      payload: {ref: 'refs/heads/main'},
    });
    await decisionFactory.create({
      receivedEventId: replay.id,
      subscriptionKind: 'dev',
      subscriptionId: null,
      subscriptionName: 'on_push',
      workflowDefinitionId: crypto.randomUUID(),
      projectId: null,
      decision: 'triggered',
      runId: crypto.randomUUID(),
      runName: 'dev-replay',
    });

    const res = await app.inject({method: 'GET', url: `/trigger-events/${replay.id}`});

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      origin: 'dev',
      replay_of_event_id: source.id,
      source: 'github',
      event: 'push',
    });
  });

  test('returns the replays list of dev events that replayed the event', async () => {
    const source = await receivedEventFactory.create({workspaceId});
    const runId = crypto.randomUUID();
    const replay = await receivedEventFactory.create({
      workspaceId,
      origin: 'dev',
      source: 'github',
      event: 'push',
      replayOfEventId: source.id,
      outcome: 'routed',
      matchedCount: 1,
      receivedAt: new Date('2026-05-07T00:00:00.000Z'),
    });
    await decisionFactory.create({
      receivedEventId: replay.id,
      subscriptionKind: 'dev',
      subscriptionId: null,
      subscriptionName: 'on_push',
      workflowDefinitionId: crypto.randomUUID(),
      projectId: null,
      decision: 'triggered',
      runId,
      runName: 'dev-replay',
    });

    const res = await app.inject({method: 'GET', url: `/trigger-events/${source.id}`});

    expect(res.statusCode).toBe(200);
    expect(res.json().replays).toEqual([
      {
        id: replay.id,
        received_at: '2026-05-07T00:00:00.000Z',
        outcome: 'routed',
        run_id: runId,
      },
    ]);
  });

  test('replays list carries null run ids and the outcome for refused replays', async () => {
    const source = await receivedEventFactory.create({workspaceId});
    const refused = await receivedEventFactory.create({
      workspaceId,
      origin: 'dev',
      source: 'github',
      event: 'push',
      replayOfEventId: source.id,
      outcome: 'discarded',
      matchedCount: 0,
      receivedAt: new Date('2026-05-07T01:00:00.000Z'),
    });
    await decisionFactory.create({
      receivedEventId: refused.id,
      subscriptionKind: 'dev',
      subscriptionId: null,
      subscriptionName: 'on_push',
      workflowDefinitionId: crypto.randomUUID(),
      projectId: null,
      decision: 'filter-error',
      runId: null,
      runName: null,
      reason: 'filter is false',
    });

    const res = await app.inject({method: 'GET', url: `/trigger-events/${source.id}`});

    expect(res.statusCode).toBe(200);
    expect(res.json().replays).toEqual([
      {
        id: refused.id,
        received_at: '2026-05-07T01:00:00.000Z',
        outcome: 'discarded',
        run_id: null,
      },
    ]);
  });

  test('does not surface replays from another workspace', async () => {
    const source = await receivedEventFactory.create({workspaceId});
    await receivedEventFactory.create({
      workspaceId: crypto.randomUUID(),
      origin: 'dev',
      source: 'github',
      event: 'push',
      replayOfEventId: source.id,
    });

    const res = await app.inject({method: 'GET', url: `/trigger-events/${source.id}`});

    expect(res.statusCode).toBe(200);
    expect(res.json().replays).toEqual([]);
  });

  test('does not surface non-dev events with a replay link', async () => {
    const source = await receivedEventFactory.create({workspaceId});
    await receivedEventFactory.create({
      workspaceId,
      origin: 'integration',
      replayOfEventId: source.id,
    });

    const res = await app.inject({method: 'GET', url: `/trigger-events/${source.id}`});

    expect(res.statusCode).toBe(200);
    expect(res.json().replays).toEqual([]);
  });

  test('returns an empty decisions list for a discarded event', async () => {
    const event = await receivedEventFactory.create({
      workspaceId,
      outcome: 'discarded',
      matchedCount: 0,
    });

    const res = await app.inject({method: 'GET', url: `/trigger-events/${event.id}`});

    expect(res.statusCode).toBe(200);
    expect(res.json().decisions).toEqual([]);
  });

  test('returns workspace-suspended for a suspended membership claim', async () => {
    const event = await receivedEventFactory.create({workspaceId});
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'suspended'}];

    const res = await app.inject({method: 'GET', url: `/trigger-events/${event.id}`});

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('workspace-suspended');
  });

  test('returns 404 for an unknown event id', async () => {
    const res = await app.inject({method: 'GET', url: `/trigger-events/${crypto.randomUUID()}`});

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('returns 404 for an event in another workspace', async () => {
    const event = await receivedEventFactory.create({workspaceId: crypto.randomUUID()});

    const res = await app.inject({method: 'GET', url: `/trigger-events/${event.id}`});

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('rejects a non-uuid id', async () => {
    const res = await app.inject({method: 'GET', url: '/trigger-events/not-a-uuid'});

    expect(res.statusCode).toBe(400);
  });
});
