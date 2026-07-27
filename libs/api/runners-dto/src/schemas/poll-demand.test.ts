import {pollDemandBodySchema, pollDemandResponseSchema} from './poll-demand.js';

const pollDemandTemplate = {
  template_key: 'linux',
  labels: ['linux'],
  available_slots: 1,
  starting: 0,
  running: 0,
};

describe('pollDemandBodySchema', () => {
  it('accepts up to 1000 advertised templates', () => {
    const result = pollDemandBodySchema.safeParse({
      max_reservations: 0,
      templates: Array.from({length: 1000}, () => pollDemandTemplate),
    });

    expect(result.success).toBe(true);
  });

  it('rejects more than 1000 advertised templates', () => {
    const result = pollDemandBodySchema.safeParse({
      max_reservations: 0,
      templates: Array.from({length: 1001}, () => pollDemandTemplate),
    });

    expect(result.success).toBe(false);
  });
});

describe('pollDemandResponseSchema', () => {
  it('requires datetime response fields to be ISO datetimes', () => {
    const result = pollDemandResponseSchema.safeParse({
      stats: [
        {
          labels: ['linux'],
          queued: 1,
          reserved: 1,
          oldest_queued_at: 'not-a-date',
        },
      ],
      reservations: [
        {
          reservation_id: crypto.randomUUID(),
          labels: ['linux'],
          count: 1,
          expires_at: 'not-a-date',
        },
      ],
      terminate_provider_runner_ids: [],
    });

    expect(result.success).toBe(false);
  });
});
