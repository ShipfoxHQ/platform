import {
  CONNECTION_REPOSITORY_ACCESS_CHANGED,
  CONNECTION_REPOSITORY_GRANTED,
  CONNECTION_REPOSITORY_REVOKED,
} from '@shipfox/api-integration-core-dto';
import {vi} from '@shipfox/vitest/vi';
import {sql} from 'drizzle-orm';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {
  getIntegrationConnectionRepositoryGrant,
  listIntegrationConnectionRepositoryGrants,
  upsertIntegrationConnectionRepositoryGrant,
} from '#db/repository-grants.js';
import {integrationsOutbox} from '#db/schema/outbox.js';
import {createTestApp, sourceProvider, useIntegrationRouteTest} from '#test/route-utils.js';

describe('repository access mutation routes', () => {
  const context = useIntegrationRouteTest();

  it('updates the repository access mode idempotently and audits the acting user', async () => {
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})]);
    const connection = await createConnection();

    const first = await app.inject({
      method: 'PUT',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
      payload: {mode: 'all'},
    });
    const afterFirst = await getIntegrationConnectionById(connection.id);
    const repeated = await app.inject({
      method: 'PUT',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
      payload: {mode: 'all'},
    });

    const events = await auditEvents(CONNECTION_REPOSITORY_ACCESS_CHANGED, connection.id);
    const reloaded = await getIntegrationConnectionById(connection.id);

    expect(first.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(200);
    expect(first.json()).toEqual({mode: 'all'});
    expect(repeated.json()).toEqual({mode: 'all'});
    expect(reloaded?.repositoryAccessMode).toBe('all');
    expect(reloaded?.updatedAt).toEqual(afterFirst?.updatedAt);
    expect(events).toHaveLength(2);
    expect(events[0]?.payload).toMatchObject({
      actorId: 'user-1',
      workspaceId: context.workspaceId,
      connectionId: connection.id,
      provider: 'gitea',
      mode: 'all',
    });
  });

  it('upserts a provider-namespaced manual grant without provider calls', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const sourceControl = provider.adapters?.source_control;
    if (!sourceControl) throw new Error('Expected source-control adapter');
    const listRepositories = vi.spyOn(sourceControl, 'listRepositories');
    const app = await createTestApp([provider]);
    const connection = await createConnection();
    const payload = {
      external_repository_id: 'gitea:gitea-owner/platform',
      owner: 'gitea-owner',
      name: 'platform',
    };

    const first = await app.inject({
      method: 'POST',
      url: `/integration-connections/${connection.id}/repository-grants`,
      headers: {authorization: 'Bearer user'},
      payload,
    });
    const repeated = await app.inject({
      method: 'POST',
      url: `/integration-connections/${connection.id}/repository-grants`,
      headers: {authorization: 'Bearer user'},
      payload,
    });

    const grants = await listIntegrationConnectionRepositoryGrants({connectionId: connection.id});
    const events = await auditEvents(CONNECTION_REPOSITORY_GRANTED, connection.id);

    expect(first.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      connection_id: connection.id,
      workspace_id: context.workspaceId,
      external_repository_id: payload.external_repository_id,
      owner: payload.owner,
      name: payload.name,
    });
    expect(repeated.json()).toEqual(first.json());
    expect(grants).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      actorId: 'user-1',
      grantId: first.json().id,
      externalRepositoryId: payload.external_repository_id,
      repositoryOwner: payload.owner,
      repositoryName: payload.name,
    });
    expect(listRepositories).not.toHaveBeenCalled();
  });

  it('revokes only a grant belonging to the addressed connection', async () => {
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})]);
    const firstConnection = await createConnection('gitea_first');
    const secondConnection = await createConnection('gitea_second');
    const grant = await createGrant(firstConnection.id);

    const wrongConnection = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${secondConnection.id}/repository-grants/${grant.id}`,
      headers: {authorization: 'Bearer user'},
    });
    const revoked = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${firstConnection.id}/repository-grants/${grant.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(wrongConnection.statusCode).toBe(404);
    await expect(
      getIntegrationConnectionRepositoryGrant({
        connectionId: firstConnection.id,
        externalRepositoryId: 'gitea:gitea-owner/platform',
      }),
    ).resolves.toBeUndefined();
    expect(revoked.statusCode).toBe(204);
    expect(await auditEvents(CONNECTION_REPOSITORY_REVOKED, firstConnection.id)).toHaveLength(1);
  });

  it('rejects unsupported providers before changing repository state', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await createConnection();

    const response = await app.inject({
      method: 'POST',
      url: `/integration-connections/${connection.id}/repository-grants`,
      headers: {authorization: 'Bearer user'},
      payload: {
        external_repository_id: 'gitea:gitea-owner/platform',
        owner: 'gitea-owner',
        name: 'platform',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('integration-repository-access-unsupported');
    await expect(
      listIntegrationConnectionRepositoryGrants({connectionId: connection.id}),
    ).resolves.toEqual([]);
  });

  it('rejects impersonated sessions before creating a durable grant', async () => {
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})]);
    const connection = await createConnection();

    const response = await app.inject({
      method: 'POST',
      url: `/integration-connections/${connection.id}/repository-grants`,
      headers: {authorization: 'Bearer impersonated'},
      payload: {
        external_repository_id: 'gitea:gitea-owner/platform',
        owner: 'gitea-owner',
        name: 'platform',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('impersonation-not-permitted');
    await expect(
      listIntegrationConnectionRepositoryGrants({connectionId: connection.id}),
    ).resolves.toEqual([]);
  });

  it('rejects invalid provider ids and repository coordinates locally', async () => {
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})]);
    const connection = await createConnection();
    const headers = {authorization: 'Bearer user'};
    const url = `/integration-connections/${connection.id}/repository-grants`;

    const wrongProvider = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: {
        external_repository_id: 'github:42',
        owner: 'gitea-owner',
        name: 'platform',
      },
    });
    const invalidOwner = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: {
        external_repository_id: 'gitea:42',
        owner: 'gitea-owner/platform',
        name: 'platform',
      },
    });

    expect(wrongProvider.statusCode).toBe(400);
    expect(wrongProvider.json().code).toBe('invalid-repository');
    expect(invalidOwner.statusCode).toBe(400);
    await expect(
      listIntegrationConnectionRepositoryGrants({connectionId: connection.id}),
    ).resolves.toEqual([]);
  });

  async function createConnection(slug = `gitea_${crypto.randomUUID()}`) {
    return await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: crypto.randomUUID(),
      slug,
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });
  }

  async function createGrant(connectionId: string) {
    const grant = await upsertIntegrationConnectionRepositoryGrant({
      connectionId,
      externalRepositoryId: 'gitea:gitea-owner/platform',
      repositoryOwner: 'gitea-owner',
      repositoryName: 'platform',
    });
    if (!grant) throw new Error('Expected repository grant');
    return grant;
  }

  async function auditEvents(eventType: string, connectionId: string) {
    return await db()
      .select({payload: integrationsOutbox.payload})
      .from(integrationsOutbox)
      .where(
        sql`${integrationsOutbox.eventType} = ${eventType} AND ${integrationsOutbox.payload}->>'connectionId' = ${connectionId}`,
      );
  }
});
