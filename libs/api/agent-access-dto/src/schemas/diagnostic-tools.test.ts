import {getTriggerEventResultJsonSchema, getTriggerEventResultSchema} from './diagnostic-tools.js';

const eventId = '00000000-0000-4000-8000-000000000001';

describe('diagnostic agent-access schemas', () => {
  test('accepts filtered trigger decisions in runtime and JSON schemas', () => {
    const result = {
      id: eventId,
      origin: 'integration',
      provider: 'github',
      source: 'github',
      event: 'push',
      outcome: 'discarded',
      matched_count: 0,
      connection_id: null,
      connection_name: null,
      replay_of_event_id: null,
      received_at: '2026-09-04T12:00:00.000Z',
      processed_at: '2026-09-04T12:00:01.000Z',
      payload_preview: '{}',
      decisions: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          subscription_kind: 'trigger',
          outcome: 'filtered',
          reason: null,
          workflow_definition_id: '00000000-0000-4000-8000-000000000003',
          project_id: '00000000-0000-4000-8000-000000000004',
          workflow_run_id: null,
          job_id: null,
        },
      ],
      decisions_total_count: 1,
      replays: [],
      replays_total_count: 0,
    };

    expect(getTriggerEventResultSchema.safeParse(result).success).toBe(true);
    expect(
      getTriggerEventResultJsonSchema.properties.decisions.items.properties.outcome.enum,
    ).toContain('filtered');
  });
});
