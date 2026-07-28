import type {
  AdministrationActionEvent,
  AdministrationActionEventMap,
} from '@shipfox/api-common-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, eq, sql} from 'drizzle-orm';
import {
  WorkspaceAdminIdempotencyKeyReuseError,
  WorkspaceAlreadySuspendedError,
  WorkspaceDeletedError,
  WorkspaceNotFoundError,
  WorkspaceNotSuspendedError,
} from '#core/errors.js';
import {db} from './db.js';
import {
  type WorkspaceAdminCommandResultDb,
  workspacesAdminCommandResults,
} from './schema/admin-command-results.js';
import {workspacesOutbox} from './schema/outbox.js';
import {workspaces} from './schema/workspaces.js';

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

export interface WorkspaceAdministrationResult {
  workspaceId: string;
  status: 'active' | 'suspended';
  correlationId: string;
}

interface AuditedWorkspaceCommandParams {
  actorId: string;
  idempotencyKeyFingerprint: string;
  requestFingerprint: string;
  event: AdministrationActionEvent;
  workspaceId: string;
}

async function loadCommandResult(
  tx: Tx,
  params: Pick<AuditedWorkspaceCommandParams, 'actorId' | 'idempotencyKeyFingerprint'> & {
    command: string;
    requestFingerprint: string;
  },
): Promise<WorkspaceAdministrationResult | undefined> {
  const rows = await tx
    .select()
    .from(workspacesAdminCommandResults)
    .where(
      and(
        eq(workspacesAdminCommandResults.actorId, params.actorId),
        eq(
          workspacesAdminCommandResults.idempotencyKeyFingerprint,
          params.idempotencyKeyFingerprint,
        ),
      ),
    )
    .limit(1);
  const result: WorkspaceAdminCommandResultDb | undefined = rows[0];
  if (!result) return undefined;
  if (
    result.command !== params.command ||
    result.requestFingerprint !== params.requestFingerprint
  ) {
    throw new WorkspaceAdminIdempotencyKeyReuseError();
  }
  return result.result;
}

async function storeCommandResult(
  tx: Tx,
  params: AuditedWorkspaceCommandParams,
  result: WorkspaceAdministrationResult,
): Promise<void> {
  await tx.insert(workspacesAdminCommandResults).values({
    actorId: params.actorId,
    idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
    command: params.event.command,
    requestFingerprint: params.requestFingerprint,
    result,
  });
}

async function writeAdministrationAction(tx: Tx, event: AdministrationActionEvent): Promise<void> {
  await writeOutboxEvent<AdministrationActionEventMap>(tx, workspacesOutbox, {
    type: 'administration.action.performed',
    payload: event,
  });
}

async function lockAdminCommand(
  tx: Tx,
  params: {actorId: string; idempotencyKeyFingerprint: string},
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`workspaces_admin_command:${params.actorId}:${params.idempotencyKeyFingerprint}`}))`,
  );
}

async function updateWorkspaceStatusWithAudit(
  params: AuditedWorkspaceCommandParams & {
    expectedStatus: 'active' | 'suspended';
    nextStatus: 'active' | 'suspended';
  },
): Promise<WorkspaceAdministrationResult> {
  return await db().transaction(async (tx) => {
    await lockAdminCommand(tx, params);

    const existing = await loadCommandResult(tx, {
      actorId: params.actorId,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      command: params.event.command,
      requestFingerprint: params.requestFingerprint,
    });
    if (existing) return existing;

    const rows = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, params.workspaceId))
      .for('update')
      .limit(1);
    const workspaceRow = rows[0];
    if (!workspaceRow) throw new WorkspaceNotFoundError(params.workspaceId);
    if (workspaceRow.status === 'deleted') throw new WorkspaceDeletedError(params.workspaceId);
    if (workspaceRow.status !== params.expectedStatus) {
      if (params.nextStatus === 'suspended') {
        throw new WorkspaceAlreadySuspendedError(params.workspaceId);
      }
      throw new WorkspaceNotSuspendedError(params.workspaceId);
    }

    const updatedRows = await tx
      .update(workspaces)
      .set({status: params.nextStatus, updatedAt: new Date()})
      .where(eq(workspaces.id, params.workspaceId))
      .returning();
    const updatedRow = updatedRows[0];
    if (!updatedRow) throw new WorkspaceNotFoundError(params.workspaceId);

    const result = {
      workspaceId: updatedRow.id,
      status: updatedRow.status as 'active' | 'suspended',
      correlationId: params.event.correlationId,
    } satisfies WorkspaceAdministrationResult;
    await writeAdministrationAction(tx, params.event);
    await storeCommandResult(tx, params, result);
    return result;
  });
}

export async function suspendWorkspaceWithAudit(
  params: AuditedWorkspaceCommandParams,
): Promise<WorkspaceAdministrationResult> {
  return await updateWorkspaceStatusWithAudit({
    ...params,
    expectedStatus: 'active',
    nextStatus: 'suspended',
  });
}

export async function reactivateWorkspaceWithAudit(
  params: AuditedWorkspaceCommandParams,
): Promise<WorkspaceAdministrationResult> {
  return await updateWorkspaceStatusWithAudit({
    ...params,
    expectedStatus: 'suspended',
    nextStatus: 'active',
  });
}
