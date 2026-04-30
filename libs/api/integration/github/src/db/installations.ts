import {eq} from 'drizzle-orm';
import {db} from './db.js';
import {githubInstallations, toGithubInstallation} from './schema/installations.js';

export interface GithubInstallation {
  id: string;
  connectionId: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  suspendedAt: Date | null;
  deletedAt: Date | null;
  latestEvent: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertGithubInstallationParams {
  connectionId: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  suspendedAt?: Date | null | undefined;
  deletedAt?: Date | null | undefined;
  latestEvent: Record<string, unknown>;
}

type GithubDb = ReturnType<typeof db>;
type GithubTx = Parameters<Parameters<GithubDb['transaction']>[0]>[0];

export async function upsertGithubInstallation(
  params: UpsertGithubInstallationParams,
  options: {tx?: unknown} = {},
): Promise<GithubInstallation> {
  const executor = (options.tx ?? db()) as GithubDb | GithubTx;
  const now = new Date();
  const [row] = await executor
    .insert(githubInstallations)
    .values({
      connectionId: params.connectionId,
      installationId: params.installationId,
      accountLogin: params.accountLogin,
      accountType: params.accountType,
      repositorySelection: params.repositorySelection,
      suspendedAt: params.suspendedAt ?? null,
      deletedAt: params.deletedAt ?? null,
      latestEvent: params.latestEvent,
    })
    .onConflictDoUpdate({
      target: githubInstallations.connectionId,
      set: {
        installationId: params.installationId,
        accountLogin: params.accountLogin,
        accountType: params.accountType,
        repositorySelection: params.repositorySelection,
        suspendedAt: params.suspendedAt ?? null,
        deletedAt: params.deletedAt ?? null,
        latestEvent: params.latestEvent,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new Error('GitHub installation upsert returned no rows');
  return toGithubInstallation(row);
}

export async function getGithubInstallationByConnectionId(
  connectionId: string,
): Promise<GithubInstallation | undefined> {
  const rows = await db()
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.connectionId, connectionId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toGithubInstallation(row);
}
