import {isUniqueViolation} from '@shipfox/node-drizzle';
import {pgClient, withPostgresSession} from '@shipfox/node-postgres';
import {eq, sql} from 'drizzle-orm';
import {
  JiraConnectionAlreadyLinkedError,
  JiraInstallationAlreadyLinkedError,
  JiraInstallationSiteMismatchError,
} from '#core/errors.js';
import {db} from './db.js';
import {jiraInstallations, toJiraInstallation} from './schema/installations.js';

export type JiraInstallationLock = <T>(lockKey: string, fn: () => Promise<T>) => Promise<T>;

const JIRA_INSTALLATION_LOCK_RETRY_DELAY_MS = 100;
const JIRA_INSTALLATION_LOCK_MAX_RETRY_DELAY_MS = 1_000;
const JIRA_INSTALLATION_LOCK_TIMEOUT_MS = 30_000;

export async function withJiraInstallationLock<T>(lockKey: string, fn: () => Promise<T>) {
  const advisoryKey = `jira-installation:${lockKey}`;
  const deadline = Date.now() + JIRA_INSTALLATION_LOCK_TIMEOUT_MS;
  let retryDelayMs = JIRA_INSTALLATION_LOCK_RETRY_DELAY_MS;

  while (true) {
    const attempt = await withPostgresSession(async (client) => {
      const lock = await client.query<{acquired: boolean}>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [advisoryKey],
      );
      if (lock.rows[0]?.acquired !== true) return {acquired: false as const};

      try {
        return {acquired: true as const, value: await fn()};
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [advisoryKey]);
      }
    });

    if (attempt.acquired) return attempt.value;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Jira installation lock: ${lockKey}`);
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    retryDelayMs = Math.min(retryDelayMs * 2, JIRA_INSTALLATION_LOCK_MAX_RETRY_DELAY_MS);
  }
}

export type JiraInstallationStatus = 'installed' | 'revoked';

export interface JiraInstallation {
  id: string;
  connectionId: string;
  cloudId: string;
  siteUrl: string;
  siteName: string;
  authorizingAccountId: string;
  scopes: string[];
  webhookIds: number[];
  webhookExpiresAt: Date | null;
  status: JiraInstallationStatus;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertJiraInstallationParams {
  connectionId: string;
  cloudId: string;
  siteUrl: string;
  siteName: string;
  authorizingAccountId: string;
  scopes: string[];
  webhookIds?: number[] | undefined;
  webhookExpiresAt?: Date | null | undefined;
  status: JiraInstallationStatus;
  tokenExpiresAt?: Date | null | undefined;
}

export interface UpdateJiraInstallationTokenExpiryParams {
  connectionId: string;
  tokenExpiresAt: Date | null;
  scopes?: string[] | undefined;
}

export interface UpdateJiraInstallationWebhookParams {
  connectionId: string;
  webhookIds: number[];
  webhookExpiresAt: Date | null;
}

type JiraDb = ReturnType<typeof db>;
type JiraTx = Parameters<Parameters<JiraDb['transaction']>[0]>[0];

export async function upsertJiraInstallation(
  params: UpsertJiraInstallationParams,
  options: {tx?: unknown} = {},
): Promise<JiraInstallation> {
  const executor = (options.tx ?? db()) as JiraDb | JiraTx;
  const now = new Date();
  let row: typeof jiraInstallations.$inferSelect | undefined;
  try {
    [row] = await executor
      .insert(jiraInstallations)
      .values({
        connectionId: params.connectionId,
        cloudId: params.cloudId,
        siteUrl: params.siteUrl,
        siteName: params.siteName,
        authorizingAccountId: params.authorizingAccountId,
        scopes: params.scopes,
        webhookIds: params.webhookIds ?? [],
        webhookExpiresAt: params.webhookExpiresAt ?? null,
        status: params.status,
        tokenExpiresAt: params.tokenExpiresAt ?? null,
      })
      .onConflictDoUpdate({
        target: jiraInstallations.connectionId,
        setWhere: eq(jiraInstallations.cloudId, params.cloudId),
        set: {
          cloudId: params.cloudId,
          siteUrl: params.siteUrl,
          siteName: params.siteName,
          authorizingAccountId: params.authorizingAccountId,
          scopes: params.scopes,
          ...(params.webhookIds === undefined ? {} : {webhookIds: params.webhookIds}),
          ...(params.webhookExpiresAt === undefined
            ? {}
            : {webhookExpiresAt: params.webhookExpiresAt}),
          status: params.status,
          tokenExpiresAt: params.tokenExpiresAt ?? null,
          updatedAt: now,
        },
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error, 'integrations_jira_installations_connection_unique')) {
      throw new JiraConnectionAlreadyLinkedError(params.connectionId);
    }
    if (isUniqueViolation(error, 'integrations_jira_installations_cloud_id_unique')) {
      throw new JiraInstallationAlreadyLinkedError(params.cloudId);
    }
    throw error;
  }

  if (!row) throw new JiraInstallationSiteMismatchError(params.connectionId, params.cloudId);
  return toJiraInstallation(row);
}

export async function getJiraInstallationByCloudId(
  cloudId: string,
  options: {tx?: unknown} = {},
): Promise<JiraInstallation | undefined> {
  const executor = (options.tx ?? db()) as JiraDb | JiraTx;
  const rows = await executor
    .select()
    .from(jiraInstallations)
    .where(eq(jiraInstallations.cloudId, cloudId))
    .limit(1);
  const row = rows[0];
  return row ? toJiraInstallation(row) : undefined;
}

export async function updateJiraInstallationTokenExpiry(
  params: UpdateJiraInstallationTokenExpiryParams,
  options: {tx?: unknown} = {},
): Promise<JiraInstallation | undefined> {
  const executor = (options.tx ?? db()) as JiraDb | JiraTx;
  const [row] = await executor
    .update(jiraInstallations)
    .set({
      tokenExpiresAt: params.tokenExpiresAt,
      ...(params.scopes === undefined ? {} : {scopes: params.scopes}),
      updatedAt: new Date(),
    })
    .where(eq(jiraInstallations.connectionId, params.connectionId))
    .returning();
  return row ? toJiraInstallation(row) : undefined;
}

export async function updateJiraInstallationWebhook(
  params: UpdateJiraInstallationWebhookParams,
  options: {tx?: unknown} = {},
): Promise<JiraInstallation | undefined> {
  const executor = (options.tx ?? db()) as JiraDb | JiraTx;
  const [row] = await executor
    .update(jiraInstallations)
    .set({
      webhookIds: params.webhookIds,
      webhookExpiresAt: params.webhookExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(jiraInstallations.connectionId, params.connectionId))
    .returning();
  return row ? toJiraInstallation(row) : undefined;
}

export async function deleteJiraInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<boolean> {
  const executor = (options.tx ?? db()) as JiraDb | JiraTx;
  const result = await executor
    .delete(jiraInstallations)
    .where(eq(jiraInstallations.connectionId, connectionId));
  return (result.rowCount ?? 0) > 0;
}

export type JiraRefreshLockResult<T> = {acquired: true; value: T} | {acquired: false};

export function withJiraRefreshLock<T>(
  connectionId: string,
  fn: () => Promise<T>,
): Promise<JiraRefreshLockResult<T>> {
  return withJiraRefreshLockClient(connectionId, fn);
}

export function withJiraWebhookRegistrationLock<T>(
  lockKey: string,
  fn: (tx?: unknown) => Promise<T>,
): Promise<T> {
  return withJiraInstallationLock(lockKey, () => fn());
}

async function withJiraRefreshLockClient<T>(
  connectionId: string,
  fn: () => Promise<T>,
): Promise<JiraRefreshLockResult<T>> {
  const client = await pgClient().connect();
  let acquired = false;
  try {
    const lock = await client.query<{acquired: boolean}>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [connectionId],
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) return {acquired: false};
    return {acquired: true, value: await fn()};
  } finally {
    try {
      if (acquired) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [connectionId]);
    } finally {
      client.release();
    }
  }
}

export async function getJiraInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<JiraInstallation | undefined> {
  const executor = (options.tx ?? db()) as JiraDb | JiraTx;
  const rows = await executor
    .select()
    .from(jiraInstallations)
    .where(eq(jiraInstallations.connectionId, connectionId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toJiraInstallation(row);
}

export async function getJiraInstallationByWebhookId(
  webhookId: number,
  options: {tx?: unknown} = {},
): Promise<JiraInstallation | undefined> {
  const executor = (options.tx ?? db()) as JiraDb | JiraTx;
  const rows = await executor
    .select()
    .from(jiraInstallations)
    .where(sql`${jiraInstallations.webhookIds} @> ${JSON.stringify([webhookId])}::jsonb`)
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toJiraInstallation(row);
}

export async function markJiraInstallationRevoked(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<JiraInstallation | undefined> {
  const executor = (options.tx ?? db()) as JiraDb | JiraTx;
  const [row] = await executor
    .update(jiraInstallations)
    .set({status: 'revoked', updatedAt: new Date()})
    .where(eq(jiraInstallations.connectionId, connectionId))
    .returning();
  if (!row) return undefined;
  return toJiraInstallation(row);
}
