import type {
  AdministrationActionEvent,
  AdministrationActionEventMap,
} from '@shipfox/api-common-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, eq, sql} from 'drizzle-orm';
import {AdminIdempotencyKeyReuseError} from '#core/errors.js';
import type {db} from './db.js';
import {
  type AdminCommandResultDb,
  adminCommandResults,
  type StoredAdminCommandResult,
} from './schema/admin-command-results.js';
import {authOutbox} from './schema/outbox.js';

export type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

export interface AdminCommandTransactionParams {
  actorId: string;
  idempotencyKeyFingerprint: string;
  requestFingerprint: string;
  event: AdministrationActionEvent;
}

export async function lockAdminCommand(
  tx: Tx,
  params: Pick<AdminCommandTransactionParams, 'actorId' | 'idempotencyKeyFingerprint'>,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`auth_admin_command:${params.actorId}:${params.idempotencyKeyFingerprint}`}))`,
  );
}

export async function lockAdminOwnerGrants(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('auth_admin_owner_grants'))`);
}

export async function findAdminCommandResult(
  tx: Tx,
  params: Pick<
    AdminCommandTransactionParams,
    'actorId' | 'idempotencyKeyFingerprint' | 'requestFingerprint'
  > & {command: string},
): Promise<AdminCommandResultDb | undefined> {
  const rows = await tx
    .select()
    .from(adminCommandResults)
    .where(
      and(
        eq(adminCommandResults.actorId, params.actorId),
        eq(adminCommandResults.idempotencyKeyFingerprint, params.idempotencyKeyFingerprint),
      ),
    )
    .limit(1);
  const result = rows[0];
  if (!result) return undefined;
  if (
    result.command !== params.command ||
    result.requestFingerprint !== params.requestFingerprint
  ) {
    throw new AdminIdempotencyKeyReuseError();
  }
  return result;
}

export async function storeAdminCommandResult(
  tx: Tx,
  params: AdminCommandTransactionParams,
  result: StoredAdminCommandResult,
): Promise<void> {
  await tx.insert(adminCommandResults).values({
    actorId: params.actorId,
    idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
    command: params.event.command,
    requestFingerprint: params.requestFingerprint,
    result,
  });
}

export async function writeAdminAction(tx: Tx, event: AdministrationActionEvent): Promise<void> {
  await writeOutboxEvent<AdministrationActionEventMap>(tx, authOutbox, {
    type: 'administration.action.performed',
    payload: event,
  });
}
