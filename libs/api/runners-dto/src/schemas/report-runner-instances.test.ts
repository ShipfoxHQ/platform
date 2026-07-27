import {
  MAX_PROVIDER_RUNNER_REPORT_EVENTS,
  providerRunnerReportEventSchema,
  reportRunnerInstancesBodySchema,
} from './report-runner-instances.js';

describe('providerRunnerReportEventSchema', () => {
  it('accepts minimal provider-agnostic lifecycle events', () => {
    const result = providerRunnerReportEventSchema.safeParse({
      provider_runner_id: 'container-1',
      labels: ['linux'],
      state: 'starting',
      reported_at: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
  });

  it('accepts cleanup-confirmed terminated lifecycle events', () => {
    const result = providerRunnerReportEventSchema.safeParse({
      provider_runner_id: 'container-1',
      labels: ['linux'],
      state: 'terminated',
      reported_at: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
  });

  it('rejects provider-sensitive extra fields', () => {
    const result = providerRunnerReportEventSchema.safeParse({
      provider_runner_id: 'container-1',
      labels: ['linux'],
      state: 'running',
      reported_at: new Date().toISOString(),
      ip_address: '192.0.2.1',
    });

    expect(result.success).toBe(false);
  });
});

describe('reportRunnerInstancesBodySchema', () => {
  it('accepts a batch at the limit', () => {
    const event = {
      provider_runner_id: 'container-1',
      labels: ['linux'],
      state: 'running',
      reported_at: new Date().toISOString(),
    };

    const result = reportRunnerInstancesBodySchema.safeParse({
      events: Array.from({length: MAX_PROVIDER_RUNNER_REPORT_EVENTS}, (_, index) => ({
        ...event,
        provider_runner_id: `container-${index}`,
      })),
    });

    expect(result.success).toBe(true);
  });

  it('enforces the batch size limit', () => {
    const event = {
      provider_runner_id: 'container-1',
      labels: ['linux'],
      state: 'running',
      reported_at: new Date().toISOString(),
    };

    const result = reportRunnerInstancesBodySchema.safeParse({
      events: Array.from({length: MAX_PROVIDER_RUNNER_REPORT_EVENTS + 1}, (_, index) => ({
        ...event,
        provider_runner_id: `container-${index}`,
      })),
    });

    expect(result.success).toBe(false);
  });
});
