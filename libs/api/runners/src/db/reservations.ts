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
  lte,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import {recordProviderRunnerActivationOutcome} from '#metrics/instance.js';
import type {Tx} from './db.js';
import {db} from './db.js';
import {lockRunnerReservationAdvisoryKeysTx} from './reservation-locks.js';
import {terminalStates} from './runner-states.js';
import {pendingJobExecutions} from './schema/pending-job-executions.js';
import {provisionerCapabilitySnapshots} from './schema/provisioner-capability-snapshots.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';
import {reservations} from './schema/reservations.js';
import {runnerActivationTokens} from './schema/runner-activation-tokens.js';
import {runnerControlSessions} from './schema/runner-control-sessions.js';
import {type providerRunnerLaunchKindEnum, providerRunners} from './schema/runner-instances.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

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

interface IdleRunnerCandidate {
  id: string;
  launchKind: (typeof providerRunnerLaunchKindEnum.enumValues)[number];
}

interface BindableRunnerParams {
  provisionerId: string;
  workspaceId: string;
  requiredLabels: string[];
  scope: DemandScope;
}

interface IdleRunnerSelectionParams extends BindableRunnerParams {
  count: number;
}

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

interface ActiveProvisionerReservationRow {
  provisionerId: string;
  requiredLabels: string[];
  /** Units still represented by a live runner that has not claimed a job. */
  reserved: number;
  /** Live units that have no unclaimed runner behind them. */
  leaked: number;
}

interface PollDemandAndReserveResult {
  stats: DemandStat[];
  /** Only launch reservations are exposed to the provisioner. */
  reservations: ReservationGrant[];
  /** Internal allocation accounting for bound and launch rows together. */
  newlyReservedUnits: NewReservationUnits[];
}

interface DemandReservationState {
  readonly templates: NormalizedTemplate[];
  readonly reservedByLabels: ReadonlyMap<string, number>;
  readonly stats: DemandStat[];
  readonly grants: ReservationGrant[];
  readonly newlyReservedUnits: NewReservationUnits[];
  readonly workspaceIdField: {workspaceId?: string};
  remainingMaxReservations: number;
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

  const activeProvisionerReservationRows = await listActiveProvisionerReservationRowsTx(tx, {
    workspaceId: params.workspaceId,
  });
  const reservedByLabels = new Map<string, number>();
  for (const row of activeProvisionerReservationRows) {
    const key = labelKey(row.requiredLabels);
    reservedByLabels.set(key, (reservedByLabels.get(key) ?? 0) + row.reserved);
  }

  const templates = params.templates.map((template) => ({
    templateKey: template.templateKey,
    labels: [...canonicalizeLabels(template.labels)],
    remainingSlots: template.availableSlots,
  }));
  deductProvisionerReservations(
    templates,
    activeProvisionerReservationRows.filter(
      (reservation) => reservation.provisionerId === params.provisionerId,
    ),
  );
  const state: DemandReservationState = {
    templates,
    reservedByLabels,
    stats: [],
    grants: [],
    newlyReservedUnits: [],
    workspaceIdField:
      params.capabilityWindowSeconds === undefined ? {} : {workspaceId: params.workspaceId},
    remainingMaxReservations: params.maxReservations,
  };

  for (const demand of sortDemandRows(demandRows)) {
    await reserveDemandRowTx(tx, params, demand, state);
  }

  return {
    stats: state.stats,
    reservations: state.grants,
    newlyReservedUnits: state.newlyReservedUnits,
  };
}

