import type {TriggerDto} from '@shipfox/api-definitions-dto';
import {and, eq, inArray, isNull, notInArray, or} from 'drizzle-orm';
import type {TriggerSubscription} from '#core/entities/subscription.js';
import {deleteCronScheduleForSubscription, syncCronSchedule} from './cron-schedules.js';
import {db, type Executor, type Tx} from './db.js';
import {toTriggerSubscription, triggerSubscriptions} from './schema/subscriptions.js';

// The write path accepts an absent event (stored as NULL, meaning a source
// subscription) ahead of the DTO relaxation. `TriggerDto.event` stays required
// at the sync boundary; only the projection into subscription rows is optional.
interface ProjectDefinitionTrigger extends Omit<TriggerDto, 'event'> {
  event?: string | undefined;
}

export interface ProjectDefinitionTriggersParams {
  tx?: Tx | undefined;
  workspaceId: string;
  projectId: string;
  workflowDefinitionId: string;
  triggers: Record<string, ProjectDefinitionTrigger>;
}

export async function projectDefinitionTriggers(
  params: ProjectDefinitionTriggersParams,
): Promise<void> {
  const work = async (tx: Tx): Promise<void> => {
    const entries = Object.entries(params.triggers);
    const keepNames = entries.map(([name]) => name);

    if (keepNames.length === 0) {
      await tx
        .delete(triggerSubscriptions)
        .where(eq(triggerSubscriptions.workflowDefinitionId, params.workflowDefinitionId));
      return;
    }

    await tx
      .delete(triggerSubscriptions)
      .where(
        and(
          eq(triggerSubscriptions.workflowDefinitionId, params.workflowDefinitionId),
          notInArray(triggerSubscriptions.name, keepNames),
        ),
      );

    for (const [name, trigger] of entries) {
      const config: Record<string, unknown> = {};
      if (trigger.with !== undefined) config.with = trigger.with;
      if (trigger.filter !== undefined) config.filter = trigger.filter;

      const [upserted] = await tx
        .insert(triggerSubscriptions)
        .values({
          workspaceId: params.workspaceId,
          projectId: params.projectId,
          workflowDefinitionId: params.workflowDefinitionId,
          name,
          source: trigger.source,
          // An absent event is stored as NULL: a source subscription matching
          // every event the source delivers.
          event: trigger.event ?? null,
          config,
        })
        .onConflictDoUpdate({
          target: [triggerSubscriptions.workflowDefinitionId, triggerSubscriptions.name],
          set: {
            workspaceId: params.workspaceId,
            projectId: params.projectId,
            source: trigger.source,
            event: trigger.event ?? null,
            config,
            updatedAt: new Date(),
          },
        })
        .returning({id: triggerSubscriptions.id});
      if (!upserted) throw new Error('Trigger subscription upsert returned no rows');

      if (trigger.source === 'cron') {
        await syncCronSchedule({
          tx,
          subscriptionId: upserted.id,
          workspaceId: params.workspaceId,
          triggerConfig: trigger.config,
        });
      } else {
        await deleteCronScheduleForSubscription({tx, subscriptionId: upserted.id});
      }
    }
  };

  if (params.tx) {
    await work(params.tx);
    return;
  }
  await db().transaction(work);
}

export interface DeleteSubscriptionsForDefinitionParams {
  tx?: Tx | undefined;
  workflowDefinitionId: string;
}

export async function deleteSubscriptionsForDefinition(
  params: DeleteSubscriptionsForDefinitionParams,
): Promise<number> {
  const work = async (executor: Executor): Promise<number> => {
    const rows = await executor
      .delete(triggerSubscriptions)
      .where(eq(triggerSubscriptions.workflowDefinitionId, params.workflowDefinitionId))
      .returning({id: triggerSubscriptions.id});
    return rows.length;
  };
  if (params.tx) return await work(params.tx);
  return await db().transaction(work);
}

export async function getTriggerSubscriptionById(
  id: string,
): Promise<TriggerSubscription | undefined> {
  const rows = await db()
    .select()
    .from(triggerSubscriptions)
    .where(eq(triggerSubscriptions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toTriggerSubscription(row);
}

export async function getManualSubscriptionByDefinitionId(
  workflowDefinitionId: string,
): Promise<TriggerSubscription | undefined> {
  // limit(2) catches a broken parser invariant (>1 manual per definition) loudly instead of silently picking one.
  const rows = await db()
    .select()
    .from(triggerSubscriptions)
    .where(
      and(
        eq(triggerSubscriptions.workflowDefinitionId, workflowDefinitionId),
        eq(triggerSubscriptions.source, 'manual'),
      ),
    )
    .limit(2);
  if (rows.length > 1) {
    throw new Error(
      `Workflow definition ${workflowDefinitionId} has ${rows.length} manual triggers; expected at most 1`,
    );
  }
  const row = rows[0];
  if (!row) return undefined;
  return toTriggerSubscription(row);
}

export interface FindMatchingSubscriptionsParams {
  workspaceId: string;
  source: string;
  event: string;
}

// Matches at workspace scope: an inbound integration event is a workspace-level
// fact, not addressed to a project. Narrowing to a repo/project/branch is left to
// user-defined per-workflow filters, not inferred here. A NULL subscription event
// is a source subscription and matches every event the source delivers.
export async function findMatchingSubscriptions(
  params: FindMatchingSubscriptionsParams,
): Promise<TriggerSubscription[]> {
  const rows = await db()
    .select()
    .from(triggerSubscriptions)
    .where(
      and(
        eq(triggerSubscriptions.workspaceId, params.workspaceId),
        eq(triggerSubscriptions.source, params.source),
        or(eq(triggerSubscriptions.event, params.event), isNull(triggerSubscriptions.event)),
      ),
    );
  return rows.map(toTriggerSubscription);
}

export async function listSubscriptionsByWorkflowDefinitionIds(
  workflowDefinitionIds: string[],
): Promise<TriggerSubscription[]> {
  if (workflowDefinitionIds.length === 0) return [];
  const rows = await db()
    .select()
    .from(triggerSubscriptions)
    .where(inArray(triggerSubscriptions.workflowDefinitionId, workflowDefinitionIds));
  return rows.map(toTriggerSubscription);
}
