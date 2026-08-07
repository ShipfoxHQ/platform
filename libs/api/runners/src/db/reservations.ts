import {canonicalizeLabels} from '@shipfox/runner-labels';
import {
  and,
  arrayContains,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import {recordProviderRunnerActivationOutcome} from '#metrics/instance.js';
import type {Tx} from './db.js';
import {db} from './db.js';
import {pendingJobExecutions} from './schema/pending-job-executions.js';
import {provisionerCapabilitySnapshots} from './schema/provisioner-capability-snapshots.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';
import {reservations} from './schema/reservations.js';
import {runnerActivationTokens} from './schema/runner-activation-tokens.js';
import {runnerControlSessions} from './schema/runner-control-sessions.js';
import {providerRunners} from './schema/runner-instances.js';

export interface ReservationTemplate {
  templateKey: string;
  labels: string[];
  availableSlots: number;
  starting: number;
  running: number;
}

export interface DemandStat {
  workspaceId?: string;
  labels: string[];
  queued: number;
  reserved: number;
  oldestQueuedAt: Date;
}

export interface ReservationGrant {
  reservationId: string;
  workspaceId?: string;
  labels: string[];
  count: number;
  expiresAt: Date;
}

export interface PollDemandAndReserveParams {
  workspaceId: string;
  provisionerId: string;
  maxReservations: number;
  ttlSeconds: number;
  /** Lifetime of the short reservation that gives rebound runners time to activate. */
  activationGraceSeconds?: number;
  templates: ReservationTemplate[];
  capabilityWindowSeconds?: number;
}

export interface InstallationPollDemandAndReserveParams {
  provisionerId: string;
  maxReservations: number;
  ttlSeconds: number;
  /** Lifetime of the short reservation that gives rebound runners time to activate. */
  activationGraceSeconds?: number;
  templates: ReservationTemplate[];
  capabilityWindowSeconds: number;
  eligibleWorkspaceIds: ReadonlySet<string>;
  signal?: AbortSignal;
  onReservations?: (reservations: ReservationGrant[]) => void;
}

type DemandScope = 'installation' | 'workspace';

type PollDemandAndReserveLockedParams = PollDemandAndReserveParams & {
  scope: DemandScope;
};

interface NormalizedTemplate {
  templateKey: string;
  labels: string[];
  remainingSlots: number;
}

interface DemandRow {
  requiredLabels: string[];
  queued: number;
  oldestQueuedAt: Date;
}

interface NewReservationUnits {
  labels: string[];
  count: number;
}

interface PollDemandAndReserveResult {
  stats: DemandStat[];
  /** Only launch reservations are exposed to the provisioner. */
  reservations: ReservationGrant[];
  /** Internal allocation accounting for bound and launch rows together. */
  newlyReservedUnits: NewReservationUnits[];
}

export async function pollDemandAndReserve(
  params: PollDemandAndReserveParams,
): Promise<{stats: DemandStat[]; reservations: ReservationGrant[]}> {
  const result = await db().transaction(async (tx) => {
    return await pollDemandAndReserveTx(tx, params);
  });
  return {stats: result.stats, reservations: result.reservations};
}

export async function pollDemandAndReserveTx(
  tx: Tx,
  params: PollDemandAndReserveParams,
): Promise<PollDemandAndReserveResult> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.workspaceId}))`);
  return await pollDemandAndReserveLockedTx(tx, {...params, scope: 'workspace'});
}

export async function pollInstallationDemandAndReserve(
  params: InstallationPollDemandAndReserveParams,
): Promise<{
  stats: DemandStat[];
  reservations: ReservationGrant[];
  newlyReservedCount?: number;
}> {
  const candidateWorkspaceIds = await listInstallationDemandWorkspaceIds(
    params.eligibleWorkspaceIds,
  );
  const results: PollDemandAndReserveResult[] = [];
  let remainingMaxReservations = params.maxReservations;
  const remainingTemplates = params.templates.map((template) => ({
    ...template,
    labels: [...canonicalizeLabels(template.labels)],
    remainingSlots: template.availableSlots,
  }));
  for (const workspaceId of candidateWorkspaceIds) {
    if (params.signal?.aborted || remainingMaxReservations === 0) break;
    const result = await db().transaction(async (tx) => {
      const lockResult = await tx.execute<{locked: boolean}>(
        sql`select pg_try_advisory_xact_lock(hashtext(${workspaceId})) as locked`,
      );
      const locked = lockResult.rows[0];
      if (!locked?.locked) return {stats: [], reservations: [], newlyReservedUnits: []};
      return await pollDemandAndReserveLockedTx(tx, {
        workspaceId,
        provisionerId: params.provisionerId,
        maxReservations: remainingMaxReservations,
        ttlSeconds: params.ttlSeconds,
        ...(params.activationGraceSeconds !== undefined
          ? {activationGraceSeconds: params.activationGraceSeconds}
          : {}),
        templates: remainingTemplates.map((template) => ({
          ...template,
          availableSlots: template.remainingSlots,
        })),
        capabilityWindowSeconds: params.capabilityWindowSeconds,
        scope: 'installation',
      });
    });
    results.push(result);
    consumeInstallationTemplateSlots(remainingTemplates, result.reservations);
    params.onReservations?.(result.reservations);
    remainingMaxReservations -= result.newlyReservedUnits.reduce(
      (total, reservation) => total + reservation.count,
      0,
    );
  }
  const newlyReservedCount = results.reduce(
    (total, result) =>
      total +
      result.newlyReservedUnits.reduce((subtotal, reservation) => subtotal + reservation.count, 0),
    0,
  );
  return {
    stats: results.flatMap((result) => result.stats),
    reservations: results.flatMap((result) => result.reservations),
    ...(newlyReservedCount > 0 ? {newlyReservedCount} : {}),
  };
}

function consumeInstallationTemplateSlots(
  templates: NormalizedTemplate[],
  launchGrants: ReservationGrant[],
): void {
  // Adopted runners are already included in the running count behind availableSlots.
  // Only units that still need a launch consume advertised template capacity.
  for (const reservation of launchGrants) {
    const satisfyingTemplates = templates
      .filter((template) => isSubset(reservation.labels, template.labels))
      .sort(
        (a, b) => a.labels.length - b.labels.length || a.templateKey.localeCompare(b.templateKey),
      );
    drawSlots(satisfyingTemplates, reservation.count);
  }
}

async function pollDemandAndReserveLockedTx(
  tx: Tx,
  params: PollDemandAndReserveLockedParams,
): Promise<PollDemandAndReserveResult> {
  let demandRows = (
    await tx
      .select({
        requiredLabels: pendingJobExecutions.requiredLabels,
        queued: sql<number>`count(*)::int`,
        oldestQueuedAt: sql<Date | string>`min(${pendingJobExecutions.createdAt})`,
      })
      .from(pendingJobExecutions)
      .where(eq(pendingJobExecutions.workspaceId, params.workspaceId))
      .groupBy(pendingJobExecutions.requiredLabels)
  ).map((row) => ({
    ...row,
    oldestQueuedAt: new Date(row.oldestQueuedAt),
  }));
  if (params.capabilityWindowSeconds !== undefined) {
    const capabilityLabels = await listActiveWorkspaceCapabilityLabelsTx(tx, {
      workspaceId: params.workspaceId,
      windowSeconds: params.capabilityWindowSeconds,
    });
    demandRows = demandRows.filter(
      (demand) => !capabilityLabels.some((labels) => isSubset(demand.requiredLabels, labels)),
    );
  }

  const activeReservationRows = await tx
    .select({
      requiredLabels: reservations.requiredLabels,
      reserved: sql<number>`coalesce(sum(${reservations.count}), 0)::int`,
    })
    .from(reservations)
    .where(
      and(eq(reservations.workspaceId, params.workspaceId), gt(reservations.expiresAt, sql`now()`)),
    )
    .groupBy(reservations.requiredLabels);

  const reservedByLabels = new Map(
    activeReservationRows.map((row) => [labelKey(row.requiredLabels), row.reserved]),
  );
  const activeProvisionerReservationRows = await tx
    .select({
      requiredLabels: reservations.requiredLabels,
      reserved: sql<number>`coalesce(sum(${reservations.count}), 0)::int`,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.workspaceId, params.workspaceId),
        eq(reservations.provisionerId, params.provisionerId),
        gt(reservations.expiresAt, sql`now()`),
      ),
    )
    .groupBy(reservations.requiredLabels);

  const templates = params.templates.map((template) => ({
    templateKey: template.templateKey,
    labels: [...canonicalizeLabels(template.labels)],
    remainingSlots: template.availableSlots,
  }));
  deductProvisionerReservations(templates, activeProvisionerReservationRows);
  const stats: DemandStat[] = [];
  const grants: ReservationGrant[] = [];
  const newlyReservedUnits: NewReservationUnits[] = [];
  let remainingMaxReservations = params.maxReservations;
  const workspaceIdField =
    params.capabilityWindowSeconds === undefined ? {} : {workspaceId: params.workspaceId};

  for (const demand of sortDemandRows(demandRows)) {
    const satisfyingTemplates = templates
      .filter((template) => isSubset(demand.requiredLabels, template.labels))
      .sort(
        (a, b) => a.labels.length - b.labels.length || a.templateKey.localeCompare(b.templateKey),
      );

    if (satisfyingTemplates.length === 0) continue;

    const reserved = reservedByLabels.get(labelKey(demand.requiredLabels)) ?? 0;
    const unreserved = Math.max(0, demand.queued - reserved);
    const capacity = satisfyingTemplates.reduce(
      (total, template) => total + template.remainingSlots,
      0,
    );
    const grant = Math.min(unreserved, capacity, remainingMaxReservations);
    let reservedAfterGrant = reserved;

    if (grant > 0 && params.maxReservations > 0) {
      const [boundReservation] = await tx
        .insert(reservations)
        .values({
          workspaceId: params.workspaceId,
          provisionerId: params.provisionerId,
          requiredLabels: demand.requiredLabels,
          count: grant,
          kind: 'bound',
          expiresAt: sql`now() + (${params.activationGraceSeconds ?? params.ttlSeconds} || ' seconds')::interval`,
        })
        .returning({id: reservations.id});

      if (!boundReservation) throw new Error('Insert returned no rows');

      remainingMaxReservations -= grant;
      const boundCount = await bindIdleRunnerInstancesTx(tx, {
        provisionerId: params.provisionerId,
        reservationId: boundReservation.id,
        requiredLabels: demand.requiredLabels,
        count: grant,
        workspaceId: params.workspaceId,
        scope: params.scope,
      });

      if (boundCount === 0) {
        await tx.delete(reservations).where(eq(reservations.id, boundReservation.id));
      } else if (boundCount < grant) {
        await tx
          .update(reservations)
          .set({count: boundCount})
          .where(eq(reservations.id, boundReservation.id));
      }

      const launchCount = grant - boundCount;
      drawSlots(satisfyingTemplates, launchCount);
      let launchReservation: {id: string; expiresAt: Date} | undefined;
      if (launchCount > 0) {
        const [inserted] = await tx
          .insert(reservations)
          .values({
            workspaceId: params.workspaceId,
            provisionerId: params.provisionerId,
            requiredLabels: demand.requiredLabels,
            count: launchCount,
            kind: 'launch',
            expiresAt: sql`now() + (${params.ttlSeconds} || ' seconds')::interval`,
          })
          .returning({id: reservations.id, expiresAt: reservations.expiresAt});

        if (!inserted) throw new Error('Insert returned no rows');
        launchReservation = inserted;
      }

      newlyReservedUnits.push({labels: demand.requiredLabels, count: grant});
      reservedAfterGrant += grant;
      if (launchReservation) {
        grants.push({
          reservationId: launchReservation.id,
          ...workspaceIdField,
          labels: demand.requiredLabels,
          count: launchCount,
          expiresAt: launchReservation.expiresAt,
        });
      }
    }

    stats.push({
      ...workspaceIdField,
      labels: demand.requiredLabels,
      queued: demand.queued,
      reserved: reservedAfterGrant,
      oldestQueuedAt: demand.oldestQueuedAt,
    });
  }

  return {stats, reservations: grants, newlyReservedUnits};
}

async function bindIdleRunnerInstancesTx(
  tx: Tx,
  params: {
    provisionerId: string;
    reservationId: string;
    workspaceId: string;
    requiredLabels: string[];
    count: number;
    scope: DemandScope;
  },
): Promise<number> {
  // An expired or missing reservation is stale. A live reservation protects a
  // runner that is still booting or waiting for its activation grace period.
  const canBindRunner = () =>
    and(
      or(
        and(isNull(providerRunners.workspaceId), isNull(providerRunners.reservationId)),
        and(
          isNotNull(providerRunners.reservationId),
          params.scope === 'installation'
            ? undefined
            : or(
                isNull(providerRunners.workspaceId),
                eq(providerRunners.workspaceId, params.workspaceId),
              ),
          notExists(
            tx
              .select({id: reservations.id})
              .from(reservations)
              .where(
                and(
                  eq(reservations.id, providerRunners.reservationId),
                  gt(reservations.expiresAt, sql`now()`),
                ),
              ),
          ),
        ),
      ),
      or(
        isNull(providerRunners.intendedReservationId),
        notExists(
          tx
            .select({id: reservations.id})
            .from(reservations)
            .where(
              and(
                eq(reservations.id, providerRunners.intendedReservationId),
                gt(reservations.expiresAt, sql`now()`),
              ),
            ),
        ),
      ),
      isNull(providerRunners.reservationReleasedAt),
      isNull(providerRunners.runnerSessionId),
    );

  const idleRunners = await tx
    .select({id: providerRunners.id, launchKind: providerRunners.launchKind})
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.provisionerId, params.provisionerId),
        canBindRunner(),
        isNotNull(providerRunners.providerRunnerId),
        eq(providerRunners.state, 'running'),
        arrayContains(providerRunners.labels, params.requiredLabels),
        exists(
          tx
            .select({id: runnerControlSessions.id})
            .from(runnerControlSessions)
            .where(
              and(
                eq(runnerControlSessions.runnerInstanceId, providerRunners.id),
                eq(runnerControlSessions.provisionerId, params.provisionerId),
                isNull(runnerControlSessions.closedAt),
                gt(runnerControlSessions.expiresAt, sql`now()`),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(providerRunners.createdAt), asc(providerRunners.id))
    .limit(params.count)
    .for('update');

  if (idleRunners.length === 0) return 0;

  await tx
    .update(runnerActivationTokens)
    .set({revokedAt: sql`now()`})
    .where(
      and(
        inArray(
          runnerActivationTokens.runnerInstanceId,
          idleRunners.map((runner) => runner.id),
        ),
        isNull(runnerActivationTokens.consumedAt),
        isNull(runnerActivationTokens.revokedAt),
      ),
    );

  const boundRunners = await tx
    .update(providerRunners)
    .set({
      workspaceId: params.workspaceId,
      reservationId: params.reservationId,
      intendedReservationId: null,
      assignedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        inArray(
          providerRunners.id,
          idleRunners.map((runner) => runner.id),
        ),
        canBindRunner(),
      ),
    )
    .returning({id: providerRunners.id, launchKind: providerRunners.launchKind});

  const reboundCount = boundRunners.filter((runner) => runner.launchKind === 'demand').length;
  if (reboundCount > 0)
    recordProviderRunnerActivationOutcome({outcome: 'rebound', count: reboundCount});

  return boundRunners.length;
}

async function listInstallationDemandWorkspaceIds(eligibleWorkspaceIds: ReadonlySet<string>) {
  if (eligibleWorkspaceIds.size === 0) return [];
  const rows = await db()
    .select({
      workspaceId: pendingJobExecutions.workspaceId,
      oldestQueuedAt: sql<Date>`min(${pendingJobExecutions.createdAt})`,
    })
    .from(pendingJobExecutions)
    .where(inArray(pendingJobExecutions.workspaceId, [...eligibleWorkspaceIds]))
    .groupBy(pendingJobExecutions.workspaceId)
    .orderBy(
      asc(sql`min(${pendingJobExecutions.createdAt})`),
      asc(pendingJobExecutions.workspaceId),
    );
  return rows.map((row) => row.workspaceId);
}

export async function listQueuedDemandWorkspaceIds(): Promise<string[]> {
  const rows = await db()
    .select({workspaceId: pendingJobExecutions.workspaceId})
    .from(pendingJobExecutions)
    .groupBy(pendingJobExecutions.workspaceId);
  return rows.map((row) => row.workspaceId);
}

async function listActiveWorkspaceCapabilityLabelsTx(
  tx: Tx,
  params: {workspaceId: string; windowSeconds: number},
): Promise<string[][]> {
  const rows = await tx
    .select({labels: provisionerCapabilitySnapshots.labels})
    .from(provisionerCapabilitySnapshots)
    .innerJoin(
      provisionerTokens,
      eq(provisionerTokens.id, provisionerCapabilitySnapshots.provisionerId),
    )
    .where(
      and(
        eq(provisionerCapabilitySnapshots.workspaceId, params.workspaceId),
        eq(provisionerTokens.workspaceId, params.workspaceId),
        eq(provisionerTokens.scope, 'workspace'),
        sql`${provisionerCapabilitySnapshots.advertisedAt} > now() - (${params.windowSeconds} || ' seconds')::interval`,
        sql`${provisionerTokens.revokedAt} is null`,
        sql`(${provisionerTokens.expiresAt} is null or ${provisionerTokens.expiresAt} > now())`,
      ),
    );
  return rows.map((row) => row.labels);
}

export async function deleteExpiredReservations(params?: {limit?: number}): Promise<number> {
  return await db().transaction(async (tx) => {
    const expiredRows = await tx
      .select({id: reservations.id})
      .from(reservations)
      .where(lt(reservations.expiresAt, sql`now()`))
      .orderBy(asc(reservations.expiresAt))
      .limit(params?.limit ?? 1000);
    return await deleteReservationsWithCleanupTx(
      tx,
      expiredRows.map((reservation) => reservation.id),
      {expiredOnly: true},
    );
  });
}

export async function deleteReservationsByIds(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  return await db().transaction(async (tx) => {
    return await deleteReservationsWithCleanupTx(tx, ids);
  });
}

async function deleteReservationsWithCleanupTx(
  tx: Tx,
  ids: string[],
  params: {expiredOnly?: boolean} = {},
): Promise<number> {
  if (ids.length === 0) return 0;

  const affectedRunners = await tx
    .select({
      id: providerRunners.id,
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
      runnerSessionId: providerRunners.runnerSessionId,
      reservationReleasedAt: providerRunners.reservationReleasedAt,
    })
    .from(providerRunners)
    .where(
      or(
        and(
          inArray(providerRunners.reservationId, ids),
          isNull(providerRunners.runnerSessionId),
          isNull(providerRunners.reservationReleasedAt),
        ),
        inArray(providerRunners.intendedReservationId, ids),
      ),
    )
    .orderBy(asc(providerRunners.id))
    .for('update');
  const reservationRows = await tx
    .select({id: reservations.id})
    .from(reservations)
    .where(
      and(
        inArray(reservations.id, ids),
        params.expiredOnly ? lt(reservations.expiresAt, sql`now()`) : undefined,
      ),
    )
    .for('update');
  const reservationIds = reservationRows.map((reservation) => reservation.id);

  if (reservationIds.length === 0) return 0;

  const assignedRunnerIds = affectedRunners
    .filter(
      (runner) =>
        runner.reservationId &&
        reservationIds.includes(runner.reservationId) &&
        !runner.runnerSessionId &&
        !runner.reservationReleasedAt,
    )
    .map((runner) => runner.id);
  const intendedRunnerIds = affectedRunners
    .filter(
      (runner) =>
        runner.intendedReservationId && reservationIds.includes(runner.intendedReservationId),
    )
    .map((runner) => runner.id);
  if (assignedRunnerIds.length > 0) {
    await tx
      .update(runnerActivationTokens)
      .set({revokedAt: sql`now()`})
      .where(
        and(
          inArray(runnerActivationTokens.runnerInstanceId, assignedRunnerIds),
          isNull(runnerActivationTokens.consumedAt),
          isNull(runnerActivationTokens.revokedAt),
        ),
      );
    await tx
      .update(providerRunners)
      .set({
        workspaceId: null,
        reservationId: null,
        assignedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inArray(providerRunners.id, assignedRunnerIds),
          isNull(providerRunners.runnerSessionId),
          isNull(providerRunners.reservationReleasedAt),
        ),
      );
  }
  if (intendedRunnerIds.length > 0) {
    await tx
      .update(providerRunners)
      .set({intendedReservationId: null, updatedAt: sql`now()`})
      .where(
        and(
          inArray(providerRunners.id, intendedRunnerIds),
          inArray(providerRunners.intendedReservationId, reservationIds),
        ),
      );
  }

  const deleted = await tx
    .delete(reservations)
    .where(inArray(reservations.id, reservationIds))
    .returning({id: reservations.id});

  return deleted.length;
}

export async function releaseReservationUnits(
  tx: Tx,
  params: {
    workspaceId: string;
    provisionerId: string;
    releases: Array<{reservationId: string; count: number}>;
  },
): Promise<number> {
  let released = 0;

  for (const release of params.releases) {
    if (release.count <= 0) continue;

    const decremented = await tx
      .update(reservations)
      .set({count: sql`${reservations.count} - ${release.count}`})
      .where(
        and(
          eq(reservations.id, release.reservationId),
          eq(reservations.workspaceId, params.workspaceId),
          eq(reservations.provisionerId, params.provisionerId),
          gt(reservations.count, release.count),
          gt(reservations.expiresAt, sql`now()`),
        ),
      )
      .returning({id: reservations.id});

    if (decremented.length > 0) {
      released += release.count;
      continue;
    }

    const deleted = await tx
      .delete(reservations)
      .where(
        and(
          eq(reservations.id, release.reservationId),
          eq(reservations.workspaceId, params.workspaceId),
          eq(reservations.provisionerId, params.provisionerId),
          sql`${reservations.count} <= ${release.count}`,
          gt(reservations.expiresAt, sql`now()`),
        ),
      )
      .returning({count: reservations.count});

    released += deleted.reduce((total, row) => total + row.count, 0);
  }

  return released;
}

function deductProvisionerReservations(
  templates: NormalizedTemplate[],
  activeReservations: {requiredLabels: string[]; reserved: number}[],
): void {
  for (const reservation of sortReservationRows(activeReservations)) {
    const satisfyingTemplates = templates
      .filter((template) => isSubset(reservation.requiredLabels, template.labels))
      .sort(
        (a, b) => a.labels.length - b.labels.length || a.templateKey.localeCompare(b.templateKey),
      );
    drawSlots(satisfyingTemplates, reservation.reserved);
  }
}

function sortDemandRows(rows: DemandRow[]): DemandRow[] {
  return [...rows].sort((a, b) => {
    const specificity = b.requiredLabels.length - a.requiredLabels.length;
    if (specificity !== 0) return specificity;
    return a.oldestQueuedAt.getTime() - b.oldestQueuedAt.getTime();
  });
}

function sortReservationRows<T extends {requiredLabels: string[]}>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const specificity = b.requiredLabels.length - a.requiredLabels.length;
    if (specificity !== 0) return specificity;
    return labelKey(a.requiredLabels).localeCompare(labelKey(b.requiredLabels));
  });
}

function isSubset(requiredLabels: string[], availableLabels: string[]): boolean {
  return requiredLabels.every((label) => availableLabels.includes(label));
}

function drawSlots(templates: NormalizedTemplate[], count: number): void {
  let remaining = count;
  for (const template of templates) {
    if (remaining === 0) return;
    const used = Math.min(template.remainingSlots, remaining);
    template.remainingSlots -= used;
    remaining -= used;
  }
}

function labelKey(labels: string[]): string {
  return JSON.stringify(labels);
}