async function reserveDemandRowTx(
  tx: Tx,
  params: PollDemandAndReserveLockedParams,
  demand: DemandRow,
  state: DemandReservationState,
): Promise<void> {
  const satisfyingTemplates = state.templates
    .filter((template) => isSubset(demand.requiredLabels, template.labels))
    .sort(
      (a, b) => a.labels.length - b.labels.length || a.templateKey.localeCompare(b.templateKey),
    );
  if (satisfyingTemplates.length === 0) return;
  const reserved = state.reservedByLabels.get(labelKey(demand.requiredLabels)) ?? 0;
  const capacity = satisfyingTemplates.reduce(
    (total, template) => total + template.remainingSlots,
    0,
  );
  const grant = Math.min(
    Math.max(0, demand.queued - reserved),
    capacity,
    state.remainingMaxReservations,
  );
  if (grant > 0 && params.maxReservations > 0) {
    await grantDemandReservationTx(tx, params, demand, satisfyingTemplates, grant, state);
  }
  state.stats.push({
    ...state.workspaceIdField,
    labels: demand.requiredLabels,
    queued: demand.queued,
    reserved: reserved + grant,
    oldestQueuedAt: demand.oldestQueuedAt,
  });
}

async function grantDemandReservationTx(
  tx: Tx,
  params: PollDemandAndReserveLockedParams,
  demand: DemandRow,
  satisfyingTemplates: NormalizedTemplate[],
  grant: number,
  state: DemandReservationState,
): Promise<void> {
  const idleRunners = await listIdleRunnerInstancesTx(tx, {
    provisionerId: params.provisionerId,
    requiredLabels: demand.requiredLabels,
    count: grant,
    workspaceId: params.workspaceId,
    scope: params.scope,
  });
  state.remainingMaxReservations -= grant;
  if (idleRunners.length > 0) {
    await bindDemandReservationTx(tx, params, demand, idleRunners);
  }
  const launchCount = grant - idleRunners.length;
  drawSlots(satisfyingTemplates, launchCount);
  const launchReservation = await insertLaunchReservationTx(tx, params, demand, launchCount);
  state.newlyReservedUnits.push({labels: demand.requiredLabels, count: grant});
  if (launchReservation) {
    state.grants.push({
      reservationId: launchReservation.id,
      ...state.workspaceIdField,
      labels: demand.requiredLabels,
      count: launchCount,
      expiresAt: launchReservation.expiresAt,
    });
  }
}

async function bindDemandReservationTx(
  tx: Tx,
  params: PollDemandAndReserveLockedParams,
  demand: DemandRow,
  idleRunners: IdleRunnerCandidate[],
): Promise<void> {
  const [reservation] = await tx
    .insert(reservations)
    .values({
      workspaceId: params.workspaceId,
      provisionerId: params.provisionerId,
      requiredLabels: demand.requiredLabels,
      count: idleRunners.length,
      kind: 'bound',
      expiresAt: sql`now() + (${params.activationGraceSeconds ?? params.ttlSeconds} || ' seconds')::interval`,
    })
    .returning({id: reservations.id});
  if (!reservation) throw new Error('Insert returned no rows');
  await bindIdleRunnerInstancesTx(tx, {
    provisionerId: params.provisionerId,
    reservationId: reservation.id,
    workspaceId: params.workspaceId,
    requiredLabels: demand.requiredLabels,
    scope: params.scope,
    idleRunners,
  });
}

async function insertLaunchReservationTx(
  tx: Tx,
  params: PollDemandAndReserveLockedParams,
  demand: DemandRow,
  launchCount: number,
): Promise<{id: string; expiresAt: Date} | undefined> {
  if (launchCount === 0) return undefined;
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
  return inserted;
}

