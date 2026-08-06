import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {createTestApp, sourceProvider, useIntegrationRouteTest} from '#test/route-utils.js';

describe('PATCH /integration-connections/:connectionId', () => {
  const context = useIntegrationRouteTest();

  it('updates a connection lifecycle status', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'disabled'},
    });

    const reloaded = await getIntegrationConnectionById(connection.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().lifecycle_status).toBe('disabled');
    expect(res.json().capabilities).toEqual(['source_control']);
    expect(reloaded?.lifecycleStatus).toBe('disabled');
  });

  it('returns not-found for a missing connection', async () => {
    const app = await createTestApp([sourceProvider()]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/integration-connections/${crypto.randomUUID()}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'disabled'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  it('rejects system-owned lifecycle statuses', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'error'},
    });

    const reloaded = await getIntegrationConnectionById(connection.id);
    expect(res.statusCode).toBe(400);
    expect(reloaded?.lifecycleStatus).toBe('active');
  });

  it('returns membership errors', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: crypto.randomUUID(),
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'disabled'},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });
});

describe('DELETE /integration-connections/:connectionId', () => {
  const context = useIntegrationRouteTest();

  it('deletes a connection', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    const reloaded = await getIntegrationConnectionById(connection.id);
    expect(res.statusCode).toBe(204);
    expect(reloaded).toBeUndefined();
  });

  it('runs provider cleanup hooks while retaining ownership of the core row', async () => {
    const deleteConnectionRemoteResources = vi.fn(() => Promise.resolve(undefined));
    const deleteConnectionRecords = vi.fn(() => Promise.resolve());
    const deleteConnectionSecrets = vi.fn(() => Promise.resolve());
    const app = await createTestApp([
      sourceProvider({
        provider: 'slack',
        displayName: 'Slack',
        adapters: {},
        deleteConnectionRemoteResources,
        deleteConnectionRecords,
        deleteConnectionSecrets,
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    expect(deleteConnectionRemoteResources).toHaveBeenCalledWith(connection);
    expect(deleteConnectionRecords).toHaveBeenCalledWith(connection, {
      tx: expect.anything(),
    });
    expect(deleteConnectionSecrets).toHaveBeenCalledWith(connection);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
  });

  it('runs prepared remote cleanup after the local deletion commits', async () => {
    const events: string[] = [];
    const deleteConnectionRemoteResources = vi.fn(() => {
      events.push('prepare');
      return Promise.resolve(async () => {
        events.push('remote');
        await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
      });
    });
    const deleteConnectionRecords = vi.fn(() => {
      events.push('records');
      return Promise.resolve();
    });
    const deleteConnectionSecrets = vi.fn(() => {
      events.push('secrets');
      return Promise.resolve();
    });
    const app = await createTestApp([
      sourceProvider({
        provider: 'slack',
        displayName: 'Slack',
        adapters: {},
        deleteConnectionRemoteResources,
        deleteConnectionRecords,
        deleteConnectionSecrets,
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    expect(events).toEqual(['prepare', 'records', 'remote', 'secrets']);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
  });

  it('keeps the connection when provider record cleanup fails', async () => {
    const deleteConnectionSecrets = vi.fn(() => Promise.resolve());
    const app = await createTestApp([
      sourceProvider({
        provider: 'slack',
        displayName: 'Slack',
        adapters: {},
        deleteConnectionRecords: () => Promise.reject(new Error('record cleanup failed')),
        deleteConnectionSecrets,
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(500);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toMatchObject({
      id: connection.id,
    });
    expect(deleteConnectionSecrets).not.toHaveBeenCalled();
  });

  it('continues connection deletion when remote cleanup fails', async () => {
    const deleteConnectionRemoteResources = vi.fn(() =>
      Promise.reject(new Error('remote cleanup failed')),
    );
    const app = await createTestApp([
      sourceProvider({
        provider: 'slack',
        displayName: 'Slack',
        adapters: {},
        deleteConnectionRemoteResources,
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    expect(deleteConnectionRemoteResources).toHaveBeenCalledWith(connection);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
  });

  it('deletes the connection when provider secret cleanup fails after commit', async () => {
    const app = await createTestApp([
      sourceProvider({
        provider: 'slack',
        displayName: 'Slack',
        adapters: {},
        deleteConnectionSecrets: () => Promise.reject(new Error('secret cleanup failed')),
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
  });

  it('deletes an unregistered provider connection without provider cleanup', async () => {
    const app = await createTestApp([]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
  });

  it('returns not-found for a missing connection', async () => {
    const app = await createTestApp([sourceProvider()]);

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${crypto.randomUUID()}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });
});
