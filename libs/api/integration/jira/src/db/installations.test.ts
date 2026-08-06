import {
  JiraInstallationAlreadyLinkedError,
  JiraInstallationSiteMismatchError,
} from '#core/errors.js';
import {
  deleteJiraInstallationByConnectionId,
  getJiraInstallationByCloudId,
  getJiraInstallationByConnectionId,
  getJiraInstallationByWebhookId,
  listJiraInstallationsDueForTokenRefresh,
  listJiraInstallationsDueForWebhookRenewal,
  markJiraInstallationRevoked,
  markJiraInstallationTokenRefreshAttempt,
  updateJiraInstallationTokenExpiry,
  updateJiraInstallationWebhook,
  updateJiraInstallationWebhookIfUnchanged,
  upsertJiraInstallation,
  withJiraWebhookRegistrationLock,
} from './installations.js';

function createInstallationInput(
  overrides: Partial<Parameters<typeof upsertJiraInstallation>[0]> = {},
) {
  return {
    connectionId: crypto.randomUUID(),
    cloudId: crypto.randomUUID(),
    siteUrl: 'https://acme.atlassian.net',
    siteName: 'Acme',
    authorizingAccountId: crypto.randomUUID(),
    scopes: ['read:jira-work'],
    webhookIds: [Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)],
    status: 'installed' as const,
    ...overrides,
  };
}