async function listActiveProvisionerReservationRowsTx(
  tx: Tx,
  params: {workspaceId?: string; provisionerId?: string; lockForMutation?: boolean},
): Promise<ActiveProvisionerReservationRow[]> {
  const lockForMutation = params.lockForMutation ?? true;
  const candidateRows = await tx
    .select({id: reservations.id, provisionerId: reservations.provisionerId})
    .from(reservations)
    .where(
      and(
        params.workspaceId ? eq(reservations.workspaceId, params.workspaceId) : undefined,
        params.provisionerId ? eq(reservations.provisionerId, params.provisionerId) : undefined,
        gt(reservations.expiresAt, sql`now()`),
      ),
    );
  const candidateIds = candidateRows.map((row) => row.id);
  if (candidateIds.length === 0) return [];

  if (lockForMutation) await lockActiveReservationCandidates(tx, candidateRows);

  const activeRowsQuery = tx
    .select({
      id: reservations.id,
      provisionerId: reservations.provisionerId,
      requiredLabels: reservations.requiredLabels,
      count: reservations.count,
    })
    .from(reservations)
    .where(
      and(
        params.workspaceId ? eq(reservations.workspaceId, params.workspaceId) : undefined,
        params.provisionerId ? eq(reservations.provisionerId, params.provisionerId) : undefined,
        gt(reservations.expiresAt, sql`now()`),
      ),
    )
    .orderBy(asc(reservations.provisionerId), asc(reservations.id));
  // Metrics use a point-in-time read and must not contend with scheduling mutations.
  const activeRows = await (lockForMutation ? activeRowsQuery.for('update') : activeRowsQuery);
  if (activeRows.length === 0) return [];

  const activeIds = activeRows.map((row) => row.id);
  const activeIdSet = new Set(activeIds);
  const provisionerIds = [...new Set(activeRows.map((row) => row.provisionerId))];
  const linkedRunnerRows = await tx
    .select({
      id: providerRunners.id,
      firstClaimedAt: providerRunners.firstClaimedAt,
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
      reservationReleasedAt: providerRunners.reservationReleasedAt,
      state: providerRunners.state,
    })
    .from(providerRunners)
    .where(
      and(
        inArray(providerRunners.provisionerId, provisionerIds),
        or(
          inArray(providerRunners.reservationId, activeIds),
          inArray(providerRunners.intendedReservationId, activeIds),
        ),
      ),
    );
  const unclaimedByReservation = indexUnclaimedRunnersByReservation(linkedRunnerRows, activeIdSet);

  return activeRows.map((reservation) => {
    const unclaimed = unclaimedByReservation.get(reservation.id)?.size ?? 0;
    return {
      provisionerId: reservation.provisionerId,
      requiredLabels: reservation.requiredLabels,
      reserved: Math.min(reservation.count, unclaimed),
      leaked: Math.max(0, reservation.count - unclaimed),
    };
  });
}

async function lockActiveReservationCandidates(
  tx: Tx,
  rows: readonly {id: string; provisionerId: string}[],
): Promise<void> {
  const idsByProvisioner = new Map<string, string[]>();
  for (const row of rows) {
    const ids = idsByProvisioner.get(row.provisionerId) ?? [];
    ids.push(row.id);
    idsByProvisioner.set(row.provisionerId, ids);
  }
  for (const provisionerId of [...idsByProvisioner.keys()].sort()) {
    await lockRunnerReservationAdvisoryKeysTx(tx, {
      provisionerId,
      reservationIds: idsByProvisioner.get(provisionerId) ?? [],
    });
  }
}

function indexUnclaimedRunnersByReservation(
  runners: readonly {
    id: string;
    firstClaimedAt: Date | null;
    reservationId: string | null;
    intendedReservationId: string | null;
    reservationReleasedAt: Date | null;
    state: (typeof providerRunners.$inferSelect)['state'];
  }[],
  activeIds: ReadonlySet<string>,
): Map<string, Set<string>> {
  const unclaimed = new Map<string, Set<string>>();
  for (const runner of runners) {
    if (!runnerIsUnclaimed(runner)) continue;
    addActiveReservationRunner(unclaimed, activeIds, runner.reservationId, runner.id);
    addActiveReservationRunner(unclaimed, activeIds, runner.intendedReservationId, runner.id);
  }
  return unclaimed;
}

function runnerIsUnclaimed(runner: {
  firstClaimedAt: Date | null;
  reservationReleasedAt: Date | null;
  state: (typeof providerRunners.$inferSelect)['state'];
}): boolean {
  if (runner.firstClaimedAt !== null || runner.reservationReleasedAt !== null) return false;
  return !terminalStates.some((state) => state === runner.state);
}

