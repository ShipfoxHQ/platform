import {Factory} from 'fishery';
import {type JiraInstallation, upsertJiraInstallation} from '#db/installations.js';

export const jiraInstallationFactory = Factory.define<JiraInstallation>(({sequence, onCreate}) => {
  onCreate((installation) =>
    upsertJiraInstallation({
      connectionId: installation.connectionId,
      cloudId: installation.cloudId,
      siteUrl: installation.siteUrl,
      siteName: installation.siteName,
      authorizingAccountId: installation.authorizingAccountId,
      scopes: installation.scopes,
      webhookIds: installation.webhookIds,
      webhookExpiresAt: installation.webhookExpiresAt,
      status: installation.status,
      tokenExpiresAt: installation.tokenExpiresAt,
      refreshTokenLastUsedAt: installation.refreshTokenLastUsedAt,
      refreshTokenLastAttemptedAt: installation.refreshTokenLastAttemptedAt,
    }),
  );

  return {
    id: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    cloudId: crypto.randomUUID(),
    siteUrl: 'https://acme.atlassian.net',
    siteName: 'Acme',
    authorizingAccountId: crypto.randomUUID(),
    scopes: ['read:jira-work'],
    webhookIds: [sequence + 1],
    webhookExpiresAt: null,
    status: 'installed',
    tokenExpiresAt: null,
    refreshTokenLastUsedAt: new Date(),
    refreshTokenLastAttemptedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
