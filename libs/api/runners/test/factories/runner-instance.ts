import {Factory} from 'fishery';
import type {RunnerInstance} from '#core/entities/runner-instance.js';
import {db} from '#db/db.js';
import {providerRunners, toRunnerInstance} from '#db/schema/runner-instances.js';

export const providerRunnerFactory = Factory.define<RunnerInstance>(({onCreate}) => {
  onCreate(async (providerRunner) => {
    const [row] = await db()
      .insert(providerRunners)
      .values({
        workspaceId: providerRunner.workspaceId,
        provisionerId: providerRunner.provisionerId,
        providerRunnerId: providerRunner.providerRunnerId,
        intendedReservationId: providerRunner.intendedReservationId,
        reservationId: providerRunner.reservationId,
        launchKind: providerRunner.launchKind,
        templateKey: providerRunner.templateKey,
        labels: providerRunner.labels,
        state: providerRunner.state,
        reason: providerRunner.reason,
        runnerSessionId: providerRunner.runnerSessionId,
        providerKind: providerRunner.providerKind,
        reportedAt: providerRunner.reportedAt,
        startedAt: providerRunner.startedAt,
        stoppingAt: providerRunner.stoppingAt,
        stoppedAt: providerRunner.stoppedAt,
        failedAt: providerRunner.failedAt,
        terminatedAt: providerRunner.terminatedAt,
        terminationAuthorizedAt: providerRunner.terminationAuthorizedAt,
        terminationReason: providerRunner.terminationReason,
        reservationReleasedAt: providerRunner.reservationReleasedAt,
        createdAt: providerRunner.createdAt,
        updatedAt: providerRunner.updatedAt,
      })
      .returning();

    if (!row) throw new Error('Insert returned no rows');
    return toRunnerInstance(row);
  });

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provisionerId: crypto.randomUUID(),
    providerRunnerId: crypto.randomUUID(),
    intendedReservationId: null,
    reservationId: null,
    launchKind: 'manual',
    templateKey: 'linux',
    labels: ['linux'],
    state: 'running',
    reason: null,
    runnerSessionId: null,
    providerKind: 'docker',
    reportedAt: new Date(),
    startedAt: null,
    stoppingAt: null,
    stoppedAt: null,
    failedAt: null,
    terminatedAt: null,
    terminationAuthorizedAt: null,
    terminationReason: null,
    reservationReleasedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
