import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, pgEnum, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {
  AgentAuthorizationCode,
  AgentAuthorizationRequest,
  AgentClient,
  AgentClientKind,
  AgentGrant,
  AgentPersonalAccessToken,
  AgentRefreshToken,
} from '#core/entities/agent-access.js';
import {pgTable} from './common.js';
import {users} from './users.js';

export const agentClientKindEnum = pgEnum('auth_agent_client_kind', ['registered', 'cimd']);

export const agentClients = pgTable(
  'agent_clients',
  {
    id: uuidv7PrimaryKey(),
    clientId: text('client_id').notNull(),
    name: text('name').notNull(),
    redirectUris: text('redirect_uris').array().notNull(),
    kind: agentClientKindEnum('kind').notNull(),
    lastSeenAt: timestamp('last_seen_at', {withTimezone: true}),
    unreferencedAt: timestamp('unreferenced_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_agent_clients_client_id_unique').on(table.clientId),
    index('auth_agent_clients_unreferenced_at_idx').on(table.unreferencedAt),
    index('auth_agent_clients_created_at_idx').on(table.createdAt),
  ],
);

export const agentAuthorizationRequests = pgTable(
  'agent_authorization_requests',
  {
    id: uuidv7PrimaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => agentClients.id, {onDelete: 'cascade'}),
    redirectUri: text('redirect_uri').notNull(),
    resource: text('resource').notNull(),
    scopes: text('scopes').array().notNull(),
    codeChallenge: text('code_challenge').notNull(),
    state: text('state').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    consumedAt: timestamp('consumed_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('auth_agent_authorization_requests_client_id_idx').on(table.clientId),
    index('auth_agent_authorization_requests_expires_at_idx').on(table.expiresAt),
  ],
);

export const agentGrants = pgTable(
  'agent_grants',
  {
    id: uuidv7PrimaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    workspaceId: uuid('workspace_id').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => agentClients.id, {onDelete: 'cascade'}),
    scopes: text('scopes').array().notNull(),
    lastUsedAt: timestamp('last_used_at', {withTimezone: true}),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    terminalAt: timestamp('terminal_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('auth_agent_grants_user_id_idx').on(table.userId),
    index('auth_agent_grants_workspace_id_idx').on(table.workspaceId),
    index('auth_agent_grants_client_id_idx').on(table.clientId),
    index('auth_agent_grants_terminal_at_idx').on(table.terminalAt),
  ],
);

export const agentAuthorizationCodes = pgTable(
  'agent_authorization_codes',
  {
    id: uuidv7PrimaryKey(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => agentGrants.id, {onDelete: 'cascade'}),
    hashedCode: text('hashed_code').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    resource: text('resource').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    consumedAt: timestamp('consumed_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_agent_authorization_codes_hashed_code_unique').on(table.hashedCode),
    index('auth_agent_authorization_codes_grant_id_idx').on(table.grantId),
    index('auth_agent_authorization_codes_expires_at_idx').on(table.expiresAt),
  ],
);

export const agentRefreshTokens = pgTable(
  'agent_refresh_tokens',
  {
    id: uuidv7PrimaryKey(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => agentGrants.id, {onDelete: 'cascade'}),
    hashedToken: text('hashed_token').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    rotatedAt: timestamp('rotated_at', {withTimezone: true}),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    lastUsedAt: timestamp('last_used_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_agent_refresh_tokens_hashed_token_unique').on(table.hashedToken),
    uniqueIndex('auth_agent_refresh_tokens_live_grant_unique')
      .on(table.grantId)
      .where(sql`${table.rotatedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    index('auth_agent_refresh_tokens_grant_id_idx').on(table.grantId),
    index('auth_agent_refresh_tokens_expires_at_idx').on(table.expiresAt),
    index('auth_agent_refresh_tokens_rotated_at_idx').on(table.rotatedAt),
    index('auth_agent_refresh_tokens_revoked_at_idx').on(table.revokedAt),
  ],
);

export const agentPersonalAccessTokens = pgTable(
  'agent_pats',
  {
    id: uuidv7PrimaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    workspaceId: uuid('workspace_id').notNull(),
    hashedToken: text('hashed_token').notNull(),
    prefix: text('prefix').notNull(),
    name: text('name').notNull(),
    scopes: text('scopes').array().notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    lastUsedAt: timestamp('last_used_at', {withTimezone: true}),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_agent_pats_hashed_token_unique').on(table.hashedToken),
    index('auth_agent_pats_user_id_idx').on(table.userId),
    index('auth_agent_pats_workspace_id_idx').on(table.workspaceId),
    index('auth_agent_pats_expires_at_idx').on(table.expiresAt),
    index('auth_agent_pats_revoked_at_idx').on(table.revokedAt),
  ],
);

export type AgentClientDb = typeof agentClients.$inferSelect;
export type AgentClientCreateDb = typeof agentClients.$inferInsert;
export type AgentAuthorizationRequestDb = typeof agentAuthorizationRequests.$inferSelect;
export type AgentAuthorizationRequestCreateDb = typeof agentAuthorizationRequests.$inferInsert;
export type AgentGrantDb = typeof agentGrants.$inferSelect;
export type AgentGrantCreateDb = typeof agentGrants.$inferInsert;
export type AgentAuthorizationCodeDb = typeof agentAuthorizationCodes.$inferSelect;
export type AgentAuthorizationCodeCreateDb = typeof agentAuthorizationCodes.$inferInsert;
export type AgentRefreshTokenDb = typeof agentRefreshTokens.$inferSelect;
export type AgentRefreshTokenCreateDb = typeof agentRefreshTokens.$inferInsert;
export type AgentPersonalAccessTokenDb = typeof agentPersonalAccessTokens.$inferSelect;
export type AgentPersonalAccessTokenCreateDb = typeof agentPersonalAccessTokens.$inferInsert;

export function toAgentClient(row: AgentClientDb): AgentClient {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    redirectUris: row.redirectUris,
    kind: row.kind as AgentClientKind,
    lastSeenAt: row.lastSeenAt,
    unreferencedAt: row.unreferencedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toAgentAuthorizationRequest(
  row: AgentAuthorizationRequestDb,
): AgentAuthorizationRequest {
  return {
    id: row.id,
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    resource: row.resource,
    scopes: row.scopes,
    codeChallenge: row.codeChallenge,
    state: row.state,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toAgentGrant(row: AgentGrantDb): AgentGrant {
  return {
    id: row.id,
    userId: row.userId,
    workspaceId: row.workspaceId,
    clientId: row.clientId,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    terminalAt: row.terminalAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toAgentAuthorizationCode(row: AgentAuthorizationCodeDb): AgentAuthorizationCode {
  return {
    id: row.id,
    grantId: row.grantId,
    hashedCode: row.hashedCode,
    codeChallenge: row.codeChallenge,
    redirectUri: row.redirectUri,
    resource: row.resource,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toAgentRefreshToken(row: AgentRefreshTokenDb): AgentRefreshToken {
  return {
    id: row.id,
    grantId: row.grantId,
    hashedToken: row.hashedToken,
    expiresAt: row.expiresAt,
    rotatedAt: row.rotatedAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toAgentPersonalAccessToken(
  row: AgentPersonalAccessTokenDb,
): AgentPersonalAccessToken {
  return {
    id: row.id,
    userId: row.userId,
    workspaceId: row.workspaceId,
    hashedToken: row.hashedToken,
    prefix: row.prefix,
    name: row.name,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
