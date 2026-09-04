import type {
  TriggerEventDetailResponseDto,
  TriggerEventListItemDto,
} from '@shipfox/api-triggers-dto';
import {toTriggerEventDetail, toTriggerEventListPage} from './trigger-event-mapper.js';

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function triggerEventDto(
  overrides: Partial<TriggerEventListItemDto> = {},
): TriggerEventListItemDto {
  return {
    id: EVENT_ID,
    event_ref: 'github:delivery-1:push',
    origin: 'integration' as const,
    workspace_id: WORKSPACE_ID,
    provider: 'github',
    source: 'github',
    event: 'push',
    replay_of_event_id: null,
    delivery_id: 'delivery-1',
    connection_id: '33333333-3333-4333-8333-333333333333',
    outcome: 'routed' as const,
    matched_count: 1,
    received_at: '2026-06-01T00:00:00.000Z',
    processed_at: '2026-06-01T00:00:01.000Z',
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('trigger event mapper', () => {
  test('maps a transport list page before it enters the cache', () => {
    const page = toTriggerEventListPage({trigger_events: [triggerEventDto()], next_cursor: 'next'});

    expect(page).toEqual({
      events: [
        expect.objectContaining({
          eventRef: 'github:delivery-1:push',
          workspaceId: WORKSPACE_ID,
          matchedCount: 1,
          receivedAt: '2026-06-01T00:00:00.000Z',
        }),
      ],
      nextCursor: 'next',
    });
  });

  test('maps matched workflow results into their domain contract', () => {
    const detail = toTriggerEventDetail({
      ...triggerEventDto({matched_count: 2}),
      connection_name: 'Shipfox',
      payload: {ref: 'main'},
      decisions: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          received_event_id: EVENT_ID,
          subscription_kind: 'trigger',
          subscription_id: '55555555-5555-4555-8555-555555555555',
          subscription_name: 'Deploy',
          workflow_definition_id: '66666666-6666-4666-8666-666666666666',
          project_id: '77777777-7777-4777-8777-777777777777',
          workflow_run_id: null,
          job_id: null,
          matcher_kind: null,
          matcher_ordinal: null,
          decision: 'triggered',
          run_id: '88888888-8888-4888-8888-888888888888',
          run_name: 'deploy #1',
          reason: null,
          diagnostic: null,
          created_at: '2026-06-01T00:00:01.000Z',
        },
        {
          id: '99999999-9999-4999-8999-999999999999',
          received_event_id: EVENT_ID,
          subscription_kind: 'listener',
          subscription_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          subscription_name: 'Notify',
          workflow_definition_id: null,
          project_id: null,
          workflow_run_id: null,
          job_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          matcher_kind: 'on',
          matcher_ordinal: 0,
          decision: 'rejected',
          run_id: null,
          run_name: null,
          reason: 'payload-too-large',
          diagnostic: {
            version: 1,
            code: 'listener-event-payload-too-large',
            limit_bytes: 786_432,
            measured_bytes: 786_433,
            overshoot_bytes: 1,
          },
          created_at: '2026-06-01T00:00:01.000Z',
        },
      ],
      replays: [],
    } satisfies TriggerEventDetailResponseDto);

    expect(detail.decisions).toEqual([
      {
        id: '44444444-4444-4444-8444-444444444444',
        subscriptionKind: 'trigger',
        subscriptionName: 'Deploy',
        workflowDefinitionId: '66666666-6666-4666-8666-666666666666',
        decision: 'triggered',
        projectId: '77777777-7777-4777-8777-777777777777',
        workflowRunId: null,
        jobId: null,
        matcherKind: null,
        matcherOrdinal: null,
        runId: '88888888-8888-4888-8888-888888888888',
        runName: 'deploy #1',
        reason: null,
        diagnostic: null,
      },
      {
        id: '99999999-9999-4999-8999-999999999999',
        subscriptionKind: 'listener',
        subscriptionName: 'Notify',
        workflowDefinitionId: null,
        decision: 'rejected',
        projectId: null,
        workflowRunId: null,
        jobId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        matcherKind: 'on',
        matcherOrdinal: 0,
        runId: null,
        runName: null,
        reason: 'payload-too-large',
        diagnostic: {
          version: 1,
          code: 'listener-event-payload-too-large',
          limitBytes: 786_432,
          measuredBytes: 786_433,
          overshootBytes: 1,
        },
      },
    ]);
  });
});
