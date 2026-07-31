import {index, integer, text, timestamp, uniqueIndex} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const workspacesRateLimits = pgTable(
  'rate_limits',
  {
    action: text('action').notNull(),
    scope: text('scope').notNull(),
    identifierHmac: text('identifier_hmac').notNull(),
    windowStart: timestamp('window_start', {withTimezone: true}).notNull(),
    count: integer('count').notNull().default(1),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspaces_rate_limits_window_unique').on(
      table.action,
      table.scope,
      table.identifierHmac,
      table.windowStart,
    ),
    index('workspaces_rate_limits_expires_at_idx').on(table.expiresAt),
  ],
);

export type WorkspaceRateLimitDb = typeof workspacesRateLimits.$inferSelect;
