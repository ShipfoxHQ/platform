import {
  triggerDecisionDtoSchema,
  triggerDecisionSubscriptionKindSchema,
  triggerEventDetailResponseSchema,
  triggerEventFacetsResponseSchema,
  triggerEventListQuerySchema,
  triggerEventOriginSchema,
  triggerEventReplayDtoSchema,
} from '@shipfox/api-triggers-dto';
import type {TriggerDecision} from '#core/entities/decision.js';
import type {
  TriggerReceivedEvent,
  TriggerReceivedEventSummary,
} from '#core/entities/received-event.js';
import {
  toTriggerDecisionDto,
  toTriggerEventDto,
  toTriggerEventListItemDto,
  toTriggerEventReplayDto,
} from './trigger-events.js';

const baseSummary: TriggerReceivedEventSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  eventRef: 'event-ref',
  origin: 'manual',
  workspaceId: '22222222-2222-2222-2222-222222222222',
  provider: null,
  source: 'manual',
  event: 'fire',
  replayOfEventId: null,
  deliveryId: null,
  connectionId: null,
  connectionName: null,
  outcome: 'discarded',
  matchedCount: 0,
  receivedAt: new Date('2026-05-07T00:00:00.000Z'),
  processedAt: null,
  createdAt: new Date('2026-05-07T00:00:01.000Z'),
};

describe('trigger-events mappers', () => {
  test('toTriggerEventListItemDto maps null fields, formats ISO dates, and omits payload', () => {
    const dto = toTriggerEventListItemDto(baseSummary);

    expect(dto).toEqual({
      id: baseSummary.id,
      event_ref: 'event-ref',
      origin: 'manual',
      workspace_id: baseSummary.workspaceId,
      provider: null,
      source: 'manual',
      event: 'fire',
      replay_of_event_id: null,
      delivery_id: null,
      connection_id: null,
      outcome: 'discarded',
      matched_count: 0,
      received_at: '2026-05-07T00:00:00.000Z',
      processed_at: null,
      created_at: '2026-05-07T00:00:01.000Z',
    });
    expect(dto).not.toHaveProperty('payload');
  });

  test('toTriggerEventListItemDto maps replay_of_event_id', () => {
    const replayOfEventId = '99999999-9999-4999-8999-999999999999';
    const dto = toTriggerEventListItemDto({...baseSummary, replayOfEventId});

    expect(dto.replay_of_event_id).toBe(replayOfEventId);
  });

  test('toTriggerEventDto carries the payload (including null)', () => {
    const withPayload: TriggerReceivedEvent = {...baseSummary, payload: {ref: 'main'}};
    const withoutPayload: TriggerReceivedEvent = {...baseSummary, payload: null};

    expect(toTriggerEventDto(withPayload).payload).toEqual({ref: 'main'});
    expect(toTriggerEventDto(withoutPayload).payload).toBeNull();
  });

  test('toTriggerEventDto carries the connection name (including null)', () => {
    const named: TriggerReceivedEvent = {
      ...baseSummary,
      connectionName: 'Acme Production',
      payload: null,
    };
    const unnamed: TriggerReceivedEvent = {...baseSummary, connectionName: null, payload: null};

    expect(toTriggerEventDto(named).connection_name).toBe('Acme Production');
    expect(toTriggerEventDto(unnamed).connection_name).toBeNull();
  });

  test('toTriggerDecisionDto maps null run/reason fields', () => {
    const decision: TriggerDecision = {
      id: '33333333-3333-3333-3333-333333333333',
      receivedEventId: '11111111-1111-1111-1111-111111111111',
      subscriptionKind: 'trigger',
      subscriptionId: '44444444-4444-4444-4444-444444444444',
      subscriptionName: 'Deploy production',
      workflowDefinitionId: '55555555-5555-5555-5555-555555555555',
      projectId: '66666666-6666-6666-6666-666666666666',
      workflowRunId: null,
      jobId: null,
      matcherKind: null,
      matcherOrdinal: null,
      decision: 'dispatch-error',
      runId: null,
      runName: null,
      reason: 'boom',
      createdAt: new Date('2026-05-07T00:00:02.000Z'),
    };

    expect(toTriggerDecisionDto(decision)).toEqual({
      id: decision.id,
      received_event_id: decision.receivedEventId,
      subscription_kind: 'trigger',
      subscription_id: decision.subscriptionId,
      subscription_name: 'Deploy production',
      workflow_definition_id: decision.workflowDefinitionId,
      project_id: decision.projectId,
      workflow_run_id: null,
      job_id: null,
      matcher_kind: null,
      matcher_ordinal: null,
      decision: 'dispatch-error',
      run_id: null,
      run_name: null,
      reason: 'boom',
      created_at: '2026-05-07T00:00:02.000Z',
    });
  });

  test('toTriggerDecisionDto maps listener identity fields', () => {
    const decision: TriggerDecision = {
      id: '33333333-3333-3333-3333-333333333333',
      receivedEventId: '11111111-1111-1111-1111-111111111111',
      subscriptionKind: 'listener',
      subscriptionId: '44444444-4444-4444-4444-444444444444',
      subscriptionName: 'listener until[0] github/pull_request.closed',
      workflowDefinitionId: null,
      projectId: null,
      workflowRunId: '55555555-5555-5555-5555-555555555555',
      jobId: '66666666-6666-6666-6666-666666666666',
      matcherKind: 'until',
      matcherOrdinal: 0,
      decision: 'triggered',
      runId: null,
      runName: null,
      reason: null,
      createdAt: new Date('2026-05-07T00:00:02.000Z'),
    };

    expect(toTriggerDecisionDto(decision)).toMatchObject({
      subscription_kind: 'listener',
      workflow_definition_id: null,
      project_id: null,
      workflow_run_id: decision.workflowRunId,
      job_id: decision.jobId,
      matcher_kind: 'until',
      matcher_ordinal: 0,
      decision: 'triggered',
    });
  });

  test('toTriggerEventReplayDto maps null run ids and ISO dates', () => {
    expect(
      toTriggerEventReplayDto({
        id: '99999999-9999-4999-8999-999999999999',
        receivedAt: new Date('2026-05-07T00:00:02.000Z'),
        outcome: 'routed',
        runId: '77777777-7777-4777-8777-777777777777',
      }),
    ).toEqual({
      id: '99999999-9999-4999-8999-999999999999',
      received_at: '2026-05-07T00:00:02.000Z',
      outcome: 'routed',
      run_id: '77777777-7777-4777-8777-777777777777',
    });
    expect(
      toTriggerEventReplayDto({
        id: '99999999-9999-4999-8999-999999999999',
        receivedAt: new Date('2026-05-07T00:00:02.000Z'),
        outcome: 'discarded',
        runId: null,
      }).run_id,
    ).toBeNull();
  });
});

