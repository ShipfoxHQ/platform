import {eq} from 'drizzle-orm';
import {config} from '#config.js';
import {db} from '#db/db.js';
import {authorizeRunnerTermination} from '#db/runner-instances.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {providerRunnerFactory} from '#test/index.js';

describe('termination authorization concurrency', () => {
  it.skipIf(!config.RUNNER_TERMINATION_REASON_JOB_TIMEOUT_ENABLED)(
    'persists one stable authorization and reason for concurrent attempts',
    async () => {
      const runner = await providerRunnerFactory.create({workspaceId: crypto.randomUUID()});
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

      expect(new Set(results.map((result) => result.terminationAuthorizedAt?.getTime())).size).toBe(
        1,
      );
      expect(new Set(results.map((result) => result.terminationReason)).size).toBe(1);
      expect(row?.terminationAuthorizedAt).toEqual(results[0]?.terminationAuthorizedAt);
      expect(row?.terminationReason).toEqual(results[0]?.terminationReason);
      expect(row?.terminationAuthorizedAt).toBeInstanceOf(Date);
    },
  );

  it('keeps an unknown runner from being authorized', async () => {
    const result = await authorizeRunnerTermination({
      provisionerId: crypto.randomUUID(),
      providerRunnerId: 'missing-runner',
      reason: 'terminal-state',
    });

    expect(result).toEqual({
      desiredIntent: 'keep',
      terminationAuthorizedAt: null,
      terminationReason: null,
    });
  });

  it.skipIf(!config.RUNNER_TERMINATION_REASON_TERMINAL_STATE_ENABLED)(
    'persists a fresh authorization when its reason gate is enabled',
    async () => {
      const runner = await providerRunnerFactory.create({workspaceId: crypto.randomUUID()});
      const before = new Date();

      const result = await authorizeRunnerTermination({
        provisionerId: runner.provisionerId,
        providerRunnerId: runner.providerRunnerId,
        reason: 'terminal-state',
      });
      const [row] = await db()
        .select({
          terminationAuthorizedAt: providerRunners.terminationAuthorizedAt,
          terminationReason: providerRunners.terminationReason,
          updatedAt: providerRunners.updatedAt,
        })
        .from(providerRunners)
        .where(eq(providerRunners.id, runner.id));

      expect(result.desiredIntent).toBe('terminate');
      expect(result.terminationReason).toBe('terminal-state');
      expect(result.terminationAuthorizedAt).toBeInstanceOf(Date);
      expect(result.terminationAuthorizedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(row?.terminationAuthorizedAt).toEqual(result.terminationAuthorizedAt);
      expect(row?.terminationReason).toBe('terminal-state');
      expect(row?.updatedAt).toEqual(result.terminationAuthorizedAt);
    },
  );
});