function addActiveReservationRunner(
  target: Map<string, Set<string>>,
  activeIds: ReadonlySet<string>,
  reservationId: string | null,
  runnerId: string,
): void {
  if (reservationId === null || !activeIds.has(reservationId)) return;
  addUsedRunner(target, reservationId, runnerId);
}

export async function countLiveReservationLeakUnits(): Promise<number> {
  return await db().transaction(
    async (tx) => {
      const rows = await listActiveProvisionerReservationRowsTx(tx, {lockForMutation: false});
      return rows.reduce((total, row) => total + row.leaked, 0);
    },
    {isolationLevel: 'repeatable read', accessMode: 'read only'},
  );
}

function addUsedRunner(
  usedByReservation: Map<string, Set<string>>,
  reservationId: string,
  runnerId: string,
): void {
  const runnerIds = usedByReservation.get(reservationId);
  if (runnerIds) runnerIds.add(runnerId);
  else usedByReservation.set(reservationId, new Set([runnerId]));
}

// An expired or missing reservation is stale. A live reservation protects a runner that is
// still booting or waiting for its activation grace period.
function canBindRunner(tx: Tx, params: BindableRunnerParams) {
  return and(
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
}

function isBindableRunner(tx: Tx, params: BindableRunnerParams) {
  return and(
    eq(providerRunners.provisionerId, params.provisionerId),
    canBindRunner(tx, params),
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
  );
}

async function listIdleRunnerInstancesTx(
  tx: Tx,
  params: IdleRunnerSelectionParams & {count: number},
): Promise<IdleRunnerCandidate[]> {
  const lockedRunners = await selectIdleRunnerInstancesTx(tx, params);
  if (lockedRunners.length === 0) return lockedRunners;

  // A SELECT ... FOR UPDATE can wake with a fresh target row but the original
  // statement snapshot for reservation subqueries. Re-check the full predicate
  // in a new statement while retaining the row locks from the first query.
  return await selectIdleRunnerInstancesTx(tx, {
    ...params,
    runnerIds: lockedRunners.map((runner) => runner.id),
    count: lockedRunners.length,
  });
}

async function selectIdleRunnerInstancesTx(
  tx: Tx,
  params: IdleRunnerSelectionParams & {count: number; runnerIds?: string[]},
): Promise<IdleRunnerCandidate[]> {
  if (params.runnerIds) {
    // The first pass retains the row locks. Recheck the full predicate in a fresh statement so
    // reservation subqueries see the state that was current when the lock was acquired.
    return await tx
      .select({id: providerRunners.id, launchKind: providerRunners.launchKind})
      .from(providerRunners)
      .where(and(inArray(providerRunners.id, params.runnerIds), isBindableRunner(tx, params)))
      .orderBy(asc(providerRunners.createdAt), asc(providerRunners.id))
      .limit(params.count);
  }

  // Select the oldest candidates first, but leave row locking to a second pass. The cleanup
  // path locks runner rows by id, so the locking pass must use that same order. A skipped row
  // rolls back only this nested savepoint and retries the bounded candidate scan, allowing the
  // next-oldest eligible runner to refill the grant without retaining a partial lock set.
  return lockIdleRunnerCandidatesWithRetry(tx, params);
}

async function lockIdleRunnerCandidatesWithRetry(
  tx: Tx,
  params: IdleRunnerSelectionParams & {count: number},
): Promise<IdleRunnerCandidate[]> {
  const retrySelection = Symbol('retry bindable runner selection');
  while (true) {
    try {
      return await tx.transaction((lockTx) =>
        lockIdleRunnerCandidateBatch(lockTx, params, retrySelection),
      );
    } catch (error) {
      if (error !== retrySelection) throw error;
    }
  }
}

async function lockIdleRunnerCandidateBatch(
  tx: Tx,
  params: IdleRunnerSelectionParams & {count: number},
  retrySelection: symbol,
): Promise<IdleRunnerCandidate[]> {
  const candidateRunners = await tx
    .select({id: providerRunners.id, launchKind: providerRunners.launchKind})
    .from(providerRunners)
    .where(isBindableRunner(tx, params))
    .orderBy(asc(providerRunners.createdAt), asc(providerRunners.id))
    .limit(params.count);
  if (candidateRunners.length === 0) return candidateRunners;

  const lockedRunners: typeof candidateRunners = [];
  for (const candidate of [...candidateRunners].sort(compareRunnerIds)) {
    const [runner] = await tx
      .select({id: providerRunners.id, launchKind: providerRunners.launchKind})
      .from(providerRunners)
      .where(and(eq(providerRunners.id, candidate.id), isBindableRunner(tx, params)))
      .for('update');
    if (runner) lockedRunners.push(runner);
  }
  if (lockedRunners.length !== candidateRunners.length) throw retrySelection;
  return lockedRunners;
}

async function bindIdleRunnerInstancesTx(
  tx: Tx,
  params: {
    provisionerId: string;
    reservationId: string;
    workspaceId: string;
    requiredLabels: string[];
    scope: DemandScope;
    idleRunners: IdleRunnerCandidate[];
  },
): Promise<void> {
  const idleRunnerIds = params.idleRunners.map((runner) => runner.id);

  await tx
    .update(runnerActivationTokens)
    .set({revokedAt: sql`now()`})
    .where(
      and(
        inArray(runnerActivationTokens.runnerInstanceId, idleRunnerIds),
        isNull(runnerActivationTokens.consumedAt),
        isNull(runnerActivationTokens.revokedAt),
      ),
    );

  // listIdleRunnerInstancesTx re-checks the full eligibility predicate in a fresh statement
  // after acquiring row locks. Those locks prevent the validated set from changing before this
  // update runs.
  const boundRunners = await tx
    .update(providerRunners)
    .set({
      workspaceId: params.workspaceId,
      reservationId: params.reservationId,
      intendedReservationId: null,
      assignedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(inArray(providerRunners.id, idleRunnerIds), isBindableRunner(tx, params)))
    .returning({id: providerRunners.id, launchKind: providerRunners.launchKind});

  if (boundRunners.length !== params.idleRunners.length)
    throw new Error('Locked idle runner set changed before binding');

  const reboundCount = boundRunners.filter((runner) => runner.launchKind === 'demand').length;
  if (reboundCount > 0)
    recordProviderRunnerActivationOutcome({outcome: 'rebound', count: reboundCount});
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

  const isAffectedRunner = () =>
    or(
      and(
        inArray(providerRunners.reservationId, ids),
        isNull(providerRunners.runnerSessionId),
        isNull(providerRunners.reservationReleasedAt),
      ),
      inArray(providerRunners.intendedReservationId, ids),
    );
  const candidateRunners = await tx
    .select({
      id: providerRunners.id,
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
      runnerSessionId: providerRunners.runnerSessionId,
      reservationReleasedAt: providerRunners.reservationReleasedAt,
    })
    .from(providerRunners)
    .where(isAffectedRunner())
    .orderBy(asc(providerRunners.id));
  const affectedRunners: typeof candidateRunners = [];
  for (const candidate of [...candidateRunners].sort(compareRunnerIds)) {
    const [runner] = await tx
      .select({
        id: providerRunners.id,
        reservationId: providerRunners.reservationId,
        intendedReservationId: providerRunners.intendedReservationId,
        runnerSessionId: providerRunners.runnerSessionId,
        reservationReleasedAt: providerRunners.reservationReleasedAt,
      })
      .from(providerRunners)
      .where(and(eq(providerRunners.id, candidate.id), isAffectedRunner()))
      .for('update');
    if (runner) affectedRunners.push(runner);
  }
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
  const releaseByReservationId = new Map<string, number>();
  for (const release of params.releases) {
    if (release.count <= 0) continue;
    releaseByReservationId.set(
      release.reservationId,
      (releaseByReservationId.get(release.reservationId) ?? 0) + release.count,
    );
  }
  const reservationIds = [...releaseByReservationId.keys()];
  if (reservationIds.length === 0) return 0;

  const releaseCount = sql<number>`CASE ${reservations.id}
    ${sql.join(
      [...releaseByReservationId].map(
        ([reservationId, count]) => sql`WHEN ${reservationId} THEN ${count}`,
      ),
      sql` `,
    )}
    ELSE 0
  END`;
  const scope = and(
    eq(reservations.workspaceId, params.workspaceId),
    eq(reservations.provisionerId, params.provisionerId),
    inArray(reservations.id, reservationIds),
    gt(reservations.expiresAt, sql`now()`),
  );

  const decremented = await tx
    .update(reservations)
    .set({count: sql`${reservations.count} - ${releaseCount}`})
    .where(and(scope, gt(reservations.count, releaseCount)))
    .returning({id: reservations.id});
  const releasedFromDecremented = decremented.reduce(
    (total, row) => total + (releaseByReservationId.get(row.id) ?? 0),
    0,
  );

  const decrementedIds = decremented.map((row) => row.id);
  const deleted = await tx
    .delete(reservations)
    .where(
      and(
        scope,
        sql`${reservations.count} <= ${releaseCount}`,
        decrementedIds.length > 0 ? notInArray(reservations.id, decrementedIds) : undefined,
      ),
    )
    .returning({count: reservations.count});
  const releasedFromDeleted = deleted.reduce((total, row) => total + row.count, 0);

  return releasedFromDeleted + releasedFromDecremented;
}

interface ReleaseTerminalRunnerReservationsParams {
  workspaceId: string | null;
  provisionerId: string;
  providerRunnerIds?: string[];
  runnerInstanceIds?: string[];
  reportedAtByProviderRunnerId?: ReadonlyMap<string, Date>;
  requireUnlinkedSession?: boolean;
  /** Lock linked runners before rechecking terminal state for lease finalization. */
  requireTerminalState?: boolean;
}

export async function releaseTerminalRunnerInstanceReservationsByIds(
  tx: Tx,
  params: ReleaseTerminalRunnerReservationsParams,
): Promise<number> {
  if (
    (params.providerRunnerIds?.length ?? 0) === 0 &&
    (params.runnerInstanceIds?.length ?? 0) === 0
  )
    return 0;

  const {
    reservationWorkspacePredicate,
    noUncancelledRunningJobPredicate,
    reportFreshnessPredicate,
    runnerIdentityPredicate,
  } = terminalReservationReleasePredicates(tx, params);

  // Assignment locks these keys before changing runner links. Acquire them before locking or
  // marking terminal runners so an assignment cannot consume a reservation concurrently with
  // this release.
  const reservationRowsToLock = await tx
    .select({
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.provisionerId, params.provisionerId),
        runnerIdentityPredicate,
        params.requireTerminalState === false
          ? undefined
          : inArray(providerRunners.state, terminalStates),
        or(
          isNotNull(providerRunners.reservationId),
          isNotNull(providerRunners.intendedReservationId),
        ),
        isNull(providerRunners.reservationReleasedAt),
      ),
    );
  const reservationIdsToLock = [
    ...new Set(
      reservationRowsToLock.flatMap((row) =>
        [row.reservationId, row.intendedReservationId].filter(
          (reservationId): reservationId is string => reservationId !== null,
        ),
      ),
    ),
  ];
  await lockRunnerReservationAdvisoryKeysTx(tx, {
    provisionerId: params.provisionerId,
    reservationIds: reservationIdsToLock,
  });

  const rows = await tx
    .select({
      id: providerRunners.id,
      state: providerRunners.state,
      releaseReservationId: sql<string | null>`coalesce(
        (select ${reservations.id}
         from ${reservations}
         where ${reservations.id} = ${providerRunners.intendedReservationId}
           and ${reservations.provisionerId} = ${params.provisionerId}
           ${reservationWorkspacePredicate}),
        (select ${reservations.id}
         from ${reservations}
         where ${reservations.id} = ${providerRunners.reservationId}
           and ${reservations.provisionerId} = ${params.provisionerId}
           ${reservationWorkspacePredicate})
      )`,
      releaseReservationWorkspaceId: sql<string | null>`coalesce(
        (select ${reservations.workspaceId}
         from ${reservations}
         where ${reservations.id} = ${providerRunners.intendedReservationId}
           and ${reservations.provisionerId} = ${params.provisionerId}
           ${reservationWorkspacePredicate}),
        (select ${reservations.workspaceId}
         from ${reservations}
         where ${reservations.id} = ${providerRunners.reservationId}
           and ${reservations.provisionerId} = ${params.provisionerId}
           ${reservationWorkspacePredicate})
      )`,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.provisionerId, params.provisionerId),
        runnerIdentityPredicate,
        params.requireTerminalState === false
          ? undefined
          : inArray(providerRunners.state, terminalStates),
        or(
          isNotNull(providerRunners.reservationId),
          isNotNull(providerRunners.intendedReservationId),
        ),
        params.workspaceId === null
          ? undefined
          : or(
              and(
                eq(providerRunners.workspaceId, params.workspaceId),
                or(
                  exists(
                    tx
                      .select({id: reservations.id})
                      .from(reservations)
                      .where(
                        and(
                          eq(reservations.workspaceId, params.workspaceId),
                          eq(reservations.provisionerId, params.provisionerId),
                          eq(reservations.id, providerRunners.reservationId),
                        ),
                      ),
                  ),
                  exists(
                    tx
                      .select({id: reservations.id})
                      .from(reservations)
                      .where(
                        and(
                          eq(reservations.workspaceId, params.workspaceId),
                          eq(reservations.provisionerId, params.provisionerId),
                          eq(reservations.id, providerRunners.intendedReservationId),
                        ),
                      ),
                  ),
                ),
              ),
              and(
                isNull(providerRunners.workspaceId),
                isNotNull(providerRunners.intendedReservationId),
                exists(
                  tx
                    .select({id: reservations.id})
                    .from(reservations)
                    .where(
                      and(
                        eq(reservations.workspaceId, params.workspaceId),
                        eq(reservations.provisionerId, params.provisionerId),
                        eq(reservations.id, providerRunners.intendedReservationId),
                      ),
                    ),
                ),
              ),
            ),
        params.requireUnlinkedSession === false
          ? undefined
          : isNull(providerRunners.runnerSessionId),
        noUncancelledRunningJobPredicate,
        reportFreshnessPredicate,
        isNull(providerRunners.reservationReleasedAt),
      ),
    )
    .for('update');

  if (rows.length === 0) return 0;

  // The lease-finalization path deliberately locks active rows too. If a terminal report is
  // concurrently projecting the runner state, PostgreSQL rechecks this row after the lock and
  // lets cleanup observe the committed terminal state without a cross-module advisory lock.
  const terminalRows = terminalReservationReleaseRows(rows, params.requireTerminalState);
  if (terminalRows.length === 0) return 0;

  const updated = await tx
    .update(providerRunners)
    .set({
      intendedReservationId: null,
      reservationReleasedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        inArray(
          providerRunners.id,
          terminalRows.map((row) => row.id),
        ),
        params.requireUnlinkedSession === false
          ? undefined
          : isNull(providerRunners.runnerSessionId),
        noUncancelledRunningJobPredicate,
        reportFreshnessPredicate,
        isNull(providerRunners.reservationReleasedAt),
      ),
    )
    .returning({id: providerRunners.id});

  return releaseUpdatedRunnerReservationsTx(tx, params.provisionerId, terminalRows, updated);
}

