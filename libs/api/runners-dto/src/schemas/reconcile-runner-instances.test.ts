import {
  MAX_OBSERVED_PROVIDER_RUNNER_ID_LENGTH,
  MAX_RECONCILE_OBSERVED_RUNNERS,
  reconcileRunnerInstancesBodySchema,
  reconcileRunnerInstancesResponseSchema,
} from './reconcile-runner-instances.js';

describe('reconcileRunnerInstancesBodySchema', () => {
  it('accepts observed provisioned runner ids', () => {
    const result = reconcileRunnerInstancesBodySchema.safeParse({
      observed_provider_runner_ids: ['01JPROVISIONEDRUNNER000001'],
    });

    expect(result.success).toBe(true);
  });

  it('accepts an empty observed set', () => {
    const result = reconcileRunnerInstancesBodySchema.safeParse({
      observed_provider_runner_ids: [],
    });

    expect(result.success).toBe(true);
  });

  it('rejects observed sets above the reconcile limit', () => {
    const result = reconcileRunnerInstancesBodySchema.safeParse({
      observed_provider_runner_ids: Array.from(
        {length: MAX_RECONCILE_OBSERVED_RUNNERS + 1},
        (_, index) => `runner-${index}`,
      ),
    });

    expect(result.success).toBe(false);
  });

  it('rejects over-length provisioned runner ids', () => {
    const result = reconcileRunnerInstancesBodySchema.safeParse({
      observed_provider_runner_ids: ['a'.repeat(MAX_OBSERVED_PROVIDER_RUNNER_ID_LENGTH + 1)],
    });

    expect(result.success).toBe(false);
  });

  it('rejects duplicate provisioned runner ids', () => {
    const result = reconcileRunnerInstancesBodySchema.safeParse({
      observed_provider_runner_ids: ['provisioned-runner-1', 'provisioned-runner-1'],
    });

    expect(result.success).toBe(false);
  });

  it('rejects extra fields', () => {
    const result = reconcileRunnerInstancesBodySchema.safeParse({
      observed_provider_runner_ids: [],
      provisioner_hostname: 'worker-1',
    });

    expect(result.success).toBe(false);
  });
});

describe('reconcileRunnerInstancesResponseSchema', () => {
  it('keeps the optional field absent for responses from older servers', () => {
    const result = reconcileRunnerInstancesResponseSchema.parse({
      runners: [
        {
          provider_runner_id: 'provisioned-runner-1',
          state: 'running',
          reservation_id: null,
          runner_session_id: null,
          bound_job: null,
          desired_intent: 'keep',
        },
      ],
      terminated_absent_provider_runner_ids: [],
    });

    const runner = result.runners[0];
    if (!runner) throw new Error('Expected one parsed runner');
    expect(Object.hasOwn(runner, 'intended_reservation_id')).toBe(false);
  });

  it('keeps an explicit null field present for current responses', () => {
    const result = reconcileRunnerInstancesResponseSchema.parse({
      runners: [
        {
          provider_runner_id: 'provisioned-runner-1',
          state: 'running',
          intended_reservation_id: null,
          reservation_id: crypto.randomUUID(),
          runner_session_id: crypto.randomUUID(),
          bound_job: {
            job_id: crypto.randomUUID(),
            workflow_run_attempt_id: crypto.randomUUID(),
            last_heartbeat_at: new Date().toISOString(),
            cancellation_requested_at: null,
          },
          desired_intent: 'keep',
        },
      ],
      terminated_absent_provider_runner_ids: ['provisioned-runner-2'],
    });

    const runner = result.runners[0];
    if (!runner) throw new Error('Expected one parsed runner');
    expect(Object.hasOwn(runner, 'intended_reservation_id')).toBe(true);
    expect(runner.intended_reservation_id).toBeNull();
  });
});
