const {getInstallation} = vi.hoisted(() => ({getInstallation: vi.fn()}));

vi.mock('#db/installations.js', () => ({
  deleteJiraInstallationByConnectionId: vi.fn().mockResolvedValue(true),
  getJiraInstallationByConnectionId: getInstallation,
}));

import type {JiraInstallation} from '#db/installations.js';
import {deregisterJiraWebhooks, disconnectJiraInstallation} from './disconnect.js';

describe('disconnectJiraInstallation', () => {
  it('deletes secrets, installation, and connection when the connection exists', async () => {
    const deleteSecrets = vi.fn().mockResolvedValue(1);
    const deleteConnection = vi.fn().mockResolvedValue(true);
    const transaction = vi.fn(async (fn) => await fn({}));

    await disconnectJiraInstallation({
      connectionId: crypto.randomUUID(),
      getConnection: vi.fn().mockResolvedValue({workspaceId: crypto.randomUUID()}),
      deleteSecrets,
      transaction,
      deleteConnection,
    });

    expect(deleteSecrets).toHaveBeenCalledOnce();
    expect(deleteConnection).toHaveBeenCalledOnce();
  });

  it('deregisters webhooks before deletion and continues when the hook fails', async () => {
    const deleteSecrets = vi.fn().mockResolvedValue(1);
    const deleteConnection = vi.fn().mockResolvedValue(true);
    const deregisterWebhooks = vi.fn().mockRejectedValue(new Error('Jira unavailable'));
    const transaction = vi.fn(async (fn) => await fn({}));

    await disconnectJiraInstallation({
      connectionId: crypto.randomUUID(),
      getConnection: vi.fn().mockResolvedValue({workspaceId: crypto.randomUUID()}),
      deleteSecrets,
      deregisterWebhooks,
      transaction,
      deleteConnection,
    });

    expect(deregisterWebhooks).toHaveBeenCalledOnce();
    expect(deleteSecrets).toHaveBeenCalledOnce();
    expect(deleteConnection).toHaveBeenCalledOnce();
  });

  it('uses a fresh access token and the stored webhook ids for deregistration', async () => {
    const connectionId = crypto.randomUUID();
    const getAccessToken = vi.fn().mockResolvedValue('fresh-access-token');
    const deleteDynamicWebhooks = vi.fn().mockResolvedValue(undefined);

    await deregisterJiraWebhooks({
      connectionId,
      tokenStore: {getAccessToken},
      jira: {deleteDynamicWebhooks},
      getInstallation: vi.fn().mockResolvedValue({
        cloudId: 'cloud-1',
        webhookIds: [123, 456],
      } as JiraInstallation),
    });

    expect(getAccessToken).toHaveBeenCalledWith({connectionId, allowInactive: true});
    expect(deleteDynamicWebhooks).toHaveBeenCalledWith({
      accessToken: 'fresh-access-token',
      cloudId: 'cloud-1',
      webhookIds: [123, 456],
    });
  });

  it('uses the database installation lookup by default', async () => {
    const connectionId = crypto.randomUUID();
    const getAccessToken = vi.fn().mockResolvedValue('fresh-access-token');
    const deleteDynamicWebhooks = vi.fn().mockResolvedValue(undefined);
    getInstallation.mockResolvedValue({
      cloudId: 'cloud-1',
      webhookIds: [123],
    } as JiraInstallation);

    await deregisterJiraWebhooks({
      connectionId,
      tokenStore: {getAccessToken},
      jira: {deleteDynamicWebhooks},
    });

    expect(getInstallation).toHaveBeenCalledWith(connectionId);
    expect(deleteDynamicWebhooks).toHaveBeenCalledWith({
      accessToken: 'fresh-access-token',
      cloudId: 'cloud-1',
      webhookIds: [123],
    });
  });

  it.each([
    {name: 'the installation is gone', installation: undefined},
    {name: 'no webhook ids are stored', installation: {cloudId: 'cloud-1', webhookIds: []}},
  ])('skips deregistration and token minting when $name', async ({installation}) => {
    const getAccessToken = vi.fn();
    const deleteDynamicWebhooks = vi.fn();

    await deregisterJiraWebhooks({
      connectionId: crypto.randomUUID(),
      tokenStore: {getAccessToken},
      jira: {deleteDynamicWebhooks},
      getInstallation: vi.fn().mockResolvedValue(installation as JiraInstallation | undefined),
    });

    expect(getAccessToken).not.toHaveBeenCalled();
    expect(deleteDynamicWebhooks).not.toHaveBeenCalled();
  });

  it('swallows a rejected Jira deletion so the disconnect can proceed', async () => {
    const deleteDynamicWebhooks = vi.fn().mockRejectedValue(new Error('Jira unavailable'));

    await expect(
      deregisterJiraWebhooks({
        connectionId: crypto.randomUUID(),
        tokenStore: {getAccessToken: vi.fn().mockResolvedValue('fresh-access-token')},
        jira: {deleteDynamicWebhooks},
        getInstallation: vi.fn().mockResolvedValue({
          cloudId: 'cloud-1',
          webhookIds: [123],
        } as JiraInstallation),
      }),
    ).resolves.toBeUndefined();

    expect(deleteDynamicWebhooks).toHaveBeenCalledOnce();
  });
});