function terminalReservationReleasePredicates(
  tx: Tx,
  params: ReleaseTerminalRunnerReservationsParams,
) {
  const reservationWorkspacePredicate =
    params.workspaceId === null
      ? sql``
      : sql`and ${eq(reservations.workspaceId, params.workspaceId)}`;
  const noUncancelledRunningJobPredicate = notExists(
    tx
      .select({id: runningJobExecutions.id})
      .from(runningJobExecutions)
      .where(
        and(
          eq(runningJobExecutions.provisionerId, params.provisionerId),
          eq(runningJobExecutions.providerRunnerId, providerRunners.providerRunnerId),
          isNull(runningJobExecutions.cancellationRequestedAt),
          params.workspaceId === null
            ? undefined
            : eq(runningJobExecutions.workspaceId, params.workspaceId),
        ),
      ),
  );
  const reportFreshnessPredicate =
    params.reportedAtByProviderRunnerId && params.reportedAtByProviderRunnerId.size > 0
      ? or(
          ...[...params.reportedAtByProviderRunnerId].map(([providerRunnerId, reportedAt]) =>
            and(
              eq(providerRunners.providerRunnerId, providerRunnerId),
              lte(providerRunners.reportedAt, reportedAt),
            ),
          ),
        )
      : undefined;
  const runnerIdentityPredicate = or(
    params.providerRunnerIds && params.providerRunnerIds.length > 0
      ? inArray(providerRunners.providerRunnerId, params.providerRunnerIds)
      : undefined,
    params.runnerInstanceIds && params.runnerInstanceIds.length > 0
      ? inArray(providerRunners.id, params.runnerInstanceIds)
      : undefined,
  );
  return {
    reservationWorkspacePredicate,
    noUncancelledRunningJobPredicate,
    reportFreshnessPredicate,
    runnerIdentityPredicate,
  };
}

