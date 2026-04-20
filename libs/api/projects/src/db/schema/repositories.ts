import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {pgEnum, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {Repository, RepositoryVisibility} from '#core/entities/repository.js';
import type {VcsProviderKind} from '#core/entities/vcs-connection.js';
import {pgTable} from './common.js';
import {vcsConnections, vcsProviderEnum} from './vcs-connections.js';

export const repositoryVisibilityEnum = pgEnum('projects_repository_visibility', [
  'public',
  'private',
  'internal',
  'unknown',
]);

export const repositories = pgTable(
  'repositories',
  {
    id: uuidv7PrimaryKey(),
    vcsConnectionId: uuid('vcs_connection_id')
      .notNull()
      .references(() => vcsConnections.id, {onDelete: 'cascade'}),
    provider: vcsProviderEnum('provider').notNull(),
    providerHost: text('provider_host').notNull(),
    externalRepositoryId: text('external_repository_id').notNull(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull(),
    visibility: repositoryVisibilityEnum('visibility').notNull().default('unknown'),
    cloneUrl: text('clone_url').notNull(),
    htmlUrl: text('html_url').notNull(),
    metadataFetchedAt: timestamp('metadata_fetched_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('projects_repositories_connection_external_unique').on(
      table.vcsConnectionId,
      table.externalRepositoryId,
    ),
  ],
);

export type RepositoryDb = typeof repositories.$inferSelect;
export type RepositoryCreateDb = typeof repositories.$inferInsert;

export function toRepository(row: RepositoryDb): Repository {
  return {
    id: row.id,
    vcsConnectionId: row.vcsConnectionId,
    provider: row.provider as VcsProviderKind,
    providerHost: row.providerHost,
    externalRepositoryId: row.externalRepositoryId,
    owner: row.owner,
    name: row.name,
    fullName: row.fullName,
    defaultBranch: row.defaultBranch,
    visibility: row.visibility as RepositoryVisibility,
    cloneUrl: row.cloneUrl,
    htmlUrl: row.htmlUrl,
    metadataFetchedAt: row.metadataFetchedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
