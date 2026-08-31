import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';
import {jobCheckoutContentsEnum} from './jobs.js';
import {steps} from './steps.js';
import {workflowRunAttempts} from './workflow-run-attempts.js';

export const checkoutRenewalSubjectStatusEnum = pgEnum(
  'workflows_checkout_renewal_subject_status',
  ['pending', 'promoted'],
);

export const checkoutRenewalSubjects = pgTable(
  'checkout_renewal_subjects',
  {
    id: uuidv7PrimaryKey(),
    stepId: uuid('step_id')
      .notNull()
      .references(() => steps.id, {onDelete: 'cascade'}),
    workflowRunAttemptId: uuid('workflow_run_attempt_id')
      .notNull()
      .references(() => workflowRunAttempts.id, {onDelete: 'cascade'}),
    attempt: integer('attempt').notNull(),
    status: checkoutRenewalSubjectStatusEnum('status').notNull().default('pending'),
    repositoryUrl: text('repository_url').notNull(),
    connectionId: uuid('connection_id').notNull(),
    externalRepositoryId: text('external_repository_id').notNull(),
    permissionsContents: jobCheckoutContentsEnum('permissions_contents').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    promotedAt: timestamp('promoted_at', {withTimezone: true}),
  },
  (table) => [
    uniqueIndex('workflows_crs_step_id_attempt_uq').on(table.stepId, table.attempt),
    index('workflows_crs_workflow_run_attempt_id_idx').on(table.workflowRunAttemptId),
    check('workflows_crs_attempt_positive_ck', sql`${table.attempt} > 0`),
    check(
      'workflows_crs_promoted_at_ck',
      sql`(${table.status} = 'pending' and ${table.promotedAt} is null) or (${table.status} = 'promoted' and ${table.promotedAt} is not null)`,
    ),
  ],
);

export type CheckoutRenewalSubjectDb = typeof checkoutRenewalSubjects.$inferSelect;