type TerminalReservationReleaseRow = {
  id: string;
  state: (typeof providerRunners.$inferSelect)['state'];
  releaseReservationId: string | null;
  releaseReservationWorkspaceId: string | null;
};

function terminalReservationReleaseRows(
  rows: readonly TerminalReservationReleaseRow[],
  requireTerminalState: boolean | undefined,
): readonly TerminalReservationReleaseRow[] {
  if (requireTerminalState !== false) return rows;
  return rows.filter((row) => terminalStates.some((terminalState) => terminalState === row.state));
}

async function releaseUpdatedRunnerReservationsTx(
  tx: Tx,
  provisionerId: string,
  terminalRows: readonly TerminalReservationReleaseRow[],
  updated: readonly {id: string}[],
): Promise<number> {
  const releasesByReservation = groupRunnerReservationReleases(terminalRows, updated);
  const releasesByWorkspace = groupReservationReleasesByWorkspace(releasesByReservation.values());
  let released = 0;
  for (const [workspaceId, releases] of releasesByWorkspace) {
    released += await releaseReservationUnits(tx, {workspaceId, provisionerId, releases});
  }
  return released;
}

function groupRunnerReservationReleases(
  rows: readonly TerminalReservationReleaseRow[],
  updated: readonly {id: string}[],
): Map<string, {workspaceId: string; reservationId: string; count: number}> {
  const releases = new Map<string, {workspaceId: string; reservationId: string; count: number}>();
  const updatedIds = new Set(updated.map((row) => row.id));
  for (const row of rows) {
    if (!updatedIds.has(row.id)) continue;
    if (!row.releaseReservationId || !row.releaseReservationWorkspaceId) continue;
    const key = `${row.releaseReservationWorkspaceId}:${row.releaseReservationId}`;
    const release = releases.get(key) ?? {
      workspaceId: row.releaseReservationWorkspaceId,
      reservationId: row.releaseReservationId,
      count: 0,
    };
    release.count += 1;
    releases.set(key, release);
  }
  return releases;
}

function groupReservationReleasesByWorkspace(
  releases: Iterable<{workspaceId: string; reservationId: string; count: number}>,
): Map<string, Array<{reservationId: string; count: number}>> {
  const grouped = new Map<string, Array<{reservationId: string; count: number}>>();
  for (const release of releases) {
    const workspaceReleases = grouped.get(release.workspaceId) ?? [];
    workspaceReleases.push({reservationId: release.reservationId, count: release.count});
    grouped.set(release.workspaceId, workspaceReleases);
  }
  return grouped;
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

function compareRunnerIds(left: {id: string}, right: {id: string}): number {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
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
