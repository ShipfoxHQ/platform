import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, index, integer, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {type TriggerDecision, triggerDecisionOutcomes} from '#core/entities/decision.js';
import {pgTable} from './common.js';
import {jobListenerMatcherKindEnum} from './job-listener-subscriptions.js';
import {triggersReceivedEvents} from './received-events.js';

const triggerDecisionSubscriptionKinds = ['trigger', 'listener', 'dev'] as const;

export const triggersDecisions = pgTable(
  'decisions',
  {
    id: uuidv7PrimaryKey(),
    receivedEventId: uuid('received_event_id')
      .notNull()
      .references(() => triggersReceivedEvents.id, {onDelete: 'cascade'}),
    subscriptionKind: text('subscription_kind', {enum: triggerDecisionSubscriptionKinds}).notNull(),
    // Null for `dev` decisions: the partial dev index enforces one decision
    // per received event.
    subscriptionId: uuid('subscription_id'),
    subscriptionName: text('subscription_name').notNull(),
    workflowDefinitionId: uuid('workflow_definition_id'),
    projectId: uuid('project_id'),
    workflowRunId: uuid('workflow_run_id'),
    jobId: uuid('job_id'),
    matcherKind: jobListenerMatcherKindEnum('matcher_kind'),
    matcherOrdinal: integer('matcher_ordinal'),
    decision: text('decision', {enum: triggerDecisionOutcomes}).notNull(),
    runId: uuid('run_id'),
    runName: text('run_name'),
    reason: text('reason'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('triggers_decisions_event_subscription_unique').on(
      table.receivedEventId,
      table.subscriptionKind,
      table.subscriptionId,
    ),
    uniqueIndex('triggers_decisions_dev_event_unique')
      .on(table.receivedEventId)
      .where(sql`${table.subscriptionKind} = 'dev'`),
    index('triggers_decisions_run_idx').on(table.runId),
    check(
      'triggers_decisions_subscription_kind_ck',
      sql`${table.subscriptionKind} IN ('trigger', 'listener', 'dev')`,
    ),
    check(
      'triggers_decisions_subscription_id_ck',
      sql`(${table.subscriptionKind} = 'dev' AND ${table.subscriptionId} IS NULL) OR (${table.subscriptionKind} IN ('trigger', 'listener') AND ${table.subscriptionId} IS NOT NULL)`,
    ),
  ],
);

export type TriggerDecisionDb = typeof triggersDecisions.$inferSelect;
export type TriggerDecisionInsertDb = typeof triggersDecisions.$inferInsert;

export function toTriggerDecision(row: TriggerDecisionDb): TriggerDecision {
  return {
    id: row.id,
    receivedEventId: row.receivedEventId,
    subscriptionKind: row.subscriptionKind,
    subscriptionId: row.subscriptionId,
    subscriptionName: row.subscriptionName,
    workflowDefinitionId: row.workflowDefinitionId,
    projectId: row.projectId,
    workflowRunId: row.workflowRunId,
    jobId: row.jobId,
    matcherKind: row.matcherKind,
    matcherOrdinal: row.matcherOrdinal,
    decision: toTriggerDecisionOutcome(row.decision),
    runId: row.runId,
    runName: row.runName,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

function toTriggerDecisionOutcome(decision: string): TriggerDecision['decision'] {
  if (decision === 'errored') return 'dispatch-error';
  if (decision === 'triggered' || decision === 'filter-error' || decision === 'dispatch-error') {
    return decision;
  }
  return 'dispatch-error';
}
