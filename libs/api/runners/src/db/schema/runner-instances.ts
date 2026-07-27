import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, jsonb, pgEnum, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {RunnerInstance} from '#core/entities/runner-instance.js';
import {pgTable} from './common.js';

export const providerRunnerStateEnum = pgEnum('runners_provider_runner_state', [
  'starting',
  'running',
  'stopping',
  'stopped',
  'failed',
  'terminated',
]);

export const providerRunners = pgTable(
  'runner_instances',
  {
    id: uuidv7PrimaryKey(),
    // Kept during the protocol migration for legacy workspace capacity. New capacity is owned
    // only by its provisioner and has no workspace assignment.
    workspaceId: uuid('workspace_id'),
    provisionerId: uuid('provisioner_id').notNull(),
    providerRunnerId: text('provider_runner_id'),
    intendedReservationId: uuid('intended_reservation_id'),
    reservationId: uuid('reservation_id'),
    assignedAt: timestamp('assigned_at', {withTimezone: true}),
    templateKey: text('template_key'),
    labels: text('labels').array().notNull().default([]),
    state: providerRunnerStateEnum('state').notNull(),
    reason: text('reason'),
    runnerSessionId: uuid('runner_session_id'),
    providerKind: text('provider_kind'),
    protocolVersion: text('protocol_version'),
    capabilities: jsonb('capabilities').$type<RunnerToolCapabilitiesDto | null>(),
    reportedAt: timestamp('reported_at', {withTimezone: true}).notNull(),
    startedAt: timestamp('started_at', {withTimezone: true}),
    stoppingAt: timestamp('stopping_at', {withTimezone: true}),
    stoppedAt: timestamp('stopped_at', {withTimezone: true}),
    failedAt: timestamp('failed_at', {withTimezone: true}),
    terminatedAt: timestamp('terminated_at', {withTimezone: true}),
    reservationReleasedAt: timestamp('reservation_released_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_runner_instances_provisioner_runner_unique')
      .on(table.provisionerId, table.providerRunnerId)
      .where(sql`${table.providerRunnerId} is not null`),
    index('runners_runner_instances_workspace_state_updated_idx').on(table.state, table.updatedAt),
    index('runners_runner_instances_stale_reaper_idx').on(
      table.state,
      table.updatedAt,
      table.reportedAt,
    ),
    index('runners_runner_instances_provisioner_intended_reservation_idx')
      .on(table.provisionerId, table.intendedReservationId)
      .where(
        sql`${table.intendedReservationId} is not null and ${table.reservationReleasedAt} is null`,
      ),
    index('runners_runner_instances_provisioner_reservation_idx')
      .on(table.provisionerId, table.reservationId)
      .where(sql`${table.reservationId} is not null`),
    index('runners_runner_instances_active_template_counts_idx')
      .on(table.provisionerId, table.state, table.templateKey)
      .where(sql`"state" in ('starting', 'running') and "template_key" is not null`),
  ],
);

export type RunnerInstanceDb = typeof providerRunners.$inferSelect;
export type RunnerInstanceInsertDb = typeof providerRunners.$inferInsert;

export function toRunnerInstance(row: RunnerInstanceDb): RunnerInstance {
  if (!row.providerRunnerId) throw new Error('Runner instance has no provider runner identity');
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provisionerId: row.provisionerId,
    providerRunnerId: row.providerRunnerId,
    reservationId: row.reservationId,
    assignedAt: row.assignedAt,
    templateKey: row.templateKey,
    labels: row.labels,
    state: row.state,
    reason: row.reason,
    runnerSessionId: row.runnerSessionId,
    providerKind: row.providerKind,
    reportedAt: row.reportedAt,
    startedAt: row.startedAt,
    stoppingAt: row.stoppingAt,
    stoppedAt: row.stoppedAt,
    failedAt: row.failedAt,
    terminatedAt: row.terminatedAt,
    reservationReleasedAt: row.reservationReleasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