describe('trigger event DTO contract', () => {
  const baseDecision = {
    id: '33333333-3333-4333-8333-333333333333',
    received_event_id: '11111111-1111-4111-8111-111111111111',
    subscription_kind: 'trigger',
    subscription_id: '44444444-4444-4444-4444-444444444444',
    subscription_name: 'Deploy production',
    workflow_definition_id: '55555555-5555-5555-8555-555555555555',
    project_id: '66666666-6666-6666-8666-666666666666',
    workflow_run_id: null,
    job_id: null,
    matcher_kind: null,
    matcher_ordinal: null,
    decision: 'triggered',
    run_id: '77777777-7777-4777-8777-777777777777',
    run_name: 'Dev run',
    reason: null,
    created_at: '2026-05-07T00:00:02.000Z',
  };

  test('accepts dev origins and decisions with a null subscription id', () => {
    expect(triggerEventOriginSchema.safeParse('dev').success).toBe(true);
    expect(triggerDecisionSubscriptionKindSchema.safeParse('dev').success).toBe(true);
    expect(
      triggerDecisionDtoSchema.safeParse({
        ...baseDecision,
        subscription_kind: 'dev',
        subscription_id: null,
      }).success,
    ).toBe(true);
  });

  test('requires subscription ids for trigger and listener decisions', () => {
    for (const subscription_kind of ['trigger', 'listener'] as const) {
      expect(
        triggerDecisionDtoSchema.safeParse({
          ...baseDecision,
          subscription_kind,
          subscription_id: null,
        }).success,
      ).toBe(false);
    }
  });

  test('requires dev decisions to omit a subscription id', () => {
    expect(
      triggerDecisionDtoSchema.safeParse({
        ...baseDecision,
        subscription_kind: 'dev',
        subscription_id: baseDecision.subscription_id,
      }).success,
    ).toBe(false);
  });

  test('rejects unknown origin and decision kinds', () => {
    expect(triggerEventOriginSchema.safeParse('unknown').success).toBe(false);
    expect(triggerDecisionSubscriptionKindSchema.safeParse('unknown').success).toBe(false);
  });

  const baseQuery = {
    workspace_id: '22222222-2222-4222-8222-222222222222',
  };

  test('list query accepts origin as a single, repeated, or comma-separated filter', () => {
    expect(triggerEventListQuerySchema.parse({...baseQuery, origin: 'dev'}).origin).toEqual([
      'dev',
    ]);
    expect(
      triggerEventListQuerySchema.parse({...baseQuery, origin: ['dev', 'manual']}).origin,
    ).toEqual(['dev', 'manual']);
    expect(triggerEventListQuerySchema.parse({...baseQuery, origin: 'dev,manual'}).origin).toEqual([
      'dev',
      'manual',
    ]);
  });

  test('list query rejects an unknown origin filter value', () => {
    expect(triggerEventListQuerySchema.safeParse({...baseQuery, origin: 'bogus'}).success).toBe(
      false,
    );
  });

  test('list query accepts replayable=true only', () => {
    expect(triggerEventListQuerySchema.parse({...baseQuery, replayable: 'true'})).toMatchObject({
      replayable: true,
    });
    expect(triggerEventListQuerySchema.parse(baseQuery).replayable).toBeUndefined();
    expect(triggerEventListQuerySchema.safeParse({...baseQuery, replayable: 'false'}).success).toBe(
      false,
    );
    expect(triggerEventListQuerySchema.safeParse({...baseQuery, replayable: 'yes'}).success).toBe(
      false,
    );
  });

  test('detail response accepts replay_of_event_id and a replays list', () => {
    const detail = {
      id: '11111111-1111-4111-8111-111111111111',
      event_ref: 'event-ref',
      origin: 'dev',
      workspace_id: '22222222-2222-4222-8222-222222222222',
      provider: null,
      source: 'github',
      event: 'push',
      replay_of_event_id: '99999999-9999-4999-8999-999999999999',
      delivery_id: null,
      connection_id: null,
      connection_name: null,
      outcome: 'routed',
      matched_count: 1,
      payload: {ref: 'refs/heads/main'},
      received_at: '2026-05-07T00:00:00.000Z',
      processed_at: null,
      created_at: '2026-05-07T00:00:01.000Z',
      decisions: [],
      replays: [
        {
          id: '99999999-9999-4999-8999-999999999999',
          received_at: '2026-05-07T00:00:02.000Z',
          outcome: 'routed',
          run_id: '77777777-7777-4777-8777-777777777777',
        },
      ],
    };

    const parsed = triggerEventDetailResponseSchema.parse(detail);
    expect(parsed.replay_of_event_id).toBe(detail.replay_of_event_id);
    expect(parsed.replays).toEqual(detail.replays);
    expect(triggerEventReplayDtoSchema.safeParse(detail.replays[0]).success).toBe(true);
    expect(
      triggerEventReplayDtoSchema.safeParse({...detail.replays[0], run_id: null}).success,
    ).toBe(true);
  });

  test('facets response accepts origins', () => {
    const parsed = triggerEventFacetsResponseSchema.parse({
      sources: [{value: 'github', count: 2}],
      events: [{value: 'push', count: 2}],
      origins: [
        {value: 'integration', count: 2},
        {value: 'dev', count: 1},
      ],
    });
    expect(parsed.origins).toEqual([
      {value: 'integration', count: 2},
      {value: 'dev', count: 1},
    ]);
  });
});
