import {type TimestampIdCursor, timestampIdCursorWhere} from '@shipfox/node-drizzle';
import {canonicalizeLabels} from '@shipfox/runner-labels';
import {
  and,
  arrayContains,
  desc,
  eq,
  exists,
  gt,
  isNotNull,
  isNull,
  type SQL,
  sql,
} from 'drizzle-orm';
import type {RunnerInstanceState} from '#core/entities/runner-instance.js';
import {db} from './db.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';
import {runnerControlSessions} from './schema/runner-control-sessions.js';
import {providerRunners} from './schema/runner-instances.js';
import {runnerSessions} from './schema/runner-sessions.js';

export type AdministratorRunnerAssignmentFilter = 'assigned' | 'unassigned';

export interface AdministratorRunnerInstanceRow {
  id: string;
  workspaceId: string | null;
  state: RunnerInstanceState;
  labels: string[];
  runnerSessionId: string | null;
  claimsUsed: number | null;
  hasActiveControlSession: boolean;
  reason: string | null;
  reportedAt: Date;
  stoppedAt: Date | null;
  failedAt: Date | null;
  terminatedAt: Date | null;
  createdAt: Date;
  provisionerId: string;
  provisionerName: string | null;
  provisionerLastSeenAt: Date | null;
}

export interface ListAdministratorRunnerInstancesParams {
  limit: number;
  cursor?: TimestampIdCursor | undefined;
  state?: RunnerInstanceState | undefined;
  assignment?: AdministratorRunnerAssignmentFilter | undefined;
  label?: string | undefined;
}

export interface ListAdministratorRunnerInstancesResult {
  runners: AdministratorRunnerInstanceRow[];
  nextCursor: TimestampIdCursor | null;
}

export async function listAdministratorRunnerInstances(
  params: ListAdministratorRunnerInstancesParams,
): Promise<ListAdministratorRunnerInstancesResult> {
  const conditions: SQL[] = [eq(provisionerTokens.scope, 'installation')];
  const cursor = timestampIdCursorWhere({
    timestampColumn: providerRunners.createdAt,
    idColumn: providerRunners.id,
    cursor: params.cursor,
  });

  if (cursor) conditions.push(cursor);
  if (params.state) conditions.push(eq(providerRunners.state, params.state));
  if (params.assignment === 'assigned') conditions.push(isNotNull(providerRunners.workspaceId));
  if (params.assignment === 'unassigned') conditions.push(isNull(providerRunners.workspaceId));
  if (params.label) {
    const [label] = canonicalizeLabels(params.label);
    if (label) conditions.push(arrayContains(providerRunners.labels, [label]));
  }

  const rows = await db()
    .select({
      id: providerRunners.id,
      workspaceId: providerRunners.workspaceId,
      state: providerRunners.state,
      labels: providerRunners.labels,
      runnerSessionId: providerRunners.runnerSessionId,
      claimsUsed: runnerSessions.claimsUsed,
      hasActiveControlSession: exists(
        db()
          .select({id: runnerControlSessions.id})
          .from(runnerControlSessions)
          .where(
            and(
              eq(runnerControlSessions.runnerInstanceId, providerRunners.id),
              isNull(runnerControlSessions.closedAt),
              gt(runnerControlSessions.expiresAt, sql`now()`),
            ),
          ),
      ),
      reason: providerRunners.reason,
      reportedAt: providerRunners.reportedAt,
      stoppedAt: providerRunners.stoppedAt,
      failedAt: providerRunners.failedAt,
      terminatedAt: providerRunners.terminatedAt,
      createdAt: providerRunners.createdAt,
      provisionerId: provisionerTokens.id,
      provisionerName: provisionerTokens.name,
      provisionerLastSeenAt: provisionerTokens.lastSeenAt,
    })
    .from(providerRunners)
    .innerJoin(provisionerTokens, eq(provisionerTokens.id, providerRunners.provisionerId))
    .leftJoin(runnerSessions, eq(runnerSessions.id, providerRunners.runnerSessionId))
    .where(and(...conditions))
    .orderBy(desc(providerRunners.createdAt), desc(providerRunners.id))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);

  return {
    runners: pageRows.map((row) => ({
      ...row,
      hasActiveControlSession: Boolean(row.hasActiveControlSession),
    })),
    nextCursor: hasMore && last ? {createdAt: last.createdAt, id: last.id} : null,
  };
}
