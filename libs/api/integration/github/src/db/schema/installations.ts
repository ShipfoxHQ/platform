import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {GithubInstallation} from '#db/installations.js';
import {pgTable} from './common.js';

export const githubInstallations = pgTable(
  'installations',
  {
    id: uuidv7PrimaryKey(),
    connectionId: uuid('connection_id').notNull(),
    installationId: text('installation_id').notNull(),
    accountLogin: text('account_login').notNull(),
    accountType: text('account_type').notNull(),
    repositorySelection: text('repository_selection').notNull(),
    suspendedAt: timestamp('suspended_at', {withTimezone: true}),
    deletedAt: timestamp('deleted_at', {withTimezone: true}),
    latestEvent: jsonb('latest_event').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_github_installations_connection_unique').on(table.connectionId),
    uniqueIndex('integrations_github_installations_installation_unique').on(table.installationId),
  ],
);

export type GithubInstallationDb = typeof githubInstallations.$inferSelect;
export type GithubInstallationCreateDb = typeof githubInstallations.$inferInsert;

export function toGithubInstallation(row: GithubInstallationDb): GithubInstallation {
  return {
    id: row.id,
    connectionId: row.connectionId,
    installationId: row.installationId,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    repositorySelection: row.repositorySelection,
    suspendedAt: row.suspendedAt,
    deletedAt: row.deletedAt,
    latestEvent: row.latestEvent,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
