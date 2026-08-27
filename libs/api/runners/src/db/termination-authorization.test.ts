import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {authorizeRunnerTermination} from '#db/runner-instances.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {providerRunnerFactory} from '#test/index.js';

vi.mock('#config.js', () => ({
  config: {
    RUNNER_TERMINATION_REASON_REGISTRATION_DEADLINE_ENABLED: false,
    RUNNER_TERMINATION_REASON_ACTIVATION_TIMEOUT_ENABLED: false,
    RUNNER_TERMINATION_REASON_RUNNER_UNRESPONSIVE_ENABLED: false,
    RUNNER_TERMINATION_REASON_LEASE_EXPIRED_ENABLED: false,
    RUNNER_TERMINATION_REASON_SESSION_EXHAUSTED_ENABLED: false,
    RUNNER_TERMINATION_REASON_STOPPING_TIMEOUT_ENABLED: false,
    RUNNER_TERMINATION_REASON_PROVIDER_HEALTH_FAILED_ENABLED: false,
    RUNNER_TERMINATION_REASON_JOB_CANCELLED_ENABLED: false,
    RUNNER_TERMINATION_REASON_JOB_TIMEOUT_ENABLED: false,
    RUNNER_TERMINATION_REASON_TERMINAL_STATE_ENABLED: true,
  },
}));

describe('termination authorization concurrency', () => {
  it('persists one stable authorization and reason for concurrent attempts', async () => {
    const runner = await providerRunnerFactory.create({workspaceId: crypto.randomUUID()});
    const authorizedAt = new Date('2026-01-01T00:00:00.000Z');
    await db()
      .update(providerRunners)
      .set({terminationAuthorizedAt: authorizedAt, terminationReason: 'terminal-state'})
      .where(eq(providerRunners.id, runner.id));

    const results = await Promise.all(
      Array.from({length: 8}, (_, index) =>
        authorizeRunnerTermination({
          provisionerId: runner.provisionerId,
          providerRunnerId: runner.providerRunnerId,
          reason: index % 2 === 0 ? 'terminal-state' : 'job-timeout',
        }),
      ),
    );
    const [row] = await db()
      .select({
        terminationAuthorizedAt: providerRunners.terminationAuthorizedAt,
        terminationReason: providerRunners.terminationReason,
      })
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));

    expect(new Set(results.map((result) => result.terminationAuthorizedAt?.getTime()))).toEqual(
      new Set([authorizedAt.getTime()]),
    );
    expect(new Set(results.map((result) => result.terminationReason))).toEqual(
      new Set(['terminal-state']),
    );
    expect(row?.terminationAuthorizedAt).toEqual(results[0]?.terminationAuthorizedAt);
    expect(row?.terminationReason).toBe('terminal-state');
  });
});
