import {
  JiraInstallationAlreadyLinkedError,
  JiraInstallationSiteMismatchError,
} from '#core/errors.js';
import {
  deleteJiraInstallationByConnectionId,
  getJiraInstallationByCloudId,
  getJiraInstallationByConnectionId,
  getJiraInstallationByWebhookId,
  markJiraInstallationRevoked,
  updateJiraInstallationTokenExpiry,
  updateJiraInstallationWebhook,
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
    const input = createInstallationInput();
    await upsertJiraInstallation(input);
    const tokenExpiresAt = new Date('2030-01-01T00:00:00.000Z');

    const updated = await updateJiraInstallationTokenExpiry({
      connectionId: input.connectionId,
      tokenExpiresAt,
      scopes: ['read:jira-work', 'write:jira-work'],
    });
    const deleted = await deleteJiraInstallationByConnectionId(input.connectionId);

    expect(updated).toMatchObject({tokenExpiresAt, scopes: ['read:jira-work', 'write:jira-work']});
    expect(deleted).toBe(true);
    await expect(getJiraInstallationByConnectionId(input.connectionId)).resolves.toBeUndefined();
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
