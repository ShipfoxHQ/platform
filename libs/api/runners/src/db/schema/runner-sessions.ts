import type {
  RunnerLifecycleCapabilitiesDto,
  RunnerToolCapabilitiesDto,
} from '@shipfox/api-runners-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, index, integer, jsonb, pgEnum, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {RunnerSession} from '#core/entities/runner-session.js';
import {pgTable} from './common.js';

export const runnerSessionScopeEnum = pgEnum('runners_runner_session_scope', ['workspace']);
export const runnerSessionRegistrationTokenKindEnum = pgEnum(
  'runners_runner_session_registration_token_kind',
  ['manual', 'ephemeral', 'activation'],
);

export const runnerSessions = pgTable(
  'runner_sessions',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    scope: runnerSessionScopeEnum('scope').notNull().default('workspace'),
    registrationTokenId: uuid('registration_token_id').notNull(),
    registrationTokenKind:
      runnerSessionRegistrationTokenKindEnum('registration_token_kind').notNull(),
    runnerInstanceId: uuid('runner_instance_id'),
    provisionerId: uuid('provisioner_id'),
    providerRunnerId: text('provider_runner_id'),
    labels: text('labels').array().notNull(),
    toolCapabilities: jsonb('tool_capabilities').$type<RunnerToolCapabilitiesDto | null>(),
    toolCapabilitiesReportedAt: timestamp('tool_capabilities_reported_at', {withTimezone: true}),
    lifecycleCapabilities: jsonb(
      'lifecycle_capabilities',
    ).$type<RunnerLifecycleCapabilitiesDto | null>(),
    lifecycleCapabilitiesReportedAt: timestamp('lifecycle_capabilities_reported_at', {
      withTimezone: true,
    }),
    maxClaims: integer('max_claims'),
    claimsUsed: integer('claims_used').notNull().default(0),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('runners_runner_sessions_kind_created_id_idx').on(
      table.registrationTokenKind,
      table.createdAt,
      table.id,
    ),
    check(
      'runners_runner_sessions_claims_ck',
      sql`${table.claimsUsed} >= 0 AND ((${table.registrationTokenKind} = 'manual' AND ${table.maxClaims} IS NULL) OR (${table.registrationTokenKind} in ('ephemeral', 'activation') AND ${table.maxClaims} IS NOT NULL AND ${table.maxClaims} > 0 AND ${table.claimsUsed} <= ${table.maxClaims}))`,
    ),
    check(
      'runners_runner_sessions_link_ck',
      sql`((${table.registrationTokenKind} = 'manual' AND ${table.runnerInstanceId} IS NULL AND ${table.provisionerId} IS NULL AND ${table.providerRunnerId} IS NULL) OR (${table.registrationTokenKind} = 'ephemeral' AND ${table.runnerInstanceId} IS NULL AND ${table.provisionerId} IS NOT NULL AND ${table.providerRunnerId} IS NOT NULL) OR (${table.registrationTokenKind} = 'activation' AND ${table.runnerInstanceId} IS NOT NULL AND ${table.provisionerId} IS NOT NULL AND ${table.providerRunnerId} IS NOT NULL))`,
    ),
    index('runners_runner_sessions_provider_runner_updated_idx')
      .on(table.workspaceId, table.provisionerId, table.providerRunnerId, table.updatedAt)
      .where(sql`"provisioner_id" IS NOT NULL`),
  ],
);

export type RunnerSessionDb = typeof runnerSessions.$inferSelect;
export type RunnerSessionInsertDb = typeof runnerSessions.$inferInsert;

export function toRunnerSession(row: RunnerSessionDb): RunnerSession {
  if (row.scope !== 'workspace') {
    throw new Error(`Unexpected runner session scope: ${row.scope}`);
  }

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    scope: row.scope,
    registrationTokenId: row.registrationTokenId,
    registrationTokenKind: row.registrationTokenKind,
    runnerInstanceId: row.runnerInstanceId,
    provisionerId: row.provisionerId,
    providerRunnerId: row.providerRunnerId,
    labels: row.labels,
    toolCapabilities: row.toolCapabilities,
    toolCapabilitiesReportedAt: row.toolCapabilitiesReportedAt,
    lifecycleCapabilities: row.lifecycleCapabilities,
    lifecycleCapabilitiesReportedAt: row.lifecycleCapabilitiesReportedAt,
    maxClaims: row.maxClaims,
    claimsUsed: row.claimsUsed,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