describe('jira installations', () => {
  it('inserts an installation and reads it by connection and webhook id', async () => {
    const webhookId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const input = createInstallationInput({webhookIds: [webhookId]});

    const installation = await upsertJiraInstallation(input);
    const byConnection = await getJiraInstallationByConnectionId(input.connectionId);
    const byWebhook = await getJiraInstallationByWebhookId(webhookId);

    expect(byConnection).toEqual(installation);
    expect(byWebhook).toEqual(installation);
  });

  it('updates mutable metadata for the same connection and Jira site', async () => {
    const input = createInstallationInput();
    await upsertJiraInstallation(input);

    const result = await upsertJiraInstallation({
      ...input,
      siteUrl: 'https://renamed.atlassian.net',
      siteName: 'Acme renamed',
      authorizingAccountId: crypto.randomUUID(),
      scopes: ['read:jira-work', 'write:jira-work'],
      webhookIds: [123],
    });

    expect(result).toMatchObject({
      siteUrl: 'https://renamed.atlassian.net',
      siteName: 'Acme renamed',
      scopes: ['read:jira-work', 'write:jira-work'],
      webhookIds: [123],
    });
  });

  it('preserves webhook metadata when reconnect upsert omits it', async () => {
    const webhookExpiresAt = new Date('2030-01-01T00:00:00.000Z');
    const input = createInstallationInput({webhookIds: [321], webhookExpiresAt});
    await upsertJiraInstallation(input);

    const result = await upsertJiraInstallation({
      ...input,
      scopes: ['read:jira-work', 'write:jira-work'],
      webhookIds: undefined,
      webhookExpiresAt: undefined,
    });

    expect(result.webhookIds).toEqual([321]);
    expect(result.webhookExpiresAt).toEqual(webhookExpiresAt);
  });

  it('replaces webhook ids and expiry together after registration', async () => {
    const input = createInstallationInput({webhookIds: [321]});
    await upsertJiraInstallation(input);
    const webhookExpiresAt = new Date('2030-02-01T00:00:00.000Z');

    const result = await updateJiraInstallationWebhook({
      connectionId: input.connectionId,
      webhookIds: [654],
      webhookExpiresAt,
    });

    expect(result).toMatchObject({webhookIds: [654], webhookExpiresAt});
  });

  it('only updates webhook metadata when the refreshed ids are still current', async () => {
    const input = createInstallationInput({webhookIds: [123], webhookExpiresAt: new Date()});
    await upsertJiraInstallation(input);

    await expect(
      updateJiraInstallationWebhookIfUnchanged({
        connectionId: input.connectionId,
        expectedWebhookIds: [456],
        webhookIds: [789],
        webhookExpiresAt: new Date('2026-08-31T00:00:00.000Z'),
      }),
    ).resolves.toBeUndefined();
    await expect(getJiraInstallationByConnectionId(input.connectionId)).resolves.toMatchObject({
      webhookIds: [123],
    });

    await expect(
      updateJiraInstallationWebhookIfUnchanged({
        connectionId: input.connectionId,
        expectedWebhookIds: [123],
        webhookIds: [789],
        webhookExpiresAt: new Date('2026-08-31T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({webhookIds: [789]});
  });

  it('refuses to repoint a connection to a different Jira site', async () => {
    const first = createInstallationInput();
    await upsertJiraInstallation(first);
    const second = createInstallationInput({connectionId: first.connectionId});

    const result = upsertJiraInstallation(second);

    await expect(result).rejects.toBeInstanceOf(JiraInstallationSiteMismatchError);
    await expect(getJiraInstallationByConnectionId(first.connectionId)).resolves.toMatchObject({
      cloudId: first.cloudId,
    });
  });

  it('refuses to link the same Jira site to a second connection', async () => {
    const first = createInstallationInput();
    await upsertJiraInstallation(first);
    const second = createInstallationInput({cloudId: first.cloudId});

    const result = upsertJiraInstallation(second);

    await expect(result).rejects.toBeInstanceOf(JiraInstallationAlreadyLinkedError);
    await expect(getJiraInstallationByCloudId(first.cloudId)).resolves.toMatchObject({
      connectionId: first.connectionId,
    });
  });

  it('updates token metadata and deletes an installation', async () => {
    const input = createInstallationInput({
      refreshTokenLastUsedAt: new Date('2020-01-01T00:00:00.000Z'),
      refreshTokenLastAttemptedAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    const initial = await upsertJiraInstallation(input);
    const tokenExpiresAt = new Date('2030-01-01T00:00:00.000Z');

    const attempted = await markJiraInstallationTokenRefreshAttempt(input.connectionId);

    expect(attempted?.refreshTokenLastAttemptedAt.getTime()).toBeGreaterThan(
      initial.refreshTokenLastAttemptedAt.getTime(),
    );

    const updated = await updateJiraInstallationTokenExpiry({
      connectionId: input.connectionId,
      tokenExpiresAt,
      scopes: ['read:jira-work', 'write:jira-work'],
    });
    const deleted = await deleteJiraInstallationByConnectionId(input.connectionId);

    expect(updated).toMatchObject({tokenExpiresAt, scopes: ['read:jira-work', 'write:jira-work']});
    expect(updated?.refreshTokenLastUsedAt.getTime()).toBeGreaterThan(
      initial.refreshTokenLastUsedAt.getTime(),
    );
    expect(deleted).toBe(true);
    await expect(getJiraInstallationByConnectionId(input.connectionId)).resolves.toBeUndefined();
  });

  it('lists only installed installations whose refresh tokens are nearing idle expiry', async () => {
    const due = createInstallationInput({
      refreshTokenLastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const fresh = createInstallationInput({
      refreshTokenLastUsedAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    const boundary = createInstallationInput({
      refreshTokenLastUsedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    const revoked = createInstallationInput({
      refreshTokenLastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
      status: 'revoked',
    });
    await upsertJiraInstallation(due);
    await upsertJiraInstallation(fresh);
    await upsertJiraInstallation(boundary);
    await upsertJiraInstallation(revoked);

    const result = await listJiraInstallationsDueForTokenRefresh({
      before: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(result.map((installation) => installation.connectionId)).toContain(due.connectionId);
    expect(result.map((installation) => installation.connectionId)).toContain(
      boundary.connectionId,
    );
    expect(result.map((installation) => installation.connectionId)).not.toContain(
      fresh.connectionId,
    );
    expect(result.map((installation) => installation.connectionId)).not.toContain(
      revoked.connectionId,
    );
  });

  it('lists only installed installations whose webhooks are nearing expiry', async () => {
    const due = createInstallationInput({
      webhookExpiresAt: new Date('2026-08-05T00:00:00.000Z'),
    });
    const fresh = createInstallationInput({
      webhookExpiresAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    const missingExpiry = createInstallationInput({webhookExpiresAt: null});
    const revoked = createInstallationInput({
      webhookExpiresAt: new Date('2026-08-05T00:00:00.000Z'),
      status: 'revoked',
    });
    await upsertJiraInstallation(due);
    await upsertJiraInstallation(fresh);
    await upsertJiraInstallation(missingExpiry);
    await upsertJiraInstallation(revoked);

    const result = await listJiraInstallationsDueForWebhookRenewal({
      before: new Date('2026-08-07T00:00:00.000Z'),
    });

    expect(result.map((installation) => installation.connectionId)).toContain(due.connectionId);
    expect(result.map((installation) => installation.connectionId)).not.toContain(
      fresh.connectionId,
    );
    expect(result.map((installation) => installation.connectionId)).not.toContain(
      missingExpiry.connectionId,
    );
    expect(result.map((installation) => installation.connectionId)).not.toContain(
      revoked.connectionId,
    );
  });

  it('orders due installations by their latest refresh attempt', async () => {
    const refreshTokenLastUsedAt = new Date('1970-01-01T00:00:00.000Z');
    const attemptBase = Date.now();
    const latestAttempt = createInstallationInput({
      refreshTokenLastUsedAt,
      refreshTokenLastAttemptedAt: new Date(attemptBase + 3_000),
    });
    const middleAttempt = createInstallationInput({
      refreshTokenLastUsedAt,
      refreshTokenLastAttemptedAt: new Date(attemptBase + 2_000),
    });
    const oldestAttempt = createInstallationInput({
      refreshTokenLastUsedAt,
      refreshTokenLastAttemptedAt: new Date(attemptBase + 1_000),
    });
    await upsertJiraInstallation(latestAttempt);
    await upsertJiraInstallation(middleAttempt);
    await upsertJiraInstallation(oldestAttempt);

    const result = await listJiraInstallationsDueForTokenRefresh({
      before: new Date('2000-01-01T00:00:00.000Z'),
      limit: 1_000,
    });
    const connectionIds = result.map((installation) => installation.connectionId);

    expect(connectionIds.indexOf(oldestAttempt.connectionId)).toBeLessThan(
      connectionIds.indexOf(middleAttempt.connectionId),
    );
    expect(connectionIds.indexOf(middleAttempt.connectionId)).toBeLessThan(
      connectionIds.indexOf(latestAttempt.connectionId),
    );
  });

  it('returns undefined for unknown connection and webhook ids', async () => {
    const connectionId = crypto.randomUUID();
    const webhookId = Number.MAX_SAFE_INTEGER;

    const byConnection = await getJiraInstallationByConnectionId(connectionId);
    const byWebhook = await getJiraInstallationByWebhookId(webhookId);

    expect(byConnection).toBeUndefined();
    expect(byWebhook).toBeUndefined();
  });

  it('marks an installation revoked and returns undefined for an unknown connection', async () => {
    const input = createInstallationInput();
    await upsertJiraInstallation(input);

    const revoked = await markJiraInstallationRevoked(input.connectionId);
    const missing = await markJiraInstallationRevoked(crypto.randomUUID());

    expect(revoked?.status).toBe('revoked');
    expect(missing).toBeUndefined();
  });

  it('serializes webhook registration lock contenders for one connection', async () => {
    const connectionId = crypto.randomUUID();
    let releaseFirst!: () => void;
    let firstEntered!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withJiraWebhookRegistrationLock(connectionId, async () => {
      firstEntered();
      await firstRelease;
      return 'first';
    });
    await firstReady;

    let secondFinished = false;
    const second = withJiraWebhookRegistrationLock(connectionId, () => {
      secondFinished = true;
      return Promise.resolve('second');
    });
    await Promise.resolve();
    expect(secondFinished).toBe(false);

    releaseFirst();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(secondFinished).toBe(true);
  });
});
