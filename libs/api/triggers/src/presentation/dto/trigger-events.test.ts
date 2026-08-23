import type {TriggerDecision} from '#core/entities/decision.js';
import type {
  TriggerReceivedEvent,
  TriggerReceivedEventSummary,
} from '#core/entities/received-event.js';
import {
  toTriggerDecisionDto,
  toTriggerEventDto,
  toTriggerEventListItemDto,
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
});
